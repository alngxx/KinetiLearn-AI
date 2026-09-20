# Architecture

## Directory structure

```
KinetiLearn/
├── backend/
├── frontend/
├── docs/
│   ├── DECISIONS.md
│   ├── SCHEMA.md
│   └── ARCHITECTURE.md
├── docker-compose.yml
├── CLAUDE.md
└── README.md
```

```
backend/
├── alembic/
│   ├── versions/    (11 migration files)
│   ├── env.py
│   └── script.py.mako
├── app/
│   ├── core/
│   │   ├── config.py
│   │   ├── crud.py
│   │   ├── database.py
│   │   ├── dependencies.py
│   │   ├── llm.py
│   │   ├── security.py
│   │   ├── storage.py
│   │   └── vectorstore.py
│   ├── modules/
│   │   ├── auth/          (models.py, router.py, schemas.py, service.py)
│   │   ├── chat/          (models.py, router.py, schemas.py, service.py)
│   │   ├── classes/       (models.py, router.py, schemas.py, service.py)
│   │   ├── config/        (models.py, router.py, schemas.py, service.py)
│   │   ├── documents/     (models.py, router.py, schemas.py, service.py)
│   │   ├── exams/         (models.py, router.py, schemas.py, service.py)
│   │   ├── quiz/          (models.py, router.py, schemas.py, service.py)
│   │   ├── scoring/       (models.py, router.py, schemas.py, service.py)
│   │   └── submissions/   (models.py, router.py, schemas.py, service.py)
│   └── main.py
├── scripts/       (seed_config.py, seed_users.py, seed_classes.py, seed_content.py, and 3 one-off migration/backfill scripts)
├── tests/         (one folder per module, mirroring app/modules/)
└── worker/        (db.py, processing.py, tasks.py - the Celery side)
```

```
frontend/
├── e2e/
├── public/
├── src/
│   ├── components/    (shared UI: buttons, dialogs, form fields, shadcn primitives)
│   ├── layouts/       (AdminLayout, LearnerLayout)
│   ├── lib/           (apiClient, sseClient, query client, small hooks)
│   ├── modules/
│   │   ├── auth/
│   │   ├── chat/
│   │   ├── classes/
│   │   ├── config/
│   │   ├── daily-quiz/
│   │   ├── daily-quiz-configs/
│   │   ├── documents/
│   │   ├── exams/
│   │   ├── learner-home/
│   │   ├── learner-skills/
│   │   ├── scoring/
│   │   ├── submissions/
│   │   ├── theme/
│   │   └── users/
│   ├── test/
│   ├── types/         (api.ts, generated from the backend's OpenAPI schema)
│   ├── App.tsx
│   └── main.tsx
└── package.json
```

Each frontend module folder holds whatever that feature needs - usually an
`api.ts`, a `queries.ts`, and one or more page/dialog components - but the
shape isn't as rigid as the backend's. `theme` has no `api.ts` at all, and
`learner-skills` is just page components. The backend's four-file shape, by
contrast, holds with zero exceptions across all nine modules.

## Why a modular monolith, not a plain monolith

The backend really is split by feature, consistently: every one of the nine
modules under `app/modules/` owns its own `models.py`, `router.py`,
`schemas.py`, and `service.py`, all wired into one FastAPI app in `main.py`,
all backed by one shared `app/core` (one DB session, one JWT layer, one CRUD
helper set, one LLM/vectorstore client). No module is missing a piece, and no
module has extra pieces bolted on. That part is real.

What isn't there is enforced isolation between modules. Most cross-module
reads go straight at another module's SQLAlchemy models rather than through
its service: `chat` imports `documents`, `exams`, and `submissions` models
directly to scope RAG retrieval; `classes` imports `auth`, `config`,
`documents`, `exams`, and `submissions` models; `documents` imports `chat`,
`config`, `classes`, `exams`, and `quiz` models. Only a couple of cross-module
calls go through an actual owning-module function -
`classes.service.assert_class_member` and `scoring.service.SkillScoringService`
are the two real ones. So this is a modular monolith in the file-organization
sense: one process, one database, one deploy, features grouped into folders
instead of piled into a shared `models.py` and `routes.py`. For a project this
size, that's what actually matters - each folder is a place to go understand
one feature without reading the whole app, and there's no shared file for
every change to collide on. It is not, as it stands, a set of boundaries that
would make splitting into separate services easy - the direct cross-module
queries would have to become real APIs first.

## More detail

- [DECISIONS.md](DECISIONS.md) - specific engineering decisions and bug fixes, each with problem, fix, and why.
- [SCHEMA.md](SCHEMA.md) - the full database schema, table by table.
