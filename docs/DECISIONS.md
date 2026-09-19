# Architecture / interesting technical decisions

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
