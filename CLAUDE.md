# KinetiLearn
AI-powered corporate training platform. Two portals: Admin (training managers)
and Learner (employees). Core features: RAG chatbot, AI exam generator,
daily quiz engine, skill scoring engine.

## Stack
- Backend: FastAPI + SQLAlchemy + Alembic + PostgreSQL
- Task queue: Celery + Redis
- AI: LangChain + OpenAI, one model per task - `gpt-6-sol` for exam/quiz
  generation, `gpt-6-luna` for RAG chat and skill suggestion - plus
  text-embedding-3-small for embeddings
- Vector DB: Pinecone (production backend: index `kinetilearn-prod` on the
  deployed server, `kinetilearn` for dev) with Chroma as the code default /
  local-dev fallback, selected via `VECTOR_STORE_BACKEND`. Switching an environment requires running
  `backend/scripts/reembed_to_pinecone.py` once - no embeddings live outside
  the active vector store
- File storage: Cloudflare R2
- Frontend: React + Tailwind + Recharts
- Deployment: one EC2 instance running Docker Compose; images in Amazon ECR,
  tagged with the commit SHA; GitHub Actions deploys through SSM Run Command.
  Secrets live in SSM Parameter Store under `/kinetilearn/prod/`

## Structure
```
backend/app/modules/{feature}/  ← models.py, router.py, service.py, schemas.py
backend/app/core/               ← config, DB session, auth/security, LLM + vectorstore clients
backend/worker/tasks.py         ← Celery entry points (document processing, exam/quiz generation)
backend/worker/processing.py    ← document extraction, chunking, embedding

frontend/src/modules/{feature}/ ← mirrors the backend split: api.ts, queries.ts, page components
frontend/src/components/        ← shared UI primitives used across modules

.github/workflows/ci.yml        ← backend + frontend tests
.github/workflows/cd.yml        ← build, push to ECR, deploy; manual run with image_tag rolls back
deploy/deploy.sh                ← runs on EC2: writes .env from SSM, migrates, starts, health check
docker-compose.prod.yml         ← production stack (images from ECR, awslogs logging)

docs/ARCHITECTURE.md and docs/SCHEMA.md have the full layout and DB schema.
docs/DEPLOYMENT.md is the AWS runbook: setup, deploys, rollback, logs, teardown.
```

## Rules
- Routers handle HTTP only. Services handle logic. Models handle DB only.
- Never hardcode secrets - use settings from core/config.py
- All errors return: `{"detail": "message"}`
- Write code as a competent Year 3 CS student: correct logic,
  minimal comments, practical variable names, no over-engineering
- Always generate code with spaces around every "=" (e.g., `x = 5`, not `x=5`)
- Never commit and push yourself, always let user commit and push!
- A merge to `main` deploys to production. Pushes that change only `**.md` or
  `docs/**` skip CI and the deploy
- On the production server only `seed_config` may run. Never run
  `seed_users`, `seed_classes` or `seed_content` there; create the first admin
  with `scripts/create_admin.py`
- Never print or commit secrets, AWS account IDs, instance IDs or role ARNs;
  the repo is public. Use placeholders in docs

## Commands
- Run server: `uvicorn app.main:app --reload`
- Run worker: `celery -A worker.tasks:celery_app worker --loglevel=info`
- Run tests: `pytest`
- Migrations: `alembic upgrade head`
- Create an admin: `python -m scripts.create_admin` (prompts for the password)
- Deploy: merge to `main`. Roll back: Actions, CD, Run workflow with `image_tag`


# Andrej Karpathy's guidelines
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity first

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-driven execution

**Define success criteria upfront, then run.**

Transform tasks into verifiable goals stated before you start:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan up front:
[Step] → success: [check]
[Step] → success: [check]
[Step] → success: [check]

Once success criteria are stated, run to completion against them. Don't add
extra self-review passes or re-verification steps beyond what the stated
criteria require - a stated test suite passing is the verification; no need
to double-check it again afterward.

**Exception:** for numbered/plan-mode tasks specifically, the prompt may ask
for a single adversarial-review-subagent pass at the end, checking the diff
against the approved plan (requirements implemented, edge cases tested,
nothing out-of-scope changed). This is not the same agent re-checking its
own already-stated criteria - it's an independent reviewer catching plan
drift the stated criteria didn't cover. It does not apply to small/routine
fixes; on those, this rule's default (no extra passes) still holds.

## 5. Reporting back

**Match report length to what changed, skip narrating routine steps**

- First line answers "what happened" - did it work, what changed. Detail after.
- Skip narrating routine steps ("now I'll check the imports..."). Report findings,
  not process.
- For a small/surgical change, a few lines is enough. Don't pad with restated
  context or a summary of what was already discussed in the prompt.
- Flag real uncertainties or tradeoffs found during work - don't flag things
  already covered by the stated plan.

## 6. Scope discipline

**Deliver what was asked, at the scope intended.**

- Make routine judgment calls yourself; check in only when different readings
  of the request would lead to materially different work.
- If the request seems mistaken or a better approach exists, say so in a
  sentence and continue with the task as asked, rather than quietly widening,
  narrowing, or transforming it.
- Finish the whole task. Stop short of actions clearly beyond what was asked.