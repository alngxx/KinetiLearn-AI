# SkillMentor

AI-powered corporate training platform. Two portals: Admin (training managers)
and Learner (employees). Core features: RAG chatbot, AI exam generator,
daily quiz engine, skill scoring engine.

## Stack
- Backend: FastAPI + SQLAlchemy + Alembic + PostgreSQL
- Task queue: Celery + Redis
- AI: LangChain + OpenAI GPT-4o + text-embedding-3-small
- Vector DB: Chroma (dev) → Pinecone (prod)
- File storage: Cloudflare R2
- Frontend: React + Tailwind + Recharts

## Structure
backend/app/modules/{feature}/  ← models.py, router.py, service.py, schemas.py
backend/worker/tasks.py         ← Celery async tasks

## Rules
- Routers handle HTTP only. Services handle logic. Models handle DB only.
- Never hardcode secrets — use settings from core/config.py
- All errors return: `{"detail": "message"}`
- Write code as a competent Year 2 CS student: correct logic,
  minimal comments, practical variable names, no over-engineering
- Always generate code with spaces around every "=" (e.g., `x = 5`, not `x=5`)

## Commands
- Run server: `uvicorn app.main:app --reload`
- Run worker: `celery -A worker.tasks celery_app worker --loglevel=info`
- Run tests: `pytest`
- Migrations: `alembic upgrade head`