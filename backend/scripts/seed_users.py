"""Seed dev users (1 admin + 3 learners) through the existing UserService.

Idempotent: a user is only created when no row with that email exists, so
running this repeatedly is safe. Requires the config seed data to be present
first (run scripts.seed_config) because users reference config FKs by name.

Run from backend/ with the venv active:  python -m scripts.seed_users
"""
import asyncio
import sys

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.modules.auth.models import User
from app.modules.auth.schemas import UserCreate
from app.modules.auth.service import UserService
from app.modules.config.service import (
    DepartmentService,
    EmployeeLevelService,
    JobPositionService,
    SeniorityLevelService,
)

USERS = [
    {
        "full_name": "Admin User",
        "email": "admin@kinetilearn.com",
        "password": "admin1234",
        "role": "admin",
        "department": "Engineering",
        "seniority": "Senior",
        "job_position": "Software Engineer",
        "employee_level": "L3",
    },
    {
        "full_name": "Alice Nguyen",
        "email": "alice@kinetilearn.com",
        "password": "learner1234",
        "role": "learner",
        "department": "Sales",
        "seniority": "Junior",
        "job_position": "Sales Executive",
        "employee_level": "L1",
    },
    {
        "full_name": "Bob Tran",
        "email": "bob@kinetilearn.com",
        "password": "learner1234",
        "role": "learner",
        "department": "HR",
        "seniority": "Mid-level",
        "job_position": "HR Specialist",
        "employee_level": "L2",
    },
    {
        "full_name": "Carol Le",
        "email": "carol@kinetilearn.com",
        "password": "learner1234",
        "role": "learner",
        "department": "Engineering",
        "seniority": "Junior",
        "job_position": "Software Engineer",
        "employee_level": "L1",
    },
]


async def main():
    async with SessionLocal() as db:
        departments = {d.name.lower(): d.id for d in await DepartmentService(db).get_all()}
        seniorities = {s.name.lower(): s.id for s in await SeniorityLevelService(db).get_all()}
        positions = {j.name.lower(): j.id for j in await JobPositionService(db).get_all()}
        levels = {e.name.lower(): e.id for e in await EmployeeLevelService(db).get_all()}

        # Validate all referenced config exists before inserting anything.
        missing = []
        for u in USERS:
            checks = [
                ("department", departments, u["department"]),
                ("seniority", seniorities, u["seniority"]),
                ("job_position", positions, u["job_position"]),
                ("employee_level", levels, u["employee_level"]),
            ]
            for label, mapping, name in checks:
                if name.lower() not in mapping:
                    missing.append(f"{label} '{name}'")
        if missing:
            print("ERROR: missing config data — run scripts.seed_config first:")
            for m in sorted(set(missing)):
                print(f"  - {m}")
            sys.exit(1)

        created = skipped = 0
        for u in USERS:
            result = await db.execute(
                select(User.id).where(func.lower(User.email) == u["email"].lower())
            )
            if result.scalar_one_or_none() is not None:
                skipped += 1
                continue
            await UserService(db).create(
                UserCreate(
                    email = u["email"],
                    password = u["password"],
                    full_name = u["full_name"],
                    role = u["role"],
                    department_id = departments[u["department"].lower()],
                    seniority_id = seniorities[u["seniority"].lower()],
                    job_position_id = positions[u["job_position"].lower()],
                    employee_level_id = levels[u["employee_level"].lower()],
                )
            )
            created += 1

    print(f"Seed summary: {created} created, {skipped} skipped")


if __name__ == "__main__":
    asyncio.run(main())
