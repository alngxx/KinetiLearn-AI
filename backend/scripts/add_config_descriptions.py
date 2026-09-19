"""Fill in missing descriptions for config entity rows.

Admin cards for Categories, Departments, Job Positions, and Skills render "-"
when a row has no description. Every row in those four entities was missing
one. Seniority Levels and Employee Levels have no description column at all
(schema change, out of scope) and are not touched here. A handful of
inactive, test-looking rows (DarkQA1787381351777, People& Leadership,
ZZ Has Skill, ZZ Test Skill 1788792490615) are also left alone.

Goes through each entity's existing update service, not a raw SQL update, so
any validation on update still runs.

Idempotent: a row is only updated when its description is still empty, so
running this repeatedly is safe.

Run from backend/ with the venv active:  python -m scripts.add_config_descriptions
"""
import asyncio
import sys

from sqlalchemy import select

from app.core.database import SessionLocal

# The models reference each other by name, so the mapper cannot configure itself
# until every module is loaded — the same list, for the same reason, as
# alembic/env.py.
import app.modules.config.models  # noqa: F401
import app.modules.auth.models  # noqa: F401
import app.modules.documents.models  # noqa: F401
import app.modules.classes.models  # noqa: F401
import app.modules.exams.models  # noqa: F401
import app.modules.scoring.models  # noqa: F401
import app.modules.quiz.models  # noqa: F401
import app.modules.chat.models  # noqa: F401

from app.modules.config.models import Category, Department, JobPosition, Skill
from app.modules.config.schemas import (
    CategoryUpdate,
    DepartmentUpdate,
    JobPositionUpdate,
    SkillUpdate,
)
from app.modules.config.service import (
    CategoryService,
    DepartmentService,
    JobPositionService,
    SkillService,
)

CATEGORY_DESCRIPTIONS = {
    "Compliance": "Regulatory, safety, and policy training skills.",
    "Design": "Visual, UI, and UX design skills.",
    "People & Leadership": "Management and team-leadership skills.",
    "Product": "Product strategy and management skills.",
    "Sales": "Selling and client-facing skills.",
    "Soft Skills": "Communication and collaboration skills.",
    "Technical": "Engineering and programming skills.",
}

DEPARTMENT_DESCRIPTIONS = {
    "Design (UI/UX)": "Product design team responsible for UI and UX.",
    "Engineering & Development": "Builds and maintains the platform's software.",
    "Finance & Legal": "Handles budgeting, accounting, and legal matters.",
    "Human Resources": "Manages hiring, onboarding, and employee relations.",
    "Operations": "Runs day-to-day business and internal processes.",
    "Product Management": "Defines product direction and roadmap.",
    "Sales & Marketing": "Drives revenue through sales and marketing.",
}

JOB_POSITION_DESCRIPTIONS = {
    "Account Executive": "Manages client relationships and closes sales deals.",
    "DevOps Engineer": "Maintains deployment pipelines and infrastructure.",
    "Engineering Manager": "Leads engineering teams and technical delivery.",
    "Finance Manager": "Oversees budgeting and financial reporting.",
    "HR Business Partner": "Advises teams on HR policy and people decisions.",
    "HR Specialist": "Handles day-to-day HR and employee support tasks.",
    "Learning & Development Manager": "Oversees training programs and employee growth.",
    "Legal Counsel": "Advises on contracts, compliance, and legal risk.",
    "Marketing Specialist": "Runs campaigns and marketing content.",
    "Product Analyst": "Analyzes product data to guide decisions.",
    "Product Designer": "Designs user interfaces and experiences.",
    "Product Manager": "Owns product direction and feature priorities.",
    "Sales Director": "Leads the sales team and sets sales strategy.",
    "Sales Executive": "Sells products and manages client accounts.",
    "Software Engineer": "Writes and maintains the platform's codebase.",
}

# skill name -> (category name, description)
SKILL_DESCRIPTIONS = {
    "Data Privacy": ("Compliance", "Handling personal data in line with privacy law."),
    "Workplace Safety": ("Compliance", "Following safe practices in the workplace."),
    "Employee Relations": ("People & Leadership", "Managing conflicts and employee well-being."),
    "Communication": ("Soft Skills", "Expressing ideas clearly to others."),
    "Teamwork": ("Soft Skills", "Collaborating effectively within a team."),
    "AI-Assisted Development": ("Technical", "Using AI tools to write and review code."),
    "Python Programming": ("Technical", "Writing and debugging code in Python."),
    "System Design": ("Technical", "Designing scalable software architectures."),
}


async def main():
    async with SessionLocal() as db:
        categories = {row.name: row for row in (await db.execute(select(Category))).scalars().all()}
        departments = {row.name: row for row in (await db.execute(select(Department))).scalars().all()}
        job_positions = {row.name: row for row in (await db.execute(select(JobPosition))).scalars().all()}
        skills = {(row.name, cat.name): row for row, cat in (
            await db.execute(select(Skill, Category).join(Category, Skill.category_id == Category.id))
        ).all()}

        missing = []
        missing += [f"category: {name}" for name in CATEGORY_DESCRIPTIONS if name not in categories]
        missing += [f"department: {name}" for name in DEPARTMENT_DESCRIPTIONS if name not in departments]
        missing += [f"job position: {name}" for name in JOB_POSITION_DESCRIPTIONS if name not in job_positions]
        missing += [
            f"skill: {name} ({category})"
            for name, (category, _) in SKILL_DESCRIPTIONS.items()
            if (name, category) not in skills
        ]
        if missing:
            print("ERROR: the mapping does not match the data in this database:")
            for entry in missing:
                print(f"  missing {entry}")
            sys.exit(1)

        print("Descriptions to apply:")
        for name, description in CATEGORY_DESCRIPTIONS.items():
            print(f"  category      {name!r:35} -> {description!r}")
        for name, description in DEPARTMENT_DESCRIPTIONS.items():
            print(f"  department    {name!r:35} -> {description!r}")
        for name, description in JOB_POSITION_DESCRIPTIONS.items():
            print(f"  job position  {name!r:35} -> {description!r}")
        for name, (category, description) in SKILL_DESCRIPTIONS.items():
            print(f"  skill         {name!r:35} ({category}) -> {description!r}")

        updated = skipped = 0

        category_service = CategoryService(db)
        for name, description in CATEGORY_DESCRIPTIONS.items():
            row = categories[name]
            if row.description:
                print(f"  skip  category  {name}  (already has a description)")
                skipped += 1
                continue
            await category_service.update(row.id, CategoryUpdate(description = description))
            print(f"  done  category  {name}")
            updated += 1

        department_service = DepartmentService(db)
        for name, description in DEPARTMENT_DESCRIPTIONS.items():
            row = departments[name]
            if row.description:
                print(f"  skip  department  {name}  (already has a description)")
                skipped += 1
                continue
            await department_service.update(row.id, DepartmentUpdate(description = description))
            print(f"  done  department  {name}")
            updated += 1

        job_position_service = JobPositionService(db)
        for name, description in JOB_POSITION_DESCRIPTIONS.items():
            row = job_positions[name]
            if row.description:
                print(f"  skip  job position  {name}  (already has a description)")
                skipped += 1
                continue
            await job_position_service.update(row.id, JobPositionUpdate(description = description))
            print(f"  done  job position  {name}")
            updated += 1

        skill_service = SkillService(db)
        for name, (category, description) in SKILL_DESCRIPTIONS.items():
            row = skills[(name, category)]
            if row.description:
                print(f"  skip  skill  {name} ({category})  (already has a description)")
                skipped += 1
                continue
            await skill_service.update(row.id, SkillUpdate(description = description))
            print(f"  done  skill  {name} ({category})")
            updated += 1

    print(f"Summary: {updated} updated, {skipped} skipped")


if __name__ == "__main__":
    asyncio.run(main())
