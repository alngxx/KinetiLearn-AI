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
- Run worker: `celery -A worker.tasks:celery_app worker --loglevel=info`
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
criteria require — a stated test suite passing is the verification; no need
to double-check it again afterward.

## 5. Reporting Back

**Match report length to what changed, skip narrating routine steps**

- First line answers "what happened" — did it work, what changed. Detail after.
- Skip narrating routine steps ("now I'll check the imports..."). Report findings,
  not process.
- For a small/surgical change, a few lines is enough. Don't pad with restated
  context or a summary of what was already discussed in the prompt.
- Flag real uncertainties or tradeoffs found during work — don't flag things
  already covered by the stated plan.

## 6. Scope Discipline

**Deliver what was asked, at the scope intended.**

- Make routine judgment calls yourself; check in only when different readings
  of the request would lead to materially different work.
- If the request seems mistaken or a better approach exists, say so in a
  sentence and continue with the task as asked, rather than quietly widening,
  narrowing, or transforming it.
- Finish the whole task. Stop short of actions clearly beyond what was asked.

## Frontend Visual Quality (Phase 3 onward)
- Use the `frontend-design` skill for aesthetic direction and the
  `web-design-guidelines` skill for a correctness/accessibility audit, on
  every screen. This baseline applies every task, not deferred.
- Baseline interactivity — hover/focus states, transition-colors on
  interactive elements, prefers-reduced-motion-respecting spinners — is
  mandatory every task.
- A signature/bespoke design element (like ThresholdLadder — something that
  encodes real data, not decoration) is optional per task: add one only
  when a screen's data genuinely earns it. Most screens won't need one.
- Heavier motion (framer-motion sequences, scroll-reveal, staggered list
  entrances, animated chart/number reveals) is intentionally deferred to
  Task 43's single consistency pass across all screens, not built
  piecemeal per task.
- Headings and buttons use sentence case, not Title Case, project-wide —
  settled in Task 34, do not re-litigate.

## Frontend Consistency Passes (Phase 3)
- A mid-point consistency pass runs around Task 37-38 (after the admin
  portal is complete, before the learner portal begins): review all admin
  screens together for drift in motion, spacing, and any deferred items
  that have accumulated (dark mode, URL-synced filters, virtualization,
  focus-first-error, etc.) — fix what's cheap and genuinely cross-cutting,
  re-defer the rest to the final pass.
- The final pass (originally Task 42, "Polish") remains the complete pass:
  heavier motion (framer-motion sequences, scroll-reveal, staggered
  entrances), full accessibility re-audit, and E2E smoke tests across both
  portals.
- This does not change per-task scope otherwise — baseline design quality
  (typography, palette, hover/focus states, accessibility) stays mandatory
  every task, same as before.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer
rewrites due to overcomplication, clarifying questions come before implementation
rather than after mistakes, and reports are short enough to read in one pass.