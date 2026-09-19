# KinetiLearn

An AI-powered corporate training platform with an admin portal for training
managers and a learner portal for employees: upload training material, generate
exams from it with GPT-4o, run a daily quiz engine, and track each employee's
skill level from what they actually get right.

## Why this exists

I built KinetiLearn to practice shipping a full-stack app end to end, not to
launch a product. FastAPI, async SQLAlchemy, a Celery pipeline that processes
uploaded documents, a RAG chatbot, an LLM-driven exam generator, a React admin
UI - all wired together and actually working, not just scaffolded. The demo
data (13 active classes, real exams, real submissions, a scoring history) is
there to make the features visible, since nobody is using this for real yet.

## Screenshots / Demo


## Key features

- Upload a document as admin - PDF, DOCX, or Markdown - and it gets chunked,
  embedded, and stored in Chroma through a Celery pipeline. Documents are
  versioned, so a re-upload doesn't quietly wipe out what learners already saw.
- Tag that document with one or more skills, then hand it to gpt-4o with a
  free-text prompt to generate a 50-question multiple-choice exam.
- The learner-facing chatbot answers from the training material itself, not
  from memory: every answer cites the source chunks it drew from, and it says
  plainly when nothing in the corpus matches instead of guessing. It can be
  scoped to one document or left open to the whole active corpus.
- Learners take daily quizzes pulled from a configured document and finalized
  exams within their scheduled window, then can ask the same chatbot to walk
  through exactly which questions they got wrong and why.
- Correct answers roll up quietly into a per-skill score, checked against
  thresholds an admin configured. The breakdown always shows every active
  skill, even ones a learner hasn't touched yet, so a gap is visible rather
  than just absent.

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
  only needed if you're testing document upload against real R2

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

## Architecture

One decision I'm particularly happy with: deleting a category needed more than
a DELETE route, because `skills.category_id` is a `RESTRICT` foreign key -
something I only found out by trying it and getting a raw 500 back. It now
checks for dependent skills first and gives the admin an actual 409 explaining
what's blocking the delete, instead of leaking a database error to the UI.

More decisions like this, including a frontend validation bug I found and
fixed, are in [docs/DECISIONS.md](docs/DECISIONS.md). For the directory
layout and how the modules relate to each other, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
