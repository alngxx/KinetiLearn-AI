"""Seed the 12 demo classes and enrol every learner into exactly four of them
(Engineering & Development learners end up in seven, via the 4 Claude classes).

Idempotent: classes are matched by lower(name) because classes.name has no unique
constraint, and bulk_add_members diffs against existing membership. Requires
scripts.seed_config and scripts.seed_users to have run first.

Run from backend/ with the venv active:  python -m scripts.seed_classes
"""
import asyncio
import sys

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.modules.auth.models import User
from app.modules.classes.models import Class
from app.modules.classes.schemas import BulkAddMembersRequest, ClassCreate
from app.modules.classes.service import ClassService
from app.modules.config.service import DepartmentService

ENGINEERING = "Engineering & Development"
PRODUCT = "Product Management"
DESIGN = "Design (UI/UX)"
SALES = "Sales & Marketing"
HR = "Human Resources"
FINANCE = "Finance & Legal"

ALL_DEPARTMENTS = [ENGINEERING, PRODUCT, DESIGN, SALES, HR, FINANCE]

CREATOR_EMAIL = "admin@kinetilearn.com"

# name -> the departments whose learners are enrolled. A company-wide class lists
# every department because bulk_add_members requires at least one filter.
CLASSES = [
    ("Communication & Teamwork", ALL_DEPARTMENTS),
    ("Data Privacy & Compliance", ALL_DEPARTMENTS),
    ("Workplace Safety", ALL_DEPARTMENTS),
    ("Product Discovery Fundamentals", [PRODUCT]),
    ("Design Systems & Accessibility", [DESIGN]),
    ("Sales Enablement", [SALES]),
    ("HR & Employee Relations", [HR]),
    ("Finance & Legal Compliance", [FINANCE]),
    ("Claude 101", [ENGINEERING]),
    ("Introduction to Claude Cowork", [ENGINEERING]),
    ("Claude Code in Action", [ENGINEERING]),
    ("Model Context Protocol: Advanced Topics", [ENGINEERING]),
]

# Left over from feature testing. "CIaude" is a real typo in the existing row
# (capital I, not l) — matched as-is rather than corrected.
# "AI Tooling Enablement" was retired and replaced by the 4 Claude classes above.
RETIRED_CLASSES = ["CS Fundamentals", "CIaude AI Training", "AI Tooling Enablement"]


async def main():
    async with SessionLocal() as db:
        departments = {d.name.lower(): d.id for d in await DepartmentService(db).get_all()}
        missing = [n for n in ALL_DEPARTMENTS if n.lower() not in departments]
        if missing:
            print("ERROR: missing departments — run scripts.seed_config first:")
            for name in missing:
                print(f"  - {name}")
            sys.exit(1)

        result = await db.execute(
            select(User.id).where(func.lower(User.email) == CREATOR_EMAIL)
        )
        creator_id = result.scalar_one_or_none()
        if creator_id is None:
            print(f"ERROR: {CREATOR_EMAIL} not found — run scripts.seed_users first.")
            sys.exit(1)

        service = ClassService(db)
        by_name = {c.name.lower(): c.id for c in await service.get_all(include_inactive = True)}

        created = skipped = 0
        for name, _ in CLASSES:
            if name.lower() in by_name:
                skipped += 1
                continue
            row = await service.create(ClassCreate(name = name), creator_id)
            by_name[name.lower()] = row.id
            created += 1

        active = {c.id for c in await service.get_all()}
        retired = 0
        for name in RETIRED_CLASSES:
            class_id = by_name.get(name.lower())
            if class_id is None or class_id not in active:
                continue
            await service.deactivate(class_id)
            retired += 1

        added = calls = 0
        for name, department_names in CLASSES:
            class_id = by_name[name.lower()]
            for department_name in department_names:
                response = await service.bulk_add_members(
                    class_id,
                    BulkAddMembersRequest(
                        department_id = departments[department_name.lower()]
                    ),
                )
                added += response.added
                calls += 1

    print(
        f"Seed summary: {created} classes created, {skipped} skipped, "
        f"{retired} retired, {added} enrolments added over {calls} calls"
    )


if __name__ == "__main__":
    asyncio.run(main())
