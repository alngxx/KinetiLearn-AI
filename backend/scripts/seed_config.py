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
    EmployeeLevelCreate,
    JobPositionCreate,
    SeniorityLevelCreate,
    SkillCreate,
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

# Two skills per category. All skills share the same score bands.
SKILLS = {
    "Technical": ["Python Programming", "System Design"],
    "Soft Skills": ["Communication", "Teamwork"],
    "Compliance": ["Data Privacy", "Workplace Safety"],
}
BANDS = {
    "basic_min": 0,
    "basic_max": 200,
    "intermediate_min": 201,
    "intermediate_max": 500,
    "advanced_min": 501,
    "advanced_max": 1000,
}

DEPARTMENTS = ["Engineering", "Sales", "HR", "Operations"]

SENIORITY = [("Junior", 1), ("Mid-level", 2), ("Senior", 3)]

JOB_POSITIONS = ["Software Engineer", "Product Manager", "Sales Executive", "HR Specialist"]

EMPLOYEE_LEVELS = [("L1", 1), ("L2", 2), ("L3", 3)]


async def main():
    async with SessionLocal() as db:
        summary = {}

        # Categories
        service = CategoryService(db)
        existing = {c.name.lower() for c in await service.get_all()}
        created = skipped = 0
        for name in CATEGORIES:
            if name.lower() in existing:
                skipped += 1
                continue
            await service.create(CategoryCreate(name = name))
            created += 1
        summary["Categories"] = (created, skipped)

        # Skills — need the parent category id, looked up by name.
        categories = {c.name.lower(): c.id for c in await CategoryService(db).get_all()}
        skill_service = SkillService(db)
        created = skipped = 0
        for category_name, skill_names in SKILLS.items():
            category_id = categories[category_name.lower()]
            existing = {s.name.lower() for s in await skill_service.get_all(category_id = category_id)}
            for name in skill_names:
                if name.lower() in existing:
                    skipped += 1
                    continue
                await skill_service.create(
                    SkillCreate(category_id = category_id, name = name, **BANDS)
                )
                created += 1
        summary["Skills"] = (created, skipped)

        # Departments
        service = DepartmentService(db)
        existing = {d.name.lower() for d in await service.get_all()}
        created = skipped = 0
        for name in DEPARTMENTS:
            if name.lower() in existing:
                skipped += 1
                continue
            await service.create(DepartmentCreate(name = name))
            created += 1
        summary["Departments"] = (created, skipped)

        # Seniority levels
        service = SeniorityLevelService(db)
        existing = {s.name.lower() for s in await service.get_all()}
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
        existing = {j.name.lower() for j in await service.get_all()}
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
        existing = {e.name.lower() for e in await service.get_all()}
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
