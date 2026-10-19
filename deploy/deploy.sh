#!/usr/bin/env bash
# Deploys one image tag on the EC2 instance. SSM Run Command runs it as root:
#   bash /opt/kinetilearn/incoming/deploy.sh <git-sha>
# The same SSM command first writes this script and docker-compose.prod.yml
# into /opt/kinetilearn/incoming. Secrets come from SSM Parameter Store and go
# only into /opt/kinetilearn/.env (mode 600). Never add "set -x": it would
# print them.
set -euo pipefail

APP_DIR=/opt/kinetilearn
INCOMING="$APP_DIR/incoming"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
PREV_COMPOSE_FILE="$APP_DIR/docker-compose.prev.yml"
TAG_FILE="$APP_DIR/current_tag"
PARAM_PATH=/kinetilearn/prod
REQUIRED_KEYS="POSTGRES_PASSWORD JWT_SECRET OPENAI_API_KEY"

step() { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }
dc() { docker compose -p kinetilearn -f "$COMPOSE_FILE" "$@"; }

NEW_TAG="${1:-}"
[[ "$NEW_TAG" =~ ^[0-9a-f]{7,40}$ ]] || fail "usage: deploy.sh <git-sha>"
[[ $EUID -eq 0 ]] || fail "must run as root"

step "Deploying image tag $NEW_TAG"
install -d -m 700 -o root -g root "$APP_DIR"
PREV_TAG=""
if [[ -f "$TAG_FILE" ]]; then
  PREV_TAG=$(cat "$TAG_FILE")
fi
echo "Previous tag: ${PREV_TAG:-none}"

# IMDSv2 needs a session token first.
IMDS_TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
REGION=$(curl -fsS -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" \
  http://169.254.169.254/latest/meta-data/placement/region)
export AWS_DEFAULT_REGION="$REGION"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

# Writes .env for one tag. Prints key names only, never values.
write_env() {
  local tag="$1" tmp
  tmp=$(mktemp "$APP_DIR/.env.XXXXXX")
  {
    echo "AWS_REGION=$REGION"
    echo "ECR_REGISTRY=$REGISTRY"
    echo "IMAGE_TAG=$tag"
    echo "ENVIRONMENT=prod"
    aws ssm get-parameters-by-path --path "$PARAM_PATH" --with-decryption \
      --query 'Parameters[].[Name,Value]' --output text |
      while IFS=$'\t' read -r name value; do
        printf '%s=%s\n' "${name##*/}" "$value"
      done
  } > "$tmp"
  for key in $REQUIRED_KEYS; do
    if ! grep -q "^$key=" "$tmp"; then
      rm -f "$tmp"
      fail "SSM parameter $PARAM_PATH/$key is missing"
    fi
  done
  chmod 600 "$tmp"
  mv "$tmp" "$APP_DIR/.env"
  echo "Wrote $APP_DIR/.env for tag $tag with keys: $(cut -d= -f1 "$APP_DIR/.env" | tr '\n' ' ')"
}

wait_for_health() {
  for _ in $(seq 1 36); do
    if curl -fsS -m 5 http://localhost/health > /dev/null 2>&1; then
      echo "Health check passed"
      return 0
    fi
    sleep 5
  done
  echo "Health check failed after 3 minutes"
  return 1
}

rollback() {
  if [[ -z "$PREV_TAG" || "$PREV_TAG" == "$NEW_TAG" ]]; then
    echo "No earlier tag to roll back to"
    return
  fi
  step "Rolling back to $PREV_TAG"
  cp "$PREV_COMPOSE_FILE" "$COMPOSE_FILE"
  write_env "$PREV_TAG"
  dc up -d --remove-orphans
  if wait_for_health; then
    echo "Rollback to $PREV_TAG is healthy"
  else
    echo "Rollback to $PREV_TAG is NOT healthy: check the logs"
  fi
}

step "Logging in to ECR ($REGISTRY)"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"

# Pull before touching anything, so a missing image leaves the old release running.
# Quiet pulls keep the Run Command output short enough to read.
step "Pulling images for $NEW_TAG"
docker pull -q "$REGISTRY/kinetilearn-backend:$NEW_TAG"
docker pull -q "$REGISTRY/kinetilearn-frontend:$NEW_TAG"

step "Installing compose file and .env"
if [[ -f "$COMPOSE_FILE" ]]; then
  cp "$COMPOSE_FILE" "$PREV_COMPOSE_FILE"
fi
cp "$INCOMING/docker-compose.prod.yml" "$COMPOSE_FILE"
cp "$INCOMING/deploy.sh" "$APP_DIR/deploy.sh"
write_env "$NEW_TAG"

# Migrations only move forward; a rollback does not undo them.
step "Running database migrations"
if ! dc run --rm api alembic upgrade head; then
  echo "Migrations failed"
  rollback
  fail "deploy of $NEW_TAG failed at migrations"
fi

step "Starting containers"
dc up -d --remove-orphans

step "Checking /health"
if ! wait_for_health; then
  dc ps
  dc logs --tail 40 api web
  rollback
  fail "deploy of $NEW_TAG failed the health check"
fi

echo "$NEW_TAG" > "$TAG_FILE"
# Old images go; a rollback pulls its tag from ECR again.
docker image prune -af > /dev/null
step "Deployed image tag $NEW_TAG"
