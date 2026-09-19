# KinetiLearn - PostgreSQL Schema Specification 

## Global Conventions

| Convention | Rule |
|---|---|
| Primary keys | `UUID DEFAULT gen_random_uuid()` for single-column PKs. Composite PKs where noted. |
| Timestamps | All tables: `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. Add `updated_at TIMESTAMPTZ` only where rows mutate. |
| `updated_at` mechanics | In **SQLAlchemy models**, every `updated_at` column MUST use `server_default=func.now(), onupdate=func.now()`. Postgres `DEFAULT NOW()` alone only handles INSERT, not UPDATE. |
| Soft delete | Config entities: `is_active BOOLEAN NOT NULL DEFAULT TRUE`. Never hard-delete config rows referenced by historical records. |
| Naming | `snake_case`, plural tables, FK = `{singular}_id`. |
| Enums | `VARCHAR(N)` + `CHECK` constraint (easier Alembic migrations than Postgres ENUM type). |
| ON DELETE defaults | Config → `RESTRICT`. Owned children (versions, answers, questions, chunks, messages) → `CASCADE`. Audit/historical rows → `RESTRICT` or `SET NULL`. |
| Indexes | Implicit on PK + UNIQUE. Add explicit indexes on FK columns used in joins/filters (noted per table). |
| `_answers.answered_at` | Answer tables use `answered_at` instead of `created_at`. Same semantics (`NOT NULL DEFAULT NOW()`), more accurate name. Don't add a separate `created_at`. |

---

## Table count: 30

| Group | Count | Tables |
|---|---|---|
| Config | 6 | categories, skills, departments, seniority_levels, job_positions, employee_levels |
| User | 1 | users |
| Documents | 4 | documents, document_versions, document_skills, document_chunks |
| Class | 2 | classes, class_members |
| Exercise | 4 | exercises, questions, question_options, exercise_documents |
| Submission | 4 | submissions, submission_answers, skill_scores, skill_score_history |
| Daily Quiz | 6 | daily_quiz_configs, daily_quizzes, daily_quiz_questions, daily_quiz_question_options, daily_quiz_submissions, daily_quiz_submission_answers |
| Chat (RAG) | 3 | chat_sessions, chat_messages, chat_message_citations |

> Added in Task 27: `exercise_documents`, plus `chat_sessions.exercise_id` and
> `chat_sessions.document_id`. See §5.4 and §8.1.

---

# GROUP 1 — Config (6 tables)

## 1.1 `categories`

Top-level grouping for skills (e.g., "Technical", "Soft Skills", "Compliance").

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(100) | NO | — | UNIQUE |
| `description` | TEXT | YES | NULL | |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id` · **Unique:** `name` · **No FKs**

## 1.2 `skills`

A measurable competency. Belongs to a category. Carries score range thresholds.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `category_id` | UUID | NO | — | FK → `categories.id` ON DELETE RESTRICT |
| `name` | VARCHAR(100) | NO | — | |
| `description` | TEXT | YES | NULL | |
| `basic_max` | INTEGER | NO | — | Upper bound of the "basic" band |
| `intermediate_max` | INTEGER | NO | — | Upper bound of the "intermediate" band |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **Unique:** `(category_id, name)`
- **FK:** `category_id` → `categories.id` ON DELETE RESTRICT
- **CHECK:** `ck_skills_level_thresholds` — `intermediate_max > basic_max`
- **Index:** `category_id`

> **Banding rule:** `score <= basic_max` → basic · `basic_max < score <= intermediate_max`
> → intermediate · `score > intermediate_max` → advanced. Only the two upper bounds are
> stored; the lower bounds are implied, so they cannot drift out of sync.

> **Migration note:** `b7e4a2f039c1` replaced the original six threshold columns
> (`basic_min`, `intermediate_min`, `intermediate_max`, `advanced_min`, `advanced_max`)
> with these two. `f2b6c8d1e934` then dropped the `DEFAULT 500` that
> `b7e4a2f039c1` had left on `intermediate_max`, since it only existed to backfill
> the column and made a migrated database accept inserts the models reject.

## 1.3 `departments`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(100) | NO | — | UNIQUE |
| `description` | TEXT | YES | NULL | |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id` · **Unique:** `name` · **No FKs**

## 1.4 `seniority_levels`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(50) | NO | — | UNIQUE |
| `rank` | SMALLINT | NO | — | For sorting (1 = lowest) |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id` · **Unique:** `name`, `rank` · **No FKs**

## 1.5 `job_positions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(100) | NO | — | UNIQUE |
| `description` | TEXT | YES | NULL | |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id` · **Unique:** `name` · **No FKs**

> **Design flag:** No `department_id` link — assumes a position can span departments. Mentor confirm.

## 1.6 `employee_levels`

Internal grade/band (e.g., "L1", "L2"). Distinct from seniority.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(50) | NO | — | UNIQUE |
| `rank` | SMALLINT | NO | — | UNIQUE |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id` · **Unique:** `name`, `rank` · **No FKs**

---

# GROUP 2 — User & Auth (1 table)

## 2.1 `users`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `email` | VARCHAR(255) | NO | — | UNIQUE; lowercased at app layer |
| `password_hash` | VARCHAR(255) | NO | — | bcrypt |
| `full_name` | VARCHAR(150) | NO | — | |
| `role` | VARCHAR(20) | NO | `'learner'` | CHECK IN ('admin', 'learner') |
| `department_id` | UUID | YES | NULL | FK → `departments.id` ON DELETE RESTRICT |
| `seniority_id` | UUID | YES | NULL | FK → `seniority_levels.id` ON DELETE RESTRICT |
| `job_position_id` | UUID | YES | NULL | FK → `job_positions.id` ON DELETE RESTRICT |
| `employee_level_id` | UUID | YES | NULL | FK → `employee_levels.id` ON DELETE RESTRICT |
| `is_active` | BOOLEAN | NO | TRUE | |
| `last_login_at` | TIMESTAMPTZ | YES | NULL | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |
| `updated_at` | TIMESTAMPTZ | NO | NOW() | Requires `onupdate=func.now()` in SQLAlchemy model |

- **PK:** `id` · **Unique:** `email`
- **FKs:** all 4 tag FKs ON DELETE RESTRICT
- **Index:** `email`, `role`, `department_id`, `is_active`

---

# GROUP 3 — Documents (4 tables)

## 3.1 `documents`

A training material container. Versions hold actual files.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `title` | VARCHAR(255) | NO | — | |
| `description` | TEXT | YES | NULL | |
| `category_id` | UUID | YES | NULL | FK → `categories.id` ON DELETE SET NULL |
| `active_version_number` | INTEGER | YES | NULL | Service-layer managed; NOT a FK to avoid circular ref |
| `created_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |
| `updated_at` | TIMESTAMPTZ | NO | NOW() | Requires `onupdate=func.now()` in SQLAlchemy model |

- **PK:** `id`
- **FKs:** `category_id` ON DELETE SET NULL; `created_by` ON DELETE SET NULL
- **Index:** `category_id`, `is_active`

## 3.2 `document_versions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `document_id` | UUID | NO | — | FK → `documents.id` ON DELETE CASCADE |
| `version_number` | INTEGER | NO | — | Monotonic per document, starts at 1 |
| `file_url` | VARCHAR(500) | NO | — | R2 object key |
| `file_name` | VARCHAR(255) | NO | — | Original upload filename |
| `file_size_bytes` | BIGINT | NO | — | |
| `mime_type` | VARCHAR(100) | NO | — | CHECK IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') |
| `processing_status` | VARCHAR(20) | NO | `'pending'` | CHECK IN ('pending','processing','ready','failed') |
| `processing_error` | TEXT | YES | NULL | Set if processing_status = 'failed' |
| `change_note` | TEXT | YES | NULL | |
| `uploaded_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `(document_id, version_number)` — composite
- **FKs:** `document_id` ON DELETE CASCADE; `uploaded_by` ON DELETE SET NULL

## 3.3 `document_skills`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `document_id` | UUID | NO | — | FK → `documents.id` ON DELETE CASCADE |
| `skill_id` | UUID | NO | — | FK → `skills.id` ON DELETE RESTRICT |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `(document_id, skill_id)` — composite

## 3.4 `document_chunks`

Stores chunk metadata. Actual vector lives in Chroma/Pinecone; this row holds the external vector ID.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `document_id` | UUID | NO | — | Part of composite FK |
| `version_number` | INTEGER | NO | — | Part of composite FK |
| `chunk_index` | INTEGER | NO | — | 0-based order within document version |
| `content` | TEXT | NO | — | Raw chunk text (also embedded externally) |
| `token_count` | INTEGER | YES | NULL | For cost/debug |
| `vector_id` | VARCHAR(255) | YES | NULL | External ID in Chroma/Pinecone; NULL until embedded |
| `embedded_at` | TIMESTAMPTZ | YES | NULL | When vector was stored externally |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **FK (composite):** `(document_id, version_number)` → `document_versions(document_id, version_number)` ON DELETE CASCADE
- **Unique:** `(document_id, version_number, chunk_index)`
- **Index:** `(document_id, version_number)`, `vector_id`

---

# GROUP 4 — Class & Enrollment (2 tables)

## 4.1 `classes`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(150) | NO | — | |
| `description` | TEXT | YES | NULL | |
| `start_date` | DATE | YES | NULL | |
| `end_date` | DATE | YES | NULL | |
| `created_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id` · **FK:** `created_by` ON DELETE SET NULL
- **CHECK:** `end_date IS NULL OR start_date IS NULL OR end_date >= start_date`
- **Index:** `is_active`

> **Open design question:** Should a class link to a default source document? Right now exam generation requires the admin to pass a document ID every time. Options:
> - **Keep flat (current):** more flexible — one class can use many docs
> - **Add `default_document_id` FK** (nullable): pre-fills the exam generator UI, still overridable
> - **Add `class_documents` join table:** class has a curriculum of N docs
>
> For MVP, keep flat. Adding linkage post-MVP is non-breaking. Flag for mentor.

## 4.2 `class_members`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `class_id` | UUID | NO | — | FK → `classes.id` ON DELETE CASCADE |
| `user_id` | UUID | NO | — | FK → `users.id` ON DELETE CASCADE |
| `enrolled_at` | TIMESTAMPTZ | NO | NOW() | Use instead of `created_at` |

- **PK:** `(class_id, user_id)` — composite
- **Index:** `user_id`

---

# GROUP 5 — Exercise & Questions (4 tables)

## 5.1 `exercises`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `class_id` | UUID | NO | — | FK → `classes.id` ON DELETE RESTRICT |
| `title` | VARCHAR(255) | NO | — | |
| `description` | TEXT | YES | NULL | |
| `start_time` | TIMESTAMPTZ | NO | — | |
| `end_time` | TIMESTAMPTZ | NO | — | |
| `duration_minutes` | INTEGER | NO | — | |
| `pass_score` | INTEGER | NO | — | |
| `total_points` | INTEGER | NO | — | Denorm sum of question points |
| `created_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **FKs:** `class_id` ON DELETE RESTRICT; `created_by` ON DELETE SET NULL
- **CHECK:** `end_time > start_time`, `pass_score >= 0`, `pass_score <= total_points`
- **Index:** `class_id`, `start_time`, `end_time`

> **Service contract for `total_points` (mandatory):**
> `total_points` is denormalized. The CHECK `pass_score <= total_points` only catches violations at insert/update of the exercise row, NOT when questions change underneath it. The exercise service MUST recompute `total_points = SUM(questions.points)` and re-validate `pass_score <= total_points` whenever:
> - A question is added to the exercise
> - A question's `points` value is edited
> - A question is deleted from the exercise
>
> If `pass_score` would exceed the new `total_points`, the operation must be rejected. For MVP, assume exams are immutable after generation — but the service must still enforce this on the generation path.

> **Removed from v1:** `allow_retries` / `max_attempts` — retry mechanics are DEPRIORITIZED.

## 5.2 `questions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `exercise_id` | UUID | NO | — | FK → `exercises.id` ON DELETE CASCADE |
| `source_document_id` | UUID | YES | NULL | Part of composite FK |
| `source_version_number` | INTEGER | YES | NULL | Part of composite FK |
| `question_text` | TEXT | NO | — | |
| `explanation` | TEXT | YES | NULL | |
| `points` | INTEGER | NO | 1 | |
| `order_index` | SMALLINT | NO | — | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **FK:** `exercise_id` ON DELETE CASCADE
- **FK (composite, nullable):** `(source_document_id, source_version_number)` → `document_versions(document_id, version_number)` ON DELETE SET NULL
- **Unique:** `(exercise_id, order_index)`
- **Index:** `exercise_id`

## 5.3 `question_options`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `question_id` | UUID | NO | — | FK → `questions.id` ON DELETE CASCADE |
| `option_label` | VARCHAR(5) | NO | — | 'A', 'B', 'C', 'D' |
| `option_text` | TEXT | NO | — | |
| `is_correct` | BOOLEAN | NO | FALSE | Service enforces exactly one TRUE per question |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **FK:** `question_id` ON DELETE CASCADE
- **Unique:** `(question_id, option_label)`
- **Index:** `question_id`

---

## 5.4 `exercise_documents`

Which document versions fed exam generation. Per-question provenance
(`questions.source_document_id`) is only populated when a single document was used,
so for a multi-document exam this table is the **only** link back to the source
material — the RAG chatbot reads it to scope retrieval when explaining wrong answers.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `exercise_id` | UUID | NO | — | PK part 1 · FK → `exercises.id` ON DELETE CASCADE |
| `document_id` | UUID | NO | — | PK part 2 · part of composite FK |
| `version_number` | INTEGER | NO | — | Part of composite FK |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `(exercise_id, document_id)` — one version per document per exercise
- **FK (composite):** `(document_id, version_number)` → `document_versions(document_id, version_number)` ON DELETE CASCADE
- **Index:** `exercise_id`

> **Service contract:** `ExamService.generate()` MUST write one row per source
> document, whether there is one source or ten. The version recorded is the
> document's active version at generation time, not the current one.

---

# GROUP 6 — Submission & Scoring (4 tables)

## 6.1 `submissions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `user_id` | UUID | NO | — | FK → `users.id` ON DELETE RESTRICT |
| `exercise_id` | UUID | NO | — | FK → `exercises.id` ON DELETE RESTRICT |
| `attempt_number` | INTEGER | NO | 1 | Always 1 in MVP; reserved for v2 retries |
| `started_at` | TIMESTAMPTZ | NO | NOW() | |
| `submitted_at` | TIMESTAMPTZ | YES | NULL | NULL = in progress |
| `time_taken_seconds` | INTEGER | YES | NULL | Computed at submit |
| `score` | INTEGER | YES | NULL | NULL until graded |
| `is_passed` | BOOLEAN | YES | NULL | NULL until graded |
| `is_late` | BOOLEAN | NO | FALSE | TRUE if submitted_at > exercise.end_time |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id` · **FKs:** as listed (RESTRICT to preserve history)
- **Unique:** `(user_id, exercise_id, attempt_number)`
- **Index:** `user_id`, `exercise_id`

## 6.2 `submission_answers`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `submission_id` | UUID | NO | — | FK → `submissions.id` ON DELETE CASCADE |
| `question_id` | UUID | NO | — | FK → `questions.id` ON DELETE RESTRICT |
| `selected_option_id` | UUID | YES | NULL | FK → `question_options.id` ON DELETE SET NULL; NULL = skipped |
| `is_correct` | BOOLEAN | YES | NULL | NULL if skipped or ungraded |
| `points_earned` | INTEGER | NO | 0 | |
| `answered_at` | TIMESTAMPTZ | NO | NOW() | Replaces `created_at` for this table — answer tables use `answered_at` |

- **PK:** `(submission_id, question_id)` — composite

## 6.3 `skill_scores`

Current cumulative score per user per skill. Used by spider chart dashboard.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `user_id` | UUID | NO | — | FK → `users.id` ON DELETE CASCADE |
| `skill_id` | UUID | NO | — | FK → `skills.id` ON DELETE RESTRICT |
| `cumulative_score` | INTEGER | NO | 0 | |
| `current_level` | VARCHAR(20) | NO | `'basic'` | CHECK IN ('basic','intermediate','advanced'); denorm |
| `last_updated_at` | TIMESTAMPTZ | NO | NOW() | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `(user_id, skill_id)` — composite
- **Index:** `user_id`, `skill_id`

## 6.4 `skill_score_history`

Audit trail of every score change.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `user_id` | UUID | NO | — | FK → `users.id` ON DELETE CASCADE |
| `skill_id` | UUID | NO | — | FK → `skills.id` ON DELETE RESTRICT |
| `score_delta` | INTEGER | NO | — | Can be negative |
| `source_type` | VARCHAR(20) | NO | — | CHECK IN ('exam','daily_quiz') |
| `submission_id` | UUID | YES | NULL | FK → `submissions.id` ON DELETE SET NULL |
| `daily_quiz_submission_id` | UUID | YES | NULL | FK → `daily_quiz_submissions.id` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **CHECK (full text — write exactly as below in the migration):**
  ```sql
  CHECK (
    (source_type = 'exam' AND submission_id IS NOT NULL AND daily_quiz_submission_id IS NULL)
    OR
    (source_type = 'daily_quiz' AND daily_quiz_submission_id IS NOT NULL AND submission_id IS NULL)
  )
  ```
- **Index:** `(user_id, skill_id)`, `created_at`

> Without this CHECK, you could insert a row with `source_type='exam'` but no `submission_id` — Postgres would not complain, but the audit trail would be broken.

---

# GROUP 7 — Daily Quiz (6 tables)

## 7.1 `daily_quiz_configs`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | VARCHAR(150) | NO | — | |
| `prompt` | TEXT | NO | — | Instructions for AI generator |
| `source_document_id` | UUID | NO | — | FK → `documents.id` ON DELETE RESTRICT |
| `target_department_id` | UUID | YES | NULL | FK → `departments.id` ON DELETE SET NULL; NULL = any |
| `target_seniority_id` | UUID | YES | NULL | FK → `seniority_levels.id` ON DELETE SET NULL |
| `target_job_position_id` | UUID | YES | NULL | FK → `job_positions.id` ON DELETE SET NULL |
| `target_employee_level_id` | UUID | YES | NULL | FK → `employee_levels.id` ON DELETE SET NULL |
| `start_date` | DATE | NO | — | First date a quiz is generated |
| `end_date` | DATE | YES | NULL | NULL = open-ended |
| `push_time` | TIME | NO | — | Local wall-clock time, NO timezone — paired with `timezone` column |
| `timezone` | VARCHAR(50) | NO | `'Asia/Ho_Chi_Minh'` | IANA timezone name (e.g., 'Asia/Ho_Chi_Minh', 'Asia/Singapore') |
| `expiry_hours` | INTEGER | NO | 24 | How long a quiz remains submittable |
| `question_count` | SMALLINT | NO | 5 | Questions per generated quiz |
| `created_by` | UUID | YES | NULL | FK → `users.id` ON DELETE SET NULL |
| `is_active` | BOOLEAN | NO | TRUE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **CHECK:** `end_date IS NULL OR end_date >= start_date`, `question_count > 0`, `expiry_hours > 0`
- **Index:** `is_active`, all 4 target FK columns

> **Why TIME + timezone (not TIMETZ):**
> Postgres `TIMETZ` stores a fixed UTC offset, not a timezone. It cannot handle DST transitions or future timezone rule changes. The Postgres docs themselves discourage it. The standard pattern (used by Slack, Google Calendar, etc.) is: store local wall-clock time + IANA timezone name. The Celery scheduler combines them via `pytz` or `zoneinfo` to compute the next UTC fire time. This is robust across all timezones, DST changes, and policy shifts.

> **Audience targeting limitation:** 4 nullable single-value FKs = AND logic only. Cannot express "Engineering OR Sales". Fine for MVP since notifications/Celery push are DEPRIORITIZED. Replace with `daily_quiz_config_audiences(config_id, dimension, value_id)` if it expands.

## 7.2 `daily_quizzes`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `config_id` | UUID | NO | — | FK → `daily_quiz_configs.id` ON DELETE RESTRICT |
| `quiz_date` | DATE | NO | — | Date this quiz is for |
| `generated_at` | TIMESTAMPTZ | NO | NOW() | |
| `expires_at` | TIMESTAMPTZ | NO | — | UTC timestamp computed from `quiz_date` + `push_time` + `timezone` + `expiry_hours` |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **Unique:** `(config_id, quiz_date)` — one quiz per config per day
- **Index:** `quiz_date`, `expires_at`

## 7.3 `daily_quiz_questions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `daily_quiz_id` | UUID | NO | — | FK → `daily_quizzes.id` ON DELETE CASCADE |
| `source_document_id` | UUID | YES | NULL | Part of composite FK |
| `source_version_number` | INTEGER | YES | NULL | Part of composite FK |
| `question_text` | TEXT | NO | — | |
| `explanation` | TEXT | YES | NULL | |
| `points` | INTEGER | NO | 1 | |
| `order_index` | SMALLINT | NO | — | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **FK:** `daily_quiz_id` → `daily_quizzes.id` ON DELETE CASCADE
- **FK (composite, nullable):** `(source_document_id, source_version_number)` → `document_versions(...)` ON DELETE SET NULL
- **Unique:** `(daily_quiz_id, order_index)`
- **Index:** `daily_quiz_id` — every quiz load filters by this; explicit index required to avoid full table scan

## 7.4 `daily_quiz_question_options`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `daily_quiz_question_id` | UUID | NO | — | FK → `daily_quiz_questions.id` ON DELETE CASCADE |
| `option_label` | VARCHAR(5) | NO | — | |
| `option_text` | TEXT | NO | — | |
| `is_correct` | BOOLEAN | NO | FALSE | |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **Unique:** `(daily_quiz_question_id, option_label)`
- **Index:** `daily_quiz_question_id`

## 7.5 `daily_quiz_submissions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `daily_quiz_id` | UUID | NO | — | FK → `daily_quizzes.id` ON DELETE RESTRICT |
| `user_id` | UUID | NO | — | FK → `users.id` ON DELETE RESTRICT |
| `score` | INTEGER | NO | 0 | |
| `time_taken_seconds` | INTEGER | YES | NULL | |
| `submitted_at` | TIMESTAMPTZ | NO | NOW() | |
| `is_late` | BOOLEAN | NO | FALSE | TRUE if submitted_at > daily_quizzes.expires_at |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `id`
- **Unique:** `(daily_quiz_id, user_id)`
- **Index:** `user_id`, `daily_quiz_id`

## 7.6 `daily_quiz_submission_answers`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `daily_quiz_submission_id` | UUID | NO | — | FK → `daily_quiz_submissions.id` ON DELETE CASCADE |
| `daily_quiz_question_id` | UUID | NO | — | FK → `daily_quiz_questions.id` ON DELETE RESTRICT |
| `selected_option_id` | UUID | YES | NULL | FK → `daily_quiz_question_options.id` ON DELETE SET NULL |
| `is_correct` | BOOLEAN | YES | NULL | |
| `points_earned` | INTEGER | NO | 0 | |
| `answered_at` | TIMESTAMPTZ | NO | NOW() | Replaces `created_at` — see Global Conventions |

- **PK:** `(daily_quiz_submission_id, daily_quiz_question_id)` — composite

---

# GROUP 8 — Chat (RAG) (3 tables)

The AI Mentor Chatbot is in MVP. Scoped strictly to uploaded documents. Citations link bot answers back to specific chunks.

## 8.1 `chat_sessions`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `user_id` | UUID | NO | — | FK → `users.id` ON DELETE CASCADE |
| `exercise_id` | UUID | YES | NULL | FK → `exercises.id` ON DELETE SET NULL. Set when the chat explains an exam |
| `document_id` | UUID | YES | NULL | FK → `documents.id` ON DELETE SET NULL. Set when the chat is pinned to one document |
| `title` | VARCHAR(255) | YES | NULL | Auto-set on first message — see service rule below |
| `is_active` | BOOLEAN | NO | TRUE | Soft delete |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |
| `updated_at` | TIMESTAMPTZ | NO | NOW() | Requires `onupdate=func.now()` in SQLAlchemy model |

- **PK:** `id`
- **FK:** `user_id` ON DELETE CASCADE
- **Index:** `user_id`, `updated_at` (for "recent chats" lists), `exercise_id`, `document_id`

> **Retrieval scope rule:** the chat service resolves scope in this order —
> `exercise_id` set → every `(document_id, version_number)` in
> `exercise_documents` for that exercise; else `document_id` set → that one
> document's active version; else the whole active corpus. The two columns are
> mutually exclusive in practice.

> **Service contract for `title`:** When the first user message is inserted into a session, the chat service MUST populate `title` in the same transaction. Use either (a) the first ~60 chars of the user message, or (b) a one-shot LLM summarization call. Sessions must never have NULL `title` after the first message — without enforcement, the UI shows blank entries in the "recent chats" sidebar.

## 8.2 `chat_messages`

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `session_id` | UUID | NO | — | FK → `chat_sessions.id` ON DELETE CASCADE |
| `role` | VARCHAR(20) | NO | — | CHECK IN ('user', 'assistant') |
| `content` | TEXT | NO | — | |
| `token_count` | INTEGER | YES | NULL | For cost tracking |
| `model_name` | VARCHAR(50) | YES | NULL | e.g., 'gpt-4o' — assistant only |
| `latency_ms` | INTEGER | YES | NULL | Generation latency — assistant only |
| `created_at` | TIMESTAMPTZ | NO | NOW() | Also serves as message ordering |

- **PK:** `id`
- **FK:** `session_id` ON DELETE CASCADE
- **Index:** `session_id`, `created_at`

> **Error handling:** If LLM generation fails, don't insert an assistant message at all. Surface the error to the client at the API layer. Simpler than tri-state with an `is_error` flag.

## 8.3 `chat_message_citations`

Which chunks an assistant message cited. Many-to-many.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `chat_message_id` | UUID | NO | — | FK → `chat_messages.id` ON DELETE CASCADE |
| `document_chunk_id` | UUID | NO | — | FK → `document_chunks.id` ON DELETE RESTRICT |
| `relevance_score` | REAL | YES | NULL | Vector similarity score (0.0 – 1.0) |
| `created_at` | TIMESTAMPTZ | NO | NOW() | |

- **PK:** `(chat_message_id, document_chunk_id)` — composite
- **Index:** `chat_message_id`, `document_chunk_id`

---

# Mentor Review Checklist

| # | Decision | My choice | Alternative | Why review |
|---|---|---|---|---|
| 1 | Skill score thresholds | 6 columns on `skills` | `skill_levels` table | Rigid if 3 levels stay forever |
| 2 | Job position → department link | Flat (no FK) | Add `department_id` to `job_positions` | Whether positions span departments |
| 3 | User tag FKs nullable | All 4 nullable | NOT NULL for learners | Business rule, not DB rule |
| 4 | Question source tracking | Composite FK to `document_versions` | FK to `documents` only | Audit rigor vs simplicity |
| 5 | Skill score history `source_id` | Two typed FKs + CHECK | Polymorphic UUID | DB integrity vs original spec |
| 6 | `cumulative_score → current_level` | Denormalized | Computed on read | Read perf vs write complexity |
| 7 | `exercises.total_points` | Denormalized + explicit service contract | SUM at read | Same trade-off |
| 8 | Exercise retries | One attempt only in MVP | `allow_retries` flag | Matches DEPRIORITIZE scope |
| 9 | Daily quiz audience | 4 nullable single-value FKs (AND) | Join table for OR / multi-select | Matches MVP scope |
| 10 | Daily quiz options 3NF | Separate tables (both sides) | JSONB | 3NF consistency |
| 11 | `documents.active_version_number` | Plain INTEGER, app-validated | Composite FK back to versions | Avoids circular-ref insert |
| 12 | `document_chunks` | Postgres mirror of chunk text + external vector_id | Chroma-only | Enables citation + re-indexing |
| 13 | MIME type restriction | CHECK to PDF + DOCX | Open mime_type | Matches Discussion 2 |
| 14 | Chat error handling | Don't insert message on failure | `is_error` flag | Simpler |
| 15 | Enums | `VARCHAR` + CHECK | Postgres ENUM | Easier Alembic |
| 16 | `updated_at` placement | Only where rows mutate | Everywhere | Cleaner |
| 17 | **`push_time` storage (NEW)** | `TIME` + separate `timezone` VARCHAR | `TIMETZ` (fixed UTC offset) | TIMETZ can't do DST or rule changes |
| 18 | **Class ↔ document link (NEW)** | None (flat) | `default_document_id` FK on `classes`, or `class_documents` join | Whether classes have a curriculum |

---

# What's NOT in the schema (deliberately, per MVP scope)

| Feature | Status | Why excluded |
|---|---|---|
| Roles/permissions tables | DEPRIORITIZE | Simple 2-value `users.role` enum is enough |
| Notifications table | DEPRIORITIZE | No Celery scheduled push in MVP |
| Class approval workflow | CUT | No `class_members.approval_status` |
| Leaderboard | CUT | Aggregations over `skill_scores` cover this later |
| Calendar / streak | CUT | No date-based tracking tables |
| AI Learning Advice | CUT | No `recommendations` table |
| Question set history | DEPRIORITIZE | No `question_versions` or `question_pools` |
| Clone class | CUT | No `cloned_from_id` reference |
| Import/export logs | CUT | No `import_jobs` table |

---

# Pre-coding checklist (do these before writing any SQLAlchemy code)

- [ ] CHECK constraint on `skill_score_history` is written in full (see 6.4)
- [ ] `submission_answers.answered_at` and `daily_quiz_submission_answers.answered_at` both `NOT NULL DEFAULT NOW()`
- [ ] Index on `daily_quiz_questions.daily_quiz_id` is explicit in the model
- [ ] `daily_quiz_configs.push_time` is `TIME` (not TIMETZ); `timezone` column added with IANA default
- [ ] Every `updated_at` column uses `server_default=func.now(), onupdate=func.now()` in SQLAlchemy
- [ ] `exercises` service has the `total_points` recompute method documented and tested
- [ ] Mentor signed off on Decision #18 (class↔document link)
- [ ] Mentor confirmed Decisions #1, #2, #3, #17
