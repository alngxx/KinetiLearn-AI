<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png">
  <img alt="KinetiLearn" src="docs/logo.png">
</picture>

An AI-powered LMS with admin portal for training
managers and learner portal for employees: upload training material, generate
exams from it with GPT-6, run a daily quiz engine, and track employees'
skill level from what they actually get right.

![KinetiLearn's two portals against a starfield: Managers generate AI-exams from their own resources and track completion across every class; Employees take assigned exams and daily quizzes and ask Pace, the RAG-based assistant, for help.](docs/banner.svg)

## Why this exists

I built KinetiLearn to practice shipping a full-stack app end to end, not to
launch a product. FastAPI, async SQLAlchemy, a Celery pipeline that processes
uploaded documents, a RAG chatbot, an LLM-driven exam generator, a React admin
UI - all wired together and actually working, not just scaffolded.

## Screenshots / Demo

![Landing page with the two portal doors, managers and employees](docs/screenshots-demo/admin-portal/landing-page.png)

**[Admin-portal walkthrough](docs/demo-videos/admin-portal.mov)**

**[Learner-portal walkthrough](docs/demo-videos/learner-portal.mov)**

<details>
<summary>Screenshots (admin + learner portal)</summary>

### Admin portal

![Admin login screen with demo credentials filled in](docs/screenshots-demo/admin-portal/login-credentials.png)

![Grid of active classes in the admin dashboard](docs/screenshots-demo/admin-portal/admin-classes-grid.png)

![Uploading a document and tagging it to a skill](docs/screenshots-demo/admin-portal/admin-document-upload-tagging.png)
Uploading a PDF and tagging it to the skills it should score

![Generating an exam from source documents with GPT-6](docs/screenshots-demo/admin-portal/admin-exam-generation.png)
Generating an exam straight from the uploaded material

![Daily quiz configuration screen](docs/screenshots-demo/admin-portal/admin-daily-quiz-configs.png)
Setting up a daily quiz to push out on a schedule

![Reviewing a learner's graded submission](docs/screenshots-demo/admin-portal/admin-submission-review.png)
Reviewing how one learner did on a submission

### Learner portal

![Employee login screen with demo credentials filled in](docs/screenshots-demo/learner-portal/employee-login-credentials.png)

![Learner home page with today's daily quiz](docs/screenshots-demo/learner-portal/home-daily-quiz.png)

![Classes list with per-class progress](docs/screenshots-demo/learner-portal/classes-progress.png)

![A class's materials and exercises](docs/screenshots-demo/learner-portal/class-detail-materials-exercises.png)

![A scored quiz submission with per-question results](docs/screenshots-demo/learner-portal/scored-submission-result.png)

![Pace explaining why an answer was wrong](docs/screenshots-demo/learner-portal/explain-mistakes.png)
Asking Pace why an answer was marked wrong?

![Skills page showing scored skill categories](docs/screenshots-demo/learner-portal/skill-breakdown.png)

</details>

## Key features

- Admins upload PDF, DOCX, or Markdown. A Celery pipeline chunks, embeds, and
  stores it. Re-uploads become new versions, so learners keep what they saw.
- Tag a document with skills, then generate a GPT-6 multiple-choice exam from
  it. The admin sets the question count (1-50) and the prompt.
- The chatbot cites its sources and says so when nothing matches. Its scope
  follows how the chat opened: an exam, a class, one document, or everything.
- Each class has its own materials and a "Study with AI mentor" chat that
  never reaches outside that class.
- Materials download through 5-minute signed URLs, gated by class membership.
- Learners take daily quizzes and scheduled exams, then ask the chatbot to
  explain what they got wrong.
- Correct answers roll up into per-skill scores against admin-set thresholds.
  Skills a learner hasn't touched still show, so gaps are visible.

## Tech stack

Verified from `backend/requirements.txt` and `frontend/package.json`.

**Backend**
- FastAPI + Uvicorn
- SQLAlchemy (async, via `asyncpg`) + Alembic migrations
- PostgreSQL
- Celery + Redis for document processing pipeline
- LangChain + `langchain-openai` + `tiktoken`, calling GPT-6 and
  `text-embedding-3-small` directly through `openai` SDK. One model per task
  rather than one everywhere: `gpt-6-sol` writes exam and daily-quiz questions,
  `gpt-6-luna` answers RAG chat and suggests skills (see
  [DECISIONS.md](docs/DECISIONS.md))
- Vector DB selected by the `VECTOR_STORE_BACKEND` env var: `chroma`
  (local/offline-dev fallback) or `pinecone`
  (**the production backend** - index `kinetilearn-prod` on the deployed
  server and `kinetilearn` for dev, dimension 1536, metric cosine, same
  `text-embedding-3-small` embeddings as before, this was a backend swap, not
  a model change).
- PyMuPDF and `python-docx` for document text extraction
- boto3 for Cloudflare R2 (S3-compatible) file storage
- passlib (bcrypt) + `python-jose` for password hashing and JWTs
- pytest + pytest-asyncio + httpx for the test suite (507 tests, all passing)

**Frontend**
- React 19 + TypeScript, built with Vite
- React Router 7, TanStack Query 5
- Tailwind CSS 4 + Radix UI primitives + shadcn
- Recharts for the skill breakdown charts
- Vitest + Testing Library + MSW for unit tests (460 tests, all passing),
  Playwright for e2e
- `openapi-typescript` generates the API types from the running backend's
  OpenAPI schema (`npm run gen:api`)

**Infrastructure and CI/CD**
- GitHub Actions: CI runs the backend and frontend tests on every push and
  pull request. CD builds the Docker images, pushes them to Amazon ECR, and
  deploys through SSM Run Command, with a one-click rollback by image tag
- AWS: one EC2 instance running Docker Compose, ECR for images, SSM Parameter
  Store for secrets, CloudWatch Logs and a CPU alarm, and IAM roles with
  GitHub OIDC instead of long-lived keys
- Docker: a Python backend image and a nginx frontend image;
  `docker-compose.prod.yml` runs production stack

## Deployment

A merge to `main` ships to one EC2 instance running Docker Compose:

```
merge to main -> CI tests -> build images -> push to ECR -> deploy via SSM -> health check
```

- A failed health check restores the previous release; roll back by hand with an image tag
- No SSH keys, long-lived AWS keys, or secrets in git
- Setup, rollback, logs, teardown, and known limits: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Setup

### 1. Start Postgres and Redis

```bash
docker compose up -d postgres redis
```

### 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` and fill in:
- `OPENAI_API_KEY` - required, the app won't start without it
- `JWT_SECRET` - anything, for local dev
- `R2_ACCESS_KEY` / `R2_SECRET_KEY` / `R2_BUCKET_NAME` / `R2_ENDPOINT_URL` -
  only needed if you test document upload against real R2
- `VECTOR_STORE_BACKEND` - `chroma` (default) or `pinecone` (the production backend; needs
  `PINECONE_API_KEY` + `PINECONE_INDEX` filled in, and a Pinecone index
  already created at dimension 1536 / metric cosine before you switch)

```bash
alembic upgrade head
uvicorn app.main:app --reload
```

In terminal 2, start the Celery worker (required for document processing and
exam generation, both run as workerr tasks):

```bash
celery -A worker.tasks:celery_app worker --loglevel=info
```

Run the backend tests:

```bash
pytest
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

`frontend/.env.development` already points `VITE_API_BASE_URL` at
`http://localhost:8000`, so no changes needed for local dev.

Run the frontend tests:

```bash
npm run test        # vitest
npm run test:e2e    # playwright, needs the backend running
```

### 4. Seed data (optional)

Seed scripts live in `backend/scripts/` and must run in this order:

```bash
python -m scripts.seed_config
python -m scripts.seed_users
python -m scripts.seed_classes
python -m scripts.seed_content   # costs OpenAI credits
```

## docs/

More decisions during developing KinetiLearn, find in
[docs/DECISIONS.md](docs/DECISIONS.md).\
For the directory layout and how the modules relate to each other, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).\
For the AWS setup, deploys, and rollback, see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
