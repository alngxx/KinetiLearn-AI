# KinetiLearn - database schema

This documents the PostgreSQL schema as it actually exists: introspected
directly from a running database (`pg_dump --schema-only`) and cross-checked
against the SQLAlchemy models under `backend/app/modules/*/models.py` and the
11 migrations in `backend/alembic/versions/`. Every column, constraint, and
index below is taken from the live schema, not from a design intention.

## Conventions the schema follows

- **Primary keys** are `UUID DEFAULT gen_random_uuid()` on single-column PKs.
  Join tables use a composite PK of the two FK columns instead (noted per
  table).
- **Timestamps**: every table has `created_at` (`TIMESTAMPTZ NOT NULL DEFAULT
  now()`). `updated_at` exists only on tables whose rows get edited after
  creation - `users`, `documents`, `chat_sessions` - and all three set it via
  SQLAlchemy's `onupdate=func.now()`, since Postgres's own `DEFAULT NOW()`
  only fires on INSERT.
- **Soft delete**: config tables and a few others carry `is_active` (boolean,
  defaults true) instead of being hard-deleted, since historical records
  (submissions, scores) reference them.
- **Naming**: `snake_case`, plural table names, FK columns named
  `{singular}_id`.
- **Enums**: a `VARCHAR(N)` column plus a `CHECK` constraint, not a Postgres
  `ENUM` type.
- **`ON DELETE` behavior**: config/reference tables are `RESTRICT`; rows owned
  by a parent (versions, answers, questions, chunks, messages) `CASCADE`;
  audit/historical rows are `RESTRICT` or `SET NULL` depending on whether they
  need to outlive the thing they reference.
- **Indexes**: implicit on every PK and UNIQUE constraint; explicit indexes
  are added on FK columns that get filtered or joined on directly.
- Answer tables (`submission_answers`, `daily_quiz_submission_answers`) use
  `answered_at` instead of `created_at` - same meaning, a more accurate name.

## Table count: 32

| Group | Count | Tables |
|---|---|---|
| Config | 6 | categories, skills, departments, seniority_levels, job_positions, employee_levels |
| User | 1 | users |
| Documents | 4 | documents, document_versions, document_skills, document_chunks |
| Class | 3 | classes, class_members, class_documents |
| Exercise | 5 | exercises, questions, question_options, exercise_documents, exercise_generation_jobs |
| Submission & Scoring | 4 | submissions, submission_answers, skill_scores, skill_score_history |
| Daily Quiz | 6 | daily_quiz_configs, daily_quizzes, daily_quiz_questions, daily_quiz_question_options, daily_quiz_submissions, daily_quiz_submission_answers |
| Chat (RAG) | 3 | chat_sessions, chat_messages, chat_message_citations |

`class_documents` and `exercise_generation_jobs` were both added after the
initial 29-table migration - see their entries below for what each does.

---

# Group 1 - Config (6 tables)

## 1.1 `categories`

Top-level grouping for skills (e.g., "Technical", "Soft Skills", "Compliance").

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(100) | NO | - | UNIQUE |
| `description` | TEXT | YES | NULL | |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id` · **Unique:** `name` · **No FKs**

## 1.2 `skills`

A measurable competency. Belongs to a category. Carries score thresholds.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `category_id` | UUID | NO | - | FK → `categories.id` ON DELETE RESTRICT |
| `name` | VARCHAR(100) | NO | - | |
| `description` | TEXT | YES | NULL | |
| `basic_max` | INTEGER | NO | - | Upper bound of the "basic" band |
| `intermediate_max` | INTEGER | NO | - | Upper bound of the "intermediate" band |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id`
- **Unique:** `(category_id, name)`
- **FK:** `category_id` → `categories.id` ON DELETE RESTRICT
- **CHECK:** `ck_skills_level_thresholds` - `intermediate_max > basic_max`
- **Index:** `category_id`

A score at or below `basic_max` is "basic," above it and at or below
`intermediate_max` is "intermediate," above that is "advanced." Only the two
upper bounds are stored, so the bands can't drift out of sync with each
other. The table originally had six threshold columns (a min and max for each
of the three bands); migration `b7e4a2f039c1` replaced them with these two,
and `f2b6c8d1e934` dropped a leftover `DEFAULT 500` on `intermediate_max`
that a later migration had left behind for backfilling.

## 1.3 `departments`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(100) | NO | - | UNIQUE |
| `description` | TEXT | YES | NULL | |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id` · **Unique:** `name` · **No FKs**

## 1.4 `seniority_levels`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(50) | NO | - | UNIQUE |
| `rank` | SMALLINT | NO | - | UNIQUE; for sorting (1 = lowest) |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id` · **Unique:** `name`, `rank` · **No FKs**

## 1.5 `job_positions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(100) | NO | - | UNIQUE |
| `description` | TEXT | YES | NULL | |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id` · **Unique:** `name` · **No FKs**

A job position has no `department_id`: a position isn't scoped to a single
department.

## 1.6 `employee_levels`

Internal grade/band (e.g., "L1", "L2"). Distinct from seniority.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(50) | NO | - | UNIQUE |
| `rank` | SMALLINT | NO | - | UNIQUE |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id` · **Unique:** `name`, `rank` · **No FKs**

---

# Group 2 - User & Auth (1 table)

## 2.1 `users`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `email` | VARCHAR(255) | NO | - | UNIQUE; lowercased at the app layer |
| `password_hash` | VARCHAR(255) | NO | - | bcrypt |
| `full_name` | VARCHAR(150) | NO | - | |
| `role` | VARCHAR(20) | NO | `'learner'` | CHECK IN ('admin', 'learner') |
| `department_id` | UUID | YES | NULL | FK → `departments.id` ON DELETE RESTRICT |
| `seniority_id` | UUID | YES | NULL | FK → `seniority_levels.id` ON DELETE RESTRICT |
| `job_position_id` | UUID | YES | NULL | FK → `job_positions.id` ON DELETE RESTRICT |
| `employee_level_id` | UUID | YES | NULL | FK → `employee_levels.id` ON DELETE RESTRICT |
| `avatar_url` | VARCHAR(255) | YES | NULL | R2 object key, not a URL - see DECISIONS.md |
| `is_active` | BOOLEAN | NO | TRUE | |
| `last_login_at` | TIMESTAMPTZ | YES | NULL | |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | `onupdate=func.now()` |

- **PK:** `id` · **Unique:** `email`
- **FKs:** all four tag FKs ON DELETE RESTRICT
- **Index:** `email`, `role`, `department_id`, `is_active`

---

# Group 3 - Documents (4 tables)

## 3.1 `documents`

A training material container. Versions hold the actual files.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `title` | VARCHAR(255) | NO | - | |
| `description` | TEXT | YES | NULL | |
| `category_id` | UUID | YES | NULL | FK → `categories.id` ON DELETE SET NULL |
| `active_version_number` | INTEGER | YES | NULL | App-managed; not a FK, to avoid a circular reference |
| `created_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | `onupdate=func.now()` |

- **PK:** `id`
- **FKs:** `category_id` ON DELETE SET NULL; `created_by` ON DELETE SET NULL
- **Index:** `category_id`, `is_active`

## 3.2 `document_versions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `document_id` | UUID | NO | - | FK → `documents.id` ON DELETE CASCADE |
| `version_number` | INTEGER | NO | - | Monotonic per document, starts at 1 |
| `file_url` | VARCHAR(500) | NO | - | R2 object key |
| `file_name` | VARCHAR(255) | NO | - | Original upload filename |
| `file_size_bytes` | BIGINT | NO | - | |
| `mime_type` | VARCHAR(100) | NO | - | CHECK IN ('application/pdf', '...wordprocessingml.document', 'text/markdown') |
| `processing_status` | VARCHAR(20) | NO | `'pending'` | CHECK IN ('pending','processing','ready','failed') |
| `processing_error` | TEXT | YES | NULL | Set when processing_status = 'failed' |
| `change_note` | TEXT | YES | NULL | |
| `uploaded_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `(document_id, version_number)` - composite
- **FKs:** `document_id` ON DELETE CASCADE; `uploaded_by` ON DELETE SET NULL

The `mime_type` CHECK originally allowed only PDF and DOCX; `text/markdown`
was added later (migration `c4f9e2b7a815`) once markdown became an upload
format.

## 3.3 `document_skills`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `document_id` | UUID | NO | - | FK → `documents.id` ON DELETE CASCADE |
| `skill_id` | UUID | NO | - | FK → `skills.id` ON DELETE RESTRICT |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `(document_id, skill_id)` - composite

## 3.4 `document_chunks`

Chunk metadata. The vector itself lives in the active vector store
(Pinecone in production, Chroma for local/offline dev - see CLAUDE.md);
this row holds the external vector ID, which is the same ID format in
either backend.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `document_id` | UUID | NO | - | Part of composite FK |
| `version_number` | INTEGER | NO | - | Part of composite FK |
| `chunk_index` | INTEGER | NO | - | 0-based order within the document version |
| `content` | TEXT | NO | - | Raw chunk text (also embedded externally) |
| `token_count` | INTEGER | YES | NULL | |
| `vector_id` | VARCHAR(255) | YES | NULL | External ID in the active vector store (Pinecone or Chroma); NULL until embedded |
| `embedded_at` | TIMESTAMPTZ | YES | NULL | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id`
- **FK (composite):** `(document_id, version_number)` → `document_versions(document_id, version_number)` ON DELETE CASCADE
- **Unique:** `(document_id, version_number, chunk_index)`
- **Index:** `(document_id, version_number)`, `vector_id`

---

# Group 4 - Class & Enrollment (3 tables)

## 4.1 `classes`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(150) | NO | - | |
| `description` | TEXT | YES | NULL | |
| `start_date` | DATE | YES | NULL | |
| `end_date` | DATE | YES | NULL | |
| `created_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id` · **FK:** `created_by` ON DELETE SET NULL
- **CHECK:** `end_date IS NULL OR start_date IS NULL OR end_date >= start_date`
- **Index:** `is_active`

## 4.2 `class_members`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `class_id` | UUID | NO | - | FK → `classes.id` ON DELETE CASCADE |
| `user_id` | UUID | NO | - | FK → `users.id` ON DELETE CASCADE |
| `enrolled_at` | TIMESTAMPTZ | NO | now() | Used instead of `created_at` |

- **PK:** `(class_id, user_id)` - composite
- **Index:** `user_id`

## 4.3 `class_documents`

Which documents a class can generate exams from. Scopes the document picker
in the exam-generation UI so an admin only sees documents relevant to the
class they're generating for. This is deliberately separate from
`documents.category_id` - category is a taxonomy shared with skills and feeds
skill scoring, a different question from which class a document belongs to.
Added later, in the `feature/class-scoped-documents` work (migration
`a3c8f1e5d7b2`); it isn't in the original 29-table migration.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `class_id` | UUID | NO | - | FK → `classes.id` ON DELETE CASCADE |
| `document_id` | UUID | NO | - | FK → `documents.id` ON DELETE CASCADE |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `(class_id, document_id)` - composite
- **Index:** `document_id`

---

# Group 5 - Exercise & Questions (5 tables)

## 5.1 `exercises`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `class_id` | UUID | NO | - | FK → `classes.id` ON DELETE RESTRICT |
| `title` | VARCHAR(255) | NO | - | |
| `description` | TEXT | YES | NULL | |
| `start_time` | TIMESTAMPTZ | NO | - | |
| `end_time` | TIMESTAMPTZ | NO | - | |
| `duration_minutes` | INTEGER | NO | - | |
| `pass_score` | INTEGER | NO | - | |
| `total_points` | INTEGER | NO | - | Sum of question points |
| `created_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `is_active` | BOOLEAN | NO | TRUE | Doubles as "finalized": false while questions are still editable, true once finalized |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id`
- **FKs:** `class_id` ON DELETE RESTRICT; `created_by` ON DELETE SET NULL
- **CHECK:** `end_time > start_time`, `pass_score >= 0 AND pass_score <= total_points`
- **Index:** `class_id`, `start_time`, `end_time`

Questions can only be added, edited, or deleted while `is_active` is false.
`finalize()` computes `total_points` from the current questions at that
moment, validates `pass_score <= total_points`, and sets `is_active = true`;
after that, the exercise service rejects any further edit to its questions,
so `total_points` never needs recomputing again. There's no retry mechanic -
a submission is always attempt 1.

## 5.2 `questions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `exercise_id` | UUID | NO | - | FK → `exercises.id` ON DELETE CASCADE |
| `source_document_id` | UUID | YES | NULL | Part of composite FK |
| `source_version_number` | INTEGER | YES | NULL | Part of composite FK |
| `question_text` | TEXT | NO | - | |
| `explanation` | TEXT | YES | NULL | |
| `points` | INTEGER | NO | 1 | |
| `order_index` | SMALLINT | NO | - | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id`
- **FK:** `exercise_id` ON DELETE CASCADE
- **FK (composite, nullable):** `(source_document_id, source_version_number)` → `document_versions(document_id, version_number)` ON DELETE SET NULL
- **Unique:** `(exercise_id, order_index)`
- **Index:** `exercise_id`

## 5.3 `question_options`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `question_id` | UUID | NO | - | FK → `questions.id` ON DELETE CASCADE |
| `option_label` | VARCHAR(5) | NO | - | 'A', 'B', 'C', 'D' |
| `option_text` | TEXT | NO | - | |
| `is_correct` | BOOLEAN | NO | FALSE | App enforces exactly one true per question |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id`
- **FK:** `question_id` ON DELETE CASCADE
- **Unique:** `(question_id, option_label)`
- **Index:** `question_id`

## 5.4 `exercise_documents`

Which document versions fed exam generation. Per-question provenance
(`questions.source_document_id`) is only populated when a single document was
used, so for a multi-document exam this table is the only link back to the
source material - the RAG chatbot reads it to scope retrieval when explaining
wrong answers.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `exercise_id` | UUID | NO | - | PK part 1 · FK → `exercises.id` ON DELETE CASCADE |
| `document_id` | UUID | NO | - | PK part 2 · part of composite FK |
| `version_number` | INTEGER | NO | - | Part of composite FK |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `(exercise_id, document_id)` - one version per document per exercise
- **FK (composite):** `(document_id, version_number)` → `document_versions(document_id, version_number)` ON DELETE CASCADE
- **Index:** `exercise_id`

`ExamService.generate()` writes one row per source document, whether there
was one or ten. The version recorded is the document's active version at
generation time, not whatever is current later.

## 5.5 `exercise_generation_jobs`

One admin request to generate an exam. Generation runs in the Celery worker,
so this row is what the waiting page polls; the exercise itself is written
in a single commit at the end, which is why `exercise_id` is NULL until the
job succeeds. Not in the original schema - added by migration
`a4d7e2c9b118` once generation moved off the request/response cycle and onto
a job queue.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `class_id` | UUID | NO | - | FK → `classes.id` ON DELETE CASCADE |
| `title` | VARCHAR(255) | NO | - | |
| `prompt` | TEXT | NO | - | |
| `num_questions` | SMALLINT | NO | - | |
| `document_ids` | JSONB | NO | - | Requested source document IDs, as a list |
| `status` | VARCHAR(20) | NO | `'queued'` | CHECK IN ('queued','running','succeeded','failed') |
| `questions_done` | SMALLINT | NO | 0 | Progress counter the waiting page polls |
| `exercise_id` | UUID | YES | NULL | FK → `exercises.id` ON DELETE CASCADE; set on success |
| `error` | TEXT | YES | NULL | |
| `created_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `finished_at` | TIMESTAMPTZ | YES | NULL | |
| `progress_at` | TIMESTAMPTZ | YES | NULL | Stamped on every batch, including a no-progress one; a stale-job sweep uses this to detect a dead worker |

- **PK:** `id`
- **FKs:** `class_id` ON DELETE CASCADE; `exercise_id` ON DELETE CASCADE; `created_by` ON DELETE SET NULL
- **CHECK:** `ck_exercise_generation_jobs_status_valid`
- **Index:** `class_id`

`document_ids` is a JSONB array of IDs rather than a join table on purpose: a
CASCADE from a deleted document would silently shrink the list, and the
worker would generate from fewer documents than the admin asked for. Instead
the worker re-reads each ID at generation time and fails the job loudly if
one is gone.

---

# Group 6 - Submission & Scoring (4 tables)

## 6.1 `submissions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `user_id` | UUID | NO | - | FK → `users.id` ON DELETE RESTRICT |
| `exercise_id` | UUID | NO | - | FK → `exercises.id` ON DELETE RESTRICT |
| `attempt_number` | INTEGER | NO | 1 | Always 1 today |
| `started_at` | TIMESTAMPTZ | NO | now() | |
| `submitted_at` | TIMESTAMPTZ | YES | NULL | NULL = in progress |
| `time_taken_seconds` | INTEGER | YES | NULL | Computed at submit |
| `score` | INTEGER | YES | NULL | NULL until graded |
| `is_passed` | BOOLEAN | YES | NULL | NULL until graded |
| `is_late` | BOOLEAN | NO | FALSE | TRUE if submitted_at > exercise.end_time |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id` · **FKs:** both RESTRICT, to preserve history
- **Unique:** `(user_id, exercise_id, attempt_number)`
- **Index:** `user_id`, `exercise_id`

## 6.2 `submission_answers`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `submission_id` | UUID | NO | - | FK → `submissions.id` ON DELETE CASCADE |
| `question_id` | UUID | NO | - | FK → `questions.id` ON DELETE RESTRICT |
| `selected_option_id` | UUID | YES | NULL | FK → `question_options.id` ON DELETE SET NULL; NULL = skipped |
| `is_correct` | BOOLEAN | YES | NULL | NULL if skipped or ungraded |
| `points_earned` | INTEGER | NO | 0 | |
| `answered_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `(submission_id, question_id)` - composite

## 6.3 `skill_scores`

Current cumulative score per user per skill.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `user_id` | UUID | NO | - | FK → `users.id` ON DELETE CASCADE |
| `skill_id` | UUID | NO | - | FK → `skills.id` ON DELETE RESTRICT |
| `cumulative_score` | INTEGER | NO | 0 | |
| `current_level` | VARCHAR(20) | NO | `'basic'` | CHECK IN ('basic','intermediate','advanced') |
| `last_updated_at` | TIMESTAMPTZ | NO | now() | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `(user_id, skill_id)` - composite
- **Index:** `user_id`, `skill_id`

## 6.4 `skill_score_history`

Audit trail of every score change.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `user_id` | UUID | NO | - | FK → `users.id` ON DELETE CASCADE |
| `skill_id` | UUID | NO | - | FK → `skills.id` ON DELETE RESTRICT |
| `score_delta` | INTEGER | NO | - | Can be negative |
| `source_type` | VARCHAR(20) | NO | - | CHECK IN ('exam','daily_quiz') |
| `submission_id` | UUID | YES | NULL | FK → `submissions.id` ON DELETE SET NULL |
| `daily_quiz_submission_id` | UUID | YES | NULL | FK → `daily_quiz_submissions.id` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id`
- **CHECK** (`ck_skill_score_history_source_consistency`):
  ```sql
  CHECK (
    (source_type = 'exam' AND submission_id IS NOT NULL AND daily_quiz_submission_id IS NULL)
    OR
    (source_type = 'daily_quiz' AND daily_quiz_submission_id IS NOT NULL AND submission_id IS NULL)
  )
  ```
  Exactly one of the two FKs is set, matching which kind of submission produced the score change.
- **Index:** `(user_id, skill_id)`, `created_at`

---

# Group 7 - Daily Quiz (6 tables)

## 7.1 `daily_quiz_configs`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(150) | NO | - | |
| `prompt` | TEXT | NO | - | Instructions for the AI generator |
| `source_document_id` | UUID | NO | - | FK → `documents.id` ON DELETE RESTRICT |
| `target_department_id` | UUID | YES | NULL | FK → `departments.id` ON DELETE SET NULL; NULL = any |
| `target_seniority_id` | UUID | YES | NULL | FK → `seniority_levels.id` ON DELETE SET NULL |
| `target_job_position_id` | UUID | YES | NULL | FK → `job_positions.id` ON DELETE SET NULL |
| `target_employee_level_id` | UUID | YES | NULL | FK → `employee_levels.id` ON DELETE SET NULL |
| `start_date` | DATE | NO | - | First date a quiz is generated |
| `end_date` | DATE | YES | NULL | NULL = open-ended |
| `push_time` | TIME | NO | - | Local wall-clock time, paired with `timezone` |
| `timezone` | VARCHAR(50) | NO | `'Asia/Ho_Chi_Minh'` | IANA timezone name |
| `expiry_hours` | INTEGER | NO | 24 | How long a quiz stays submittable |
| `question_count` | SMALLINT | NO | 5 | Questions per generated quiz |
| `created_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `last_run_at` | TIMESTAMPTZ | YES | NULL | When the scheduler last generated from this config |
| `last_run_status` | VARCHAR(20) | YES | NULL | CHECK IN ('success','skipped','failed') |
| `last_run_error` | TEXT | YES | NULL | |

- **PK:** `id`
- **CHECK:** `end_date IS NULL OR end_date >= start_date`, `question_count > 0`, `expiry_hours > 0`
- **Index:** `is_active`, all four target FK columns

`push_time` is stored as `TIME` with a separate `timezone` column rather than
`TIMETZ`, since `TIMETZ` stores a fixed UTC offset and can't handle daylight
saving transitions. The Celery scheduler combines the two to compute the next
UTC fire time. The four target FKs are all nullable single-value columns, so
targeting is AND-only - there's no way to express "Engineering OR Sales" in
one config. `last_run_at` / `last_run_status` / `last_run_error` were added
later (migration `d5f3a81c6b27`) as a run log for the scheduler.

## 7.2 `daily_quizzes`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `config_id` | UUID | NO | - | FK → `daily_quiz_configs.id` ON DELETE RESTRICT |
| `quiz_date` | DATE | NO | - | Date this quiz is for |
| `generated_at` | TIMESTAMPTZ | NO | now() | |
| `expires_at` | TIMESTAMPTZ | NO | - | Computed from `quiz_date` + `push_time` + `timezone` + `expiry_hours` |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id`
- **Unique:** `(config_id, quiz_date)` - one quiz per config per day
- **Index:** `quiz_date`, `expires_at`

## 7.3 `daily_quiz_questions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `daily_quiz_id` | UUID | NO | - | FK → `daily_quizzes.id` ON DELETE CASCADE |
| `source_document_id` | UUID | YES | NULL | Part of composite FK |
| `source_version_number` | INTEGER | YES | NULL | Part of composite FK |
| `question_text` | TEXT | NO | - | |
| `explanation` | TEXT | YES | NULL | |
| `points` | INTEGER | NO | 1 | |
| `order_index` | SMALLINT | NO | - | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id`
- **FK:** `daily_quiz_id` → `daily_quizzes.id` ON DELETE CASCADE
- **FK (composite, nullable):** `(source_document_id, source_version_number)` → `document_versions(...)` ON DELETE SET NULL
- **Unique:** `(daily_quiz_id, order_index)`
- **Index:** `daily_quiz_id`

## 7.4 `daily_quiz_question_options`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `daily_quiz_question_id` | UUID | NO | - | FK → `daily_quiz_questions.id` ON DELETE CASCADE |
| `option_label` | VARCHAR(5) | NO | - | |
| `option_text` | TEXT | NO | - | |
| `is_correct` | BOOLEAN | NO | FALSE | |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id`
- **Unique:** `(daily_quiz_question_id, option_label)`
- **Index:** `daily_quiz_question_id`

## 7.5 `daily_quiz_submissions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `daily_quiz_id` | UUID | NO | - | FK → `daily_quizzes.id` ON DELETE RESTRICT |
| `user_id` | UUID | NO | - | FK → `users.id` ON DELETE RESTRICT |
| `score` | INTEGER | NO | 0 | |
| `time_taken_seconds` | INTEGER | YES | NULL | |
| `submitted_at` | TIMESTAMPTZ | NO | now() | |
| `is_late` | BOOLEAN | NO | FALSE | TRUE if submitted_at > daily_quizzes.expires_at |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `id`
- **Unique:** `(daily_quiz_id, user_id)`
- **Index:** `user_id`, `daily_quiz_id`

## 7.6 `daily_quiz_submission_answers`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `daily_quiz_submission_id` | UUID | NO | - | FK → `daily_quiz_submissions.id` ON DELETE CASCADE |
| `daily_quiz_question_id` | UUID | NO | - | FK → `daily_quiz_questions.id` ON DELETE RESTRICT |
| `selected_option_id` | UUID | YES | NULL | FK → `daily_quiz_question_options.id` ON DELETE SET NULL |
| `is_correct` | BOOLEAN | YES | NULL | |
| `points_earned` | INTEGER | NO | 0 | |
| `answered_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `(daily_quiz_submission_id, daily_quiz_question_id)` - composite

---

# Group 8 - Chat / RAG (3 tables)

## 8.1 `chat_sessions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `user_id` | UUID | NO | - | FK → `users.id` ON DELETE CASCADE |
| `exercise_id` | UUID | YES | NULL | FK → `exercises.id` ON DELETE SET NULL; set when the chat explains an exam |
| `document_id` | UUID | YES | NULL | FK → `documents.id` ON DELETE SET NULL; set when the chat is pinned to one document |
| `title` | VARCHAR(255) | YES | NULL | Set from the first user message |
| `is_active` | BOOLEAN | NO | TRUE | Soft delete |
| `created_at` | TIMESTAMPTZ | NO | now() | |
| `updated_at` | TIMESTAMPTZ | NO | now() | `onupdate=func.now()` |

- **PK:** `id`
- **FK:** `user_id` ON DELETE CASCADE
- **Index:** `user_id`, `updated_at`, `exercise_id`, `document_id`

The chat service resolves retrieval scope in this order: `exercise_id` set →
every `(document_id, version_number)` in `exercise_documents` for that
exercise; else `document_id` set → that document's active version; else the
whole active corpus. The two columns are mutually exclusive in practice.

## 8.2 `chat_messages`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `session_id` | UUID | NO | - | FK → `chat_sessions.id` ON DELETE CASCADE |
| `role` | VARCHAR(20) | NO | - | CHECK IN ('user', 'assistant') |
| `content` | TEXT | NO | - | |
| `token_count` | INTEGER | YES | NULL | |
| `model_name` | VARCHAR(50) | YES | NULL | e.g. 'gpt-4o' - assistant only |
| `latency_ms` | INTEGER | YES | NULL | Assistant only |
| `created_at` | TIMESTAMPTZ | NO | now() | Also the message ordering |

- **PK:** `id`
- **FK:** `session_id` ON DELETE CASCADE
- **Index:** `session_id`, `created_at`

If LLM generation fails, no assistant message is inserted at all - the error
goes straight to the client instead of a stored placeholder.

## 8.3 `chat_message_citations`

Which chunks an assistant message cited. Many-to-many.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `chat_message_id` | UUID | NO | - | FK → `chat_messages.id` ON DELETE CASCADE |
| `document_chunk_id` | UUID | NO | - | FK → `document_chunks.id` ON DELETE CASCADE |
| `relevance_score` | REAL | YES | NULL | Vector similarity score (0.0-1.0) |
| `created_at` | TIMESTAMPTZ | NO | now() | |

- **PK:** `(chat_message_id, document_chunk_id)` - composite
- **Index:** `chat_message_id`, `document_chunk_id`

`document_chunk_id` was originally `ON DELETE RESTRICT`, which meant deleting
a document with any cited chunk failed outright. Migration `f7c2c192db6b`
changed it to `CASCADE`: a cited document now deletes cleanly, and the old
chat answer just loses that citation's source chip.

---

## More detail

- [ARCHITECTURE.md](ARCHITECTURE.md) - directory layout and how the backend's modules relate to each other.
- [DECISIONS.md](DECISIONS.md) - specific engineering decisions, each with the problem, the fix, and why.
