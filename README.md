# KinetiLearn

An AI-powered corporate training platform with an admin portal for training
managers and a learner portal for employees: upload training material, generate
exams from it with GPT-4o, run a daily quiz engine, and track each employee's
skill level from what they actually get right.

## Why this exists

I built KinetiLearn to practice shipping a full-stack app end to end: FastAPI
backend with async SQLAlchemy, a Celery pipeline for document processing, a RAG
chatbot over uploaded material, an LLM-driven exam generator, and a React admin
UI on top of all of it. The scope (13 active classes, real exams, real
submissions, a scoring history) is a demo dataset sized to show the features
working, not yet a customer deployment.

## Screenshots / Demo


## Key features

- Admin can upload a document (PDF, DOCX, or Markdown), and it gets chunked,
  embedded, and stored in Chroma through a Celery pipeline, versioned so a
  re-upload doesn't silently replace what learners already saw.
- Admin can tag a document with one or more skills, and generate a 50-question
  multiple-choice exam from it with gpt-4o, with a free-text prompt to steer
  the questions asked.
- Admin can organize employees into classes by department, activate/deactivate
  classes, and finalize an exam with a schedule window, duration, and pass
  score before learners can take it.
- Learner can chat with a RAG assistant scoped to either the whole active
  document corpus or a single document, with answers grounded in cited source
  chunks and a fallback "nothing in the training materials" response when
  retrieval finds nothing relevant.
- Learner can take a daily quiz pulled from a configured document, take a
  finalized exam within its scheduled window, and ask the assistant to explain
  exactly which questions they got wrong and why.
- Learner's correct answers roll up into a per-skill cumulative score against
  admin-configured thresholds, shown as a skill breakdown that includes every
  active skill (not just the ones a learner has touched).
- Admin can correct a submission's score by hand after grading, with the
  correction recorded separately from the original auto-grade.

## Tech stack

Verified from `backend/requirements.txt` and `frontend/package.json`.

**Backend**
- FastAPI + Uvicorn
- SQLAlchemy (async, via `asyncpg`) + Alembic migrations
- PostgreSQL
- Celery + Redis for the document processing pipeline
- LangChain + `langchain-openai` + `tiktoken`, calling GPT-4o and
  `text-embedding-3-small` directly through the `openai` SDK
- Chroma as the vector store (the config also has a Pinecone index/API key slot
  for a prod swap, unused in this repo)
- PyMuPDF and `python-docx` for document text extraction
- boto3 for Cloudflare R2 (S3-compatible) file storage
- passlib (bcrypt) + `python-jose` for password hashing and JWTs
- pytest + pytest-asyncio + httpx for the test suite (399 tests, all passing)

**Frontend**
- React 19 + TypeScript, built with Vite
- React Router 7, TanStack Query 5
- Tailwind CSS 4 + Radix UI primitives + shadcn
- Recharts for the skill breakdown charts
- Vitest + Testing Library + MSW for unit tests (428 tests, all passing),
  Playwright for e2e
- `openapi-typescript` generates the API types from the running backend's
  OpenAPI schema (`npm run gen:api`)

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
  only needed if you're testing document upload against real R2. Note: the
  variable the app actually reads is `R2_BUCKET_NAME` (see
  `app/core/config.py`), not `R2_BUCKET` as `.env.example` currently has it.

```bash
alembic upgrade head
uvicorn app.main:app --reload
```

In terminal 2, start the worker (needed for document processing and
exam generation, both run as Celery tasks):

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
python -m scripts.seed_content   # uploads real documents and generates real exams - costs OpenAI credits
```

Each script is idempotent, so re-running one that already ran adds nothing.

## Architecture / interesting technical decisions

**Category delete had to guard against a raw 500 from the DB, not just add a
DELETE route.** `skills.category_id` is a `RESTRICT` foreign key, so deleting a
category with skills still attached would fail at the database layer with an
unhandled error. `CategoryService.delete()` checks for dependent skills first
and raises a clean 409 with a message telling the admin what to do
(`backend/app/modules/config/service.py`). `documents.category_id` is
`SET NULL` instead, so documents don't need the same check - they're just
freed automatically.

**The frontend's name-validation regex was stricter than what the backend
already accepted, which meant valid names couldn't be edited through the UI.**
Early on, the frontend only allowed `[a-zA-Z0-9]+` for entity names (no spaces,
no punctuation), while the backend's Pydantic schemas always allowed spaces and
a defined set of punctuation. A class named "Communication & Teamwork" - valid
by the backend's own rules - would fail client-side validation the moment
someone tried to edit it. Fixed by matching the frontend pattern to the
backend's exactly, with a comment explaining why they have to stay in sync.

**The skill scoring engine is synchronous and makes no LLM call.** Scoring is
pure aggregation: every correct answer's points roll up to whichever skills its
source document is tagged with, and a skill's level (basic/intermediate/
advanced) is a threshold lookup against that running total. There's no
judgment call an LLM could make here, so it isn't in the loop, and grading a
submission doesn't cost anything past the exam generation itself.

**Exam generation runs in small batches instead of one large LLM call.**
Asking GPT-4o for all N questions in a single response risked hitting the
output token limit on larger exams. `generate_quiz()` requests one batch at a
time and accumulates until it has enough unique questions, reporting progress
after each batch so the admin's waiting screen isn't stalled on one long
request. The Celery task also guards against a redelivered message re-running
a job that's already in progress, checking the job's status before starting.

**The RAG chatbot's retrieval scope depends on how the session was opened, not
a global toggle.** A chat session scoped to one document only ever searches
that document; a session opened from "explain my wrong answers" is scoped to
every document that specific exam was generated from, read from the exam's own
provenance records rather than from live per-question links (which go null
once an exam draws from more than one document). A similarity score below
0.25 with no conversation history yet returns a canned "not in the training
materials" response instead of asking the LLM to guess.
