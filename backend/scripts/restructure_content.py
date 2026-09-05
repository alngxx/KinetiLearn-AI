"""One-off Tier 2 restructure: rename 4 shell classes, delete the 4 generated exams
and 7 generated documents from the prior Tier 2 run, retire "AI Tooling
Enablement", and create 4 new Technical classes for Engineering & Development.

Exam/document deletion goes through the real HTTP API so Chroma vectors and R2
files are cleaned up properly. Class renames, retirement, creation and enrolment
go through the service layer directly, same pattern as seed_classes.py.

Run from backend/ with the venv active, against a running docker compose stack:
  python -m scripts.restructure_content
"""
import asyncio
import os
import sys

import httpx
from sqlalchemy import delete, func, select

from app.core.database import SessionLocal
from app.modules.auth.models import User
from app.modules.classes.models import ClassMember
from app.modules.classes.schemas import BulkAddMembersRequest, ClassCreate, ClassUpdate
from app.modules.classes.service import ClassService
from app.modules.config.service import DepartmentService
from scripts.seed_users import ADMIN_PASSWORD

BASE_URL = os.environ.get("KINETILEARN_BASE_URL", "http://localhost:8000")
ADMIN_EMAIL = "admin@kinetilearn.com"

ENGINEERING = "Engineering & Development"

RENAMES = [
    ("Design Systems & Accessibility Basics", "Design Systems & Accessibility"),
    ("HR Programs & Employee Relations", "HR & Employee Relations"),
    ("Sales Enablement & Product Messaging", "Sales Enablement"),
    ("Financial Compliance & Data Privacy", "Finance & Legal Compliance"),
]

EXAM_CLASS_NAMES = [
    "Communication & Teamwork",
    "Data Privacy & Compliance",
    "Workplace Safety",
    "AI Tooling Enablement",
]

DOCUMENT_TITLES = [
    "Everyday Workplace Communication",
    "Working in a Team",
    "Personal Data Protection at Work",
    "Handling Data in Day-to-Day Work",
    "Workplace Safety Fundamentals",
    "Claude and Claude Code at KinetiLearn",
    "Working Effectively with Claude Code on the KinetiLearn Codebase",
]

RETIRE_CLASS = "AI Tooling Enablement"

NEW_CLASSES = [
    (
        "Claude 101",
        "Everyday use of Claude - prompting, projects, artifacts, and the tools "
        "it can connect to. Starting point for anyone using Claude at work.",
    ),
    (
        "Introduction to Claude Cowork",
        "Handing off multi-step work to Claude instead of doing it turn by turn "
        "- setup, standing context, and how to review what comes back.",
    ),
    (
        "Claude Code in Action",
        "Running longer Claude Code sessions with confidence - steering, a "
        "CLAUDE.md that actually gets followed, permission modes, and "
        "verifying unsupervised work.",
    ),
    (
        "Model Context Protocol: Advanced Topics",
        "Sampling, notifications, and transport choices for engineers building "
        "real MCP servers, past the basics.",
    ),
]

NEW_CLASS_CATEGORY = "Technical"


def fail(message: str) -> None:
    print(f"ABORT: {message}")
    sys.exit(1)


def login(client: httpx.Client) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json = {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    if response.status_code != 200:
        fail(f"login failed: {response.status_code} {response.text}")
    return response.json()["access_token"]


async def main() -> None:
    async with SessionLocal() as db:
        class_service = ClassService(db)
        by_name = {c.name: c for c in await class_service.get_all(include_inactive = True)}

        # Step 1: rename the 4 shell classes, matching each by exact current name.
        renamed = 0
        for old_name, new_name in RENAMES:
            matches = [c for c in by_name.values() if c.name == old_name]
            if len(matches) != 1:
                fail(f"expected exactly 1 class named '{old_name}', found {len(matches)}")
            row = matches[0]
            await class_service.update(row.id, ClassUpdate(name = new_name))
            renamed += 1
        by_name = {c.name: c for c in await class_service.get_all(include_inactive = True)}

        # Resolve the 4 exam-bearing classes by their current actual names.
        exam_class_ids = {}
        for name in EXAM_CLASS_NAMES:
            matches = [c for c in by_name.values() if c.name == name]
            if len(matches) != 1:
                fail(f"expected exactly 1 class named '{name}', found {len(matches)}")
            exam_class_ids[name] = matches[0].id

    # Steps 3-4: delete the 4 exams and 7 documents through the real HTTP API.
    with httpx.Client(base_url = BASE_URL, timeout = 30.0) as client:
        token = login(client)
        client.headers["Authorization"] = f"Bearer {token}"

        exercises_deleted = 0
        for class_name, class_id in exam_class_ids.items():
            response = client.get(f"/api/v1/classes/{class_id}")
            if response.status_code != 200:
                fail(f"GET class {class_id} failed: {response.status_code} {response.text}")
            exercises = response.json()["exercises"]
            if len(exercises) != 1:
                fail(
                    f"expected exactly 1 exercise for class '{class_name}', "
                    f"found {len(exercises)}"
                )
            exercise_id = exercises[0]["id"]
            response = client.delete(f"/api/v1/exams/{exercise_id}")
            if response.status_code != 200:
                fail(
                    f"deleting exercise {exercise_id} ('{class_name}') failed: "
                    f"{response.status_code} {response.text}"
                )
            exercises_deleted += 1

        response = client.get("/api/v1/documents")
        if response.status_code != 200:
            fail(f"GET /api/v1/documents failed: {response.status_code} {response.text}")
        documents_by_title = {d["title"]: d for d in response.json()}

        documents_deleted = 0
        for title in DOCUMENT_TITLES:
            doc = documents_by_title.get(title)
            if doc is None:
                fail(f"document '{title}' not found")
            response = client.delete(f"/api/v1/documents/{doc['document_id']}")
            if response.status_code != 200:
                fail(
                    f"deleting document '{title}' ({doc['document_id']}) failed: "
                    f"{response.status_code} {response.text}"
                )
            body = response.json()
            if body.get("cleanup_warning"):
                print(f"  WARNING deleting '{title}': {body['cleanup_warning']}")
            documents_deleted += 1

    # Steps 6-8: retire AI Tooling Enablement, create 4 new classes, enrol
    # Engineering & Development into them.
    async with SessionLocal() as db:
        class_service = ClassService(db)
        department_service = DepartmentService(db)

        by_name = {c.name: c for c in await class_service.get_all(include_inactive = True)}
        retire_matches = [c for c in by_name.values() if c.name == RETIRE_CLASS]
        if len(retire_matches) != 1:
            fail(f"expected exactly 1 class named '{RETIRE_CLASS}', found {len(retire_matches)}")
        retire_row = retire_matches[0]

        await class_service.deactivate(retire_row.id)

        engineering = next(
            (d for d in await department_service.get_all() if d.name == ENGINEERING),
            None,
        )
        if engineering is None:
            fail(f"department '{ENGINEERING}' not found")

        result = await db.execute(
            select(func.count())
            .select_from(ClassMember)
            .where(
                ClassMember.class_id == retire_row.id,
                ClassMember.user_id.in_(
                    select(User.id).where(User.department_id == engineering.id)
                ),
            )
        )
        stale_count = result.scalar_one()
        await db.execute(
            delete(ClassMember).where(
                ClassMember.class_id == retire_row.id,
                ClassMember.user_id.in_(
                    select(User.id).where(User.department_id == engineering.id)
                ),
            )
        )
        await db.commit()

        result = await db.execute(
            select(User.id).where(func.lower(User.email) == ADMIN_EMAIL)
        )
        creator_id = result.scalar_one_or_none()
        if creator_id is None:
            fail(f"{ADMIN_EMAIL} not found")

        by_name = {c.name.lower(): c for c in await class_service.get_all(include_inactive = True)}
        created = skipped = 0
        new_class_ids = []
        for name, description in NEW_CLASSES:
            existing = by_name.get(name.lower())
            if existing is not None:
                new_class_ids.append(existing.id)
                skipped += 1
                continue
            row = await class_service.create(
                ClassCreate(name = name, description = description), creator_id
            )
            new_class_ids.append(row.id)
            created += 1

        added = calls = 0
        for class_id in new_class_ids:
            response = await class_service.bulk_add_members(
                class_id, BulkAddMembersRequest(department_id = engineering.id)
            )
            added += response.added
            calls += 1

    print("Restructure summary:")
    print(f"  Classes renamed: {renamed}")
    print(f"  Exercises deleted: {exercises_deleted}")
    print(f"  Documents deleted: {documents_deleted}")
    print(f"  '{RETIRE_CLASS}' deactivated, {stale_count} stale class_members rows removed")
    print(f"  New classes: {created} created, {skipped} skipped")
    print(f"  Enrolments added: {added} over {calls} calls")


if __name__ == "__main__":
    asyncio.run(main())
