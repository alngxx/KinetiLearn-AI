# KinetiLearn

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


# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Always generate code with spaces around every "=" (e.g., `x = 5`, not `x=5`)
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
