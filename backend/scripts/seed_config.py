"""Seed the 6 config entities through the existing service classes.

Idempotent: each entity is only created when a row with that name does not
already exist, so running this script repeatedly is safe.

Run from backend/ with the venv active:  python -m scripts.seed_config
"""
import asyncio

from app.core.database import SessionLocal
from app.modules.config.schemas import (
    CategoryCreate,
    DepartmentCreate,
    DepartmentUpdate,
    EmployeeLevelCreate,
    JobPositionCreate,
    SeniorityLevelCreate,
    SkillCreate,
    SkillUpdate,
)
from app.modules.config.service import (
    CategoryService,
    DepartmentService,
    EmployeeLevelService,
    JobPositionService,
    SeniorityLevelService,
    SkillService,
)

CATEGORIES = ["Technical", "Soft Skills", "Compliance"]

# Two skills per category, plus the AI tooling skill the enablement class scores against.
SKILLS = {
    "Technical": ["Python Programming", "System Design", "AI-Assisted Development"],
    "Soft Skills": ["Communication", "Teamwork"],
    "Compliance": ["Data Privacy", "Workplace Safety"],
}

# Questions are worth 1 point each, so a band is a count of correct answers: one
# 10-question exam clears basic, roughly three reach advanced.
BANDS = {
    "basic_max": 8,
    "intermediate_max": 24,
}

# Applied before the create pass, so the renamed rows are found by name below.
DEPARTMENT_RENAMES = [
    ("Engineering", "Engineering & Development"),
    ("Sales", "Sales & Marketing"),
    ("HR", "Human Resources"),
]

DEPARTMENTS = [
    "Engineering & Development",
    "Sales & Marketing",
    "Human Resources",
    "Product Management",
    "Design (UI/UX)",
    "Finance & Legal",
]

RETIRED_DEPARTMENTS = ["Operations"]

SENIORITY = [("Junior", 1), ("Mid-level", 2), ("Senior", 3), ("Lead", 4), ("Head", 5)]

JOB_POSITIONS = [
    "Software Engineer",
    "Product Manager",
    "Sales Executive",
    "HR Specialist",
    "Engineering Manager",
    "DevOps Engineer",
    "Product Analyst",
    "Product Designer",
    "Sales Director",
    "Account Executive",
    "Marketing Specialist",
    "HR Business Partner",
    "Finance Manager",
    "Legal Counsel",
    "Learning & Development Manager",
]

EMPLOYEE_LEVELS = [("L1", 1), ("L2", 2), ("L3", 3), ("L4", 4), ("L5", 5)]


async def main():
    async with SessionLocal() as db:
        summary = {}

        # Categories
        service = CategoryService(db)
        existing = {c.name.lower() for c in await service.get_all(include_inactive = True)}
        created = skipped = 0
        for name in CATEGORIES:
            if name.lower() in existing:
                skipped += 1
                continue
            await service.create(CategoryCreate(name = name))
            created += 1
        summary["Categories"] = (created, skipped)

        # Skills — need the parent category id, looked up by name.
        categories = {c.name.lower(): c.id for c in await CategoryService(db).get_all(include_inactive = True)}
        skill_service = SkillService(db)
        created = skipped = 0
        for category_name, skill_names in SKILLS.items():
            category_id = categories[category_name.lower()]
            existing = {s.name.lower() for s in await skill_service.get_all(category_id = category_id, include_inactive = True)}
            for name in skill_names:
                if name.lower() in existing:
                    skipped += 1
                    continue
                await skill_service.create(
                    SkillCreate(category_id = category_id, name = name, **BANDS)
                )
                created += 1
        summary["Skills"] = (created, skipped)

        # Retune every active skill, not just the ones just created — the
        # pre-existing rows still carry the old 200/500 bands.
        retuned = 0
        for skill in await skill_service.get_all():
            if (skill.basic_max, skill.intermediate_max) == (
                BANDS["basic_max"],
                BANDS["intermediate_max"],
            ):
                continue
            await skill_service.update(skill.id, SkillUpdate(**BANDS))
            retuned += 1
        summary["Skill bands retuned"] = (retuned, 0)

        # Departments — rename in place rather than replace, so the RESTRICT FK
        # from users.department_id stays valid and tagged users move with the row.
        service = DepartmentService(db)
        by_name = {d.name.lower(): d for d in await service.get_all(include_inactive = True)}
        renamed = 0
        for old_name, new_name in DEPARTMENT_RENAMES:
            old = by_name.get(old_name.lower())
            if old is None or new_name.lower() in by_name:
                continue
            await service.update(old.id, DepartmentUpdate(name = new_name))
            renamed += 1
        summary["Departments renamed"] = (renamed, 0)

        existing = {d.name.lower() for d in await service.get_all(include_inactive = True)}
        created = skipped = 0
        for name in DEPARTMENTS:
            if name.lower() in existing:
                skipped += 1
                continue
            await service.create(DepartmentCreate(name = name))
            created += 1
        summary["Departments"] = (created, skipped)

        retired = 0
        for department in await service.get_all():
            if department.name in RETIRED_DEPARTMENTS:
                await service.deactivate(department.id)
                retired += 1
        summary["Departments retired"] = (retired, 0)

        # Seniority levels
        service = SeniorityLevelService(db)
        existing = {s.name.lower() for s in await service.get_all(include_inactive = True)}
        created = skipped = 0
        for name, rank in SENIORITY:
            if name.lower() in existing:
                skipped += 1
                continue
            await service.create(SeniorityLevelCreate(name = name, rank = rank))
            created += 1
        summary["Seniority levels"] = (created, skipped)

        # Job positions
        service = JobPositionService(db)
        existing = {j.name.lower() for j in await service.get_all(include_inactive = True)}
        created = skipped = 0
        for name in JOB_POSITIONS:
            if name.lower() in existing:
                skipped += 1
                continue
            await service.create(JobPositionCreate(name = name))
            created += 1
        summary["Job positions"] = (created, skipped)

        # Employee levels
        service = EmployeeLevelService(db)
        existing = {e.name.lower() for e in await service.get_all(include_inactive = True)}
        created = skipped = 0
        for name, rank in EMPLOYEE_LEVELS:
            if name.lower() in existing:
                skipped += 1
                continue
            await service.create(EmployeeLevelCreate(name = name, rank = rank))
            created += 1
        summary["Employee levels"] = (created, skipped)

    print("Seed summary:")
    total_created = 0
    for entity, (created, skipped) in summary.items():
        print(f"  {entity}: created {created}, skipped {skipped}")
        total_created += created
    print(f"Total created: {total_created}")


if __name__ == "__main__":
    asyncio.run(main())
