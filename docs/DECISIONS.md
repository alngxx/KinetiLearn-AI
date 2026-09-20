# Technical decisions and bug fixes

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
time and accumulates results until it has enough unique questions, reporting
progress after each batch so the admin's waiting screen isn't stalled on one
long request.

**The Celery generation task guards against a redelivered message re-running
a finished job.** A message broker can redeliver a task it already
dispatched - a worker restart or a slow ack is enough to trigger it - and
without a check that would generate a second exercise for a job that already
succeeded. `run_generation_job()` checks that the job's status is still
`queued` before doing any work, and logs a warning and returns early
otherwise, so a redelivery is a no-op instead of a duplicate exam.

**The RAG chatbot's retrieval scope depends on how the session was opened, not
a global toggle.** A chat session scoped to one document only ever searches
that document; a session opened from "explain my wrong answers" is scoped to
every document that specific exam was generated from, read from the exam's own
provenance records (`exercise_documents`) rather than from live per-question
links, which go null once an exam draws from more than one document. The two
scoping columns on `chat_sessions` are mutually exclusive in practice, and no
scope at all means the whole active corpus.

**A weak retrieval match returns a canned response instead of asking the LLM
to guess.** A cosine similarity below 0.25 counts as "the corpus has nothing
on this" - deliberately permissive, since a short question against a
500-token chunk often scores 0.2-0.5 even on a real match, so a stricter
cutoff would reject legitimate questions. If that weak match also comes with
no conversation history yet, the reply is a fixed "not in the training
materials" message rather than a generated one. Mid-conversation, the same
weak match is let through anyway, because a follow-up like "explain the
second one" embeds poorly by design and the real answer is usually already in
history.

**`class_documents` cascades from both sides, and its scope check runs after
existence checks, not before.** The join table's two FKs (`class_id`,
`document_id`) are both `ON DELETE CASCADE`: deleting a class or a document
should just drop the association, not get blocked by it or leave an orphaned
row behind. On the exam-generation side, `_assert_document_usable()` - which
404s on a document that doesn't exist or isn't ready - runs for every
requested document before `_assert_documents_in_class()` - which 422s on a
document that exists but isn't linked to the class - runs once over the whole
set. That order is deliberate: a document ID that's simply wrong should
report as missing, not as out-of-class. The class-picker UI never offers an
out-of-class document, but the endpoint itself is still reachable directly, so
the ordering matters for a request that skips the UI.

**Deleting a document with any cited chat answer failed outright, until the
FK was changed to cascade.** `chat_message_citations.document_chunk_id` was
originally `ON DELETE RESTRICT`: the moment a learner's chat cited a chunk
from a document, that document became undeletable, and the delete surfaced as
a raw database error instead of a clean response. Migration `f7c2c192db6b`
changed the FK to `CASCADE`, so deleting the document now takes its citation
rows with it. The tradeoff: an old chat answer keeps its text, but silently
loses that one citation's source chip once the cited document is gone - the
answer reads the same, it just cites less than it used to.

**`exercises.total_points` doesn't need an ongoing recompute, because
questions stop being editable once the exam is finalized.** An early plan
called for the service to recompute `total_points` - and revalidate
`pass_score <= total_points` - every time a question was added, edited, or
deleted. What's actually built is simpler: questions can only change while
`is_active` is false, and `finalize()` sums the current questions' points
exactly once, sets `total_points`, and flips `is_active` to true, which locks
the exercise against further question edits. No code path can change a
question after that point, so there's nothing left to keep in sync - the
simplification held up rather than leaving a gap.

## More detail

- [ARCHITECTURE.md](ARCHITECTURE.md) - directory layout and how the backend's modules relate to each other.
- [SCHEMA.md](SCHEMA.md) - the full database schema, table by table.
