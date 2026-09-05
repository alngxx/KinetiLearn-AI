"""Seed the demo roster (3 admins + 30 learners, 2 of them retired) via UserService.

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

ADMIN_PASSWORD = "admin1234"
LEARNER_PASSWORD = "learner1234"

ENGINEERING = "Engineering & Development"
PRODUCT = "Product Management"
DESIGN = "Design (UI/UX)"
SALES = "Sales & Marketing"
HR = "Human Resources"
FINANCE = "Finance & Legal"


def admin(full_name, email, department, seniority, job_position, employee_level):
    return {
        "full_name": full_name,
        "email": f"{email}@kinetilearn.com",
        "password": ADMIN_PASSWORD,
        "role": "admin",
        "department": department,
        "seniority": seniority,
        "job_position": job_position,
        "employee_level": employee_level,
    }


def learner(full_name, email, department, seniority, job_position, employee_level):
    return {
        "full_name": full_name,
        "email": f"{email}@kinetilearn.com",
        "password": LEARNER_PASSWORD,
        "role": "learner",
        "department": department,
        "seniority": seniority,
        "job_position": job_position,
        "employee_level": employee_level,
    }


# A None tag is deliberate — the demo roster carries a couple of partly-tagged
# people so the admin UI is exercised with real gaps in it.
USERS = [
    # Admins
    admin("Admin User", "admin", ENGINEERING, "Senior", "Software Engineer", "L3"),
    admin("Grace Yap Suet Mei", "grace.yap", HR, "Head", "Learning & Development Manager", "L5"),
    admin("Nguyen An Loc", "anloc.nguyen", ENGINEERING, "Head", "Engineering Manager", "L5"),

    # Pre-existing demo learners, kept so a fresh database still gets them.
    learner("Alice Nguyen", "alice", SALES, "Junior", "Sales Executive", "L1"),
    learner("Bob Tran", "bob", HR, "Mid-level", "HR Specialist", "L2"),
    learner("Carol Le", "carol", ENGINEERING, "Junior", "Software Engineer", "L1"),

    # Engineering & Development
    learner("Tan Wei Sheng", "weisheng.tan", ENGINEERING, "Head", "Engineering Manager", "L5"),
    learner("Priya Raghunathan", "priya.raghunathan", ENGINEERING, "Lead", "Software Engineer", "L4"),
    learner("Chen Yuting", "yuting.chen", ENGINEERING, "Senior", "Software Engineer", "L3"),
    learner("Goh Wei Ming", "weiming.goh", ENGINEERING, "Senior", "DevOps Engineer", "L3"),
    learner("Ng Kai Xuan", "kaixuan.ng", ENGINEERING, "Mid-level", "Software Engineer", "L2"),
    learner("Muhammad Faizal Bin Osman", "faizal.osman", ENGINEERING, "Mid-level", "Software Engineer", "L2"),
    learner("Sofia Almeida", "sofia.almeida", ENGINEERING, "Mid-level", None, "L2"),
    learner("Yeo Shu Ting", "shuting.yeo", ENGINEERING, "Junior", "Software Engineer", "L1"),
    learner("Toh Jing Yang", "jingyang.toh", ENGINEERING, "Junior", "Software Engineer", "L1"),

    # Product Management
    learner("Cheryl Sim Hui Min", "cheryl.sim", PRODUCT, "Head", "Product Manager", "L5"),
    learner("Rakesh Menon", "rakesh.menon", PRODUCT, "Senior", "Product Manager", "L3"),
    learner("Nurul Aisyah Binte Rahman", "nurul.aisyah", PRODUCT, "Mid-level", "Product Analyst", "L2"),
    learner("Nguyen Thi Thu Ha", "thuha.nguyen", PRODUCT, "Junior", "Product Analyst", "L1"),

    # Design (UI/UX)
    learner("Amanda Toh Li Xuan", "amanda.toh", DESIGN, "Lead", "Product Designer", "L4"),
    learner("Hafiz Bin Zulkifli", "hafiz.zulkifli", DESIGN, "Junior", "Product Designer", "L1"),

    # Sales & Marketing
    learner("Jonathan Lee Kok Wai", "jonathan.lee", SALES, "Head", "Sales Director", "L5"),
    learner("Rachel Ong Mei Fang", "rachel.ong", SALES, "Lead", "Account Executive", "L4"),
    learner("Vanessa Kwok Sze Ying", "vanessa.kwok", SALES, "Senior", "Marketing Specialist", "L3"),
    learner("Thomas Bergmann", "thomas.bergmann", SALES, "Mid-level", "Marketing Specialist", "L2"),
    learner("Tran Quoc Bao", "quocbao.tran", SALES, None, "Sales Executive", None),
    learner("Divya Krishnan", "divya.krishnan", SALES, "Junior", "Marketing Specialist", "L1"),

    # Human Resources
    learner("Serene Chua Li Ping", "serene.chua", HR, "Head", "HR Business Partner", "L5"),
    learner("Nurhaliza Binte Sulaiman", "nurhaliza.sulaiman", HR, "Senior", "HR Specialist", "L3"),
    learner("Emily Sanderson", "emily.sanderson", HR, "Junior", "HR Specialist", "L1"),

    # Finance & Legal
    learner("Kelvin Foo Chee Meng", "kelvin.foo", FINANCE, "Head", "Finance Manager", "L5"),
    learner("Harvey Specter", "harvey.specter", FINANCE, "Senior", "Legal Counsel", "L3"),
    learner("Mike Ross", "mike.ross", FINANCE, "Junior", "Legal Counsel", "L1"),
]

# Retired demo accounts. alice is deliberately not here — the E2E fixtures sign in
# as her, so she stays active.
DEACTIVATE = ["bob@kinetilearn.com", "carol@kinetilearn.com"]


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
                if name is not None and name.lower() not in mapping:
                    missing.append(f"{label} '{name}'")
        if missing:
            print("ERROR: missing config data — run scripts.seed_config first:")
            for m in sorted(set(missing)):
                print(f"  - {m}")
            sys.exit(1)

        def tag(mapping, name):
            return None if name is None else mapping[name.lower()]

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
                    department_id = tag(departments, u["department"]),
                    seniority_id = tag(seniorities, u["seniority"]),
                    job_position_id = tag(positions, u["job_position"]),
                    employee_level_id = tag(levels, u["employee_level"]),
                )
            )
            created += 1

        deactivated = 0
        for email in DEACTIVATE:
            result = await db.execute(
                select(User).where(func.lower(User.email) == email.lower())
            )
            row = result.scalar_one_or_none()
            if row is None or not row.is_active:
                continue
            await UserService(db).deactivate(row.id)
            deactivated += 1

    print(f"Seed summary: {created} created, {skipped} skipped, {deactivated} deactivated")


if __name__ == "__main__":
    asyncio.run(main())
