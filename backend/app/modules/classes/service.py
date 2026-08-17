from datetime import date
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.crud import get_or_404
from app.modules.auth.models import User
from app.modules.classes.models import Class, ClassMember
from app.modules.classes.schemas import (
    BulkAddMembersRequest,
    BulkAddMembersResponse,
    ClassCreate,
    ClassDetailResponse,
    ClassExerciseSummary,
    ClassResponse,
    ClassUpdate,
    LearnerExerciseBase,
    LearnerExerciseSummary,
    MyClassBase,
    MyClassResponse,
)
from app.modules.config.models import Skill
from app.modules.documents.models import DocumentSkill
from app.modules.exams.models import Exercise, Question
from app.modules.submissions.models import Submission


# Shared by every learner-facing read that hangs off a class. Checked before any
# other state so a non-member learns nothing beyond the fact that the thing exists.
async def assert_class_member(db: AsyncSession, class_id: UUID, user_id: UUID) -> None:
    member = await db.scalar(
        select(ClassMember.user_id).where(
            ClassMember.class_id == class_id,
            ClassMember.user_id == user_id,
        )
    )
    if member is None:
        raise HTTPException(
            status_code = 403, detail = "You are not a member of this class."
        )


class ClassService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _check_dates(self, start_date: date | None, end_date: date | None) -> None:
        # Mirrors the ck_classes_end_date_after_start_date CHECK so a bad range
        # returns {"detail": ...} instead of a raw IntegrityError.
        if start_date is not None and end_date is not None and end_date < start_date:
            raise HTTPException(
                status_code = 400, detail = "end_date must be on or after start_date."
            )

    async def create(self, data: ClassCreate, creator_id: UUID | None) -> ClassResponse:
        self._check_dates(data.start_date, data.end_date)

        row = Class(
            name = data.name,
            description = data.description,
            start_date = data.start_date,
            end_date = data.end_date,
            created_by = creator_id,
        )
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return ClassResponse.model_validate(row)

    async def get_all(self, include_inactive: bool = False) -> list[ClassResponse]:
        stmt = select(Class).order_by(Class.created_at.desc())
        if not include_inactive:
            stmt = stmt.where(Class.is_active.is_(True))
        result = await self.db.execute(stmt)
        return [ClassResponse.model_validate(row) for row in result.scalars().all()]

    async def get_by_id(self, class_id: UUID) -> ClassDetailResponse:
        row = await get_or_404(self.db, Class, class_id, "Class not found.")

        member_count = await self.db.scalar(
            select(func.count())
            .select_from(ClassMember)
            .where(ClassMember.class_id == class_id)
        )
        result = await self.db.execute(
            select(Exercise)
            .where(Exercise.class_id == class_id)
            .order_by(Exercise.end_time)
        )
        exercises = [
            ClassExerciseSummary.model_validate(e) for e in result.scalars().all()
        ]

        return ClassDetailResponse(
            **ClassResponse.model_validate(row).model_dump(),
            member_count = member_count or 0,
            exercises = exercises,
        )

    async def get_my(self, user_id: UUID) -> list[MyClassResponse]:
        result = await self.db.execute(
            select(Class, ClassMember.enrolled_at)
            .join(ClassMember, ClassMember.class_id == Class.id)
            .where(ClassMember.user_id == user_id, Class.is_active.is_(True))
            .order_by(Class.created_at.desc())
        )
        rows = result.all()
        if not rows:
            return []

        class_ids = [row[0].id for row in rows]

        # Only finalized exercises count towards progress — a draft is not
        # something the learner can do anything about yet.
        result = await self.db.execute(
            select(Exercise.class_id, func.count(Exercise.id))
            .where(Exercise.class_id.in_(class_ids), Exercise.is_active.is_(True))
            .group_by(Exercise.class_id)
        )
        totals = {row[0]: row[1] for row in result.all()}

        # Distinct, so a retried exercise still counts once.
        result = await self.db.execute(
            select(Exercise.class_id, func.count(func.distinct(Submission.exercise_id)))
            .join(Submission, Submission.exercise_id == Exercise.id)
            .where(
                Exercise.class_id.in_(class_ids),
                Exercise.is_active.is_(True),
                Submission.user_id == user_id,
            )
            .group_by(Exercise.class_id)
        )
        completed = {row[0]: row[1] for row in result.all()}

        return [
            MyClassResponse(
                **MyClassBase.model_validate(row).model_dump(),
                enrolled_at = enrolled_at,
                exercise_count = totals.get(row.id, 0),
                completed_exercise_count = completed.get(row.id, 0),
            )
            for row, enrolled_at in rows
        ]

    async def get_my_exercises(
        self, class_id: UUID, user_id: UUID
    ) -> list[LearnerExerciseSummary]:
        await assert_class_member(self.db, class_id, user_id)

        result = await self.db.execute(
            select(Exercise)
            .where(Exercise.class_id == class_id, Exercise.is_active.is_(True))
            .order_by(Exercise.end_time)
            .options(selectinload(Exercise.source_documents))
        )
        exercises = list(result.scalars().all())
        if not exercises:
            return []

        exercise_ids = [e.id for e in exercises]

        result = await self.db.execute(
            select(Question.exercise_id, func.count(Question.id))
            .where(Question.exercise_id.in_(exercise_ids))
            .group_by(Question.exercise_id)
        )
        question_counts = {row[0]: row[1] for row in result.all()}

        # Only the caller's own attempts. bool_or ignores NULLs, so is_passed is
        # "has ever passed" rather than "passed on the last try".
        result = await self.db.execute(
            select(
                Submission.exercise_id,
                func.count(Submission.id),
                func.max(Submission.score),
                func.bool_or(Submission.is_passed),
            )
            .where(
                Submission.exercise_id.in_(exercise_ids),
                Submission.user_id == user_id,
            )
            .group_by(Submission.exercise_id)
        )
        attempts = {row[0]: (row[1], row[2], row[3]) for row in result.all()}

        skill_names = await self._skill_names_by_exercise(exercises)

        no_attempts = (0, None, None)
        return [
            LearnerExerciseSummary(
                **LearnerExerciseBase.model_validate(e).model_dump(),
                question_count = question_counts.get(e.id, 0),
                attempt_count = attempts.get(e.id, no_attempts)[0],
                best_score = attempts.get(e.id, no_attempts)[1],
                is_passed = attempts.get(e.id, no_attempts)[2],
                skill_names = skill_names.get(e.id, []),
            )
            for e in exercises
        ]

    # A multi-document exam awards no skill points (accepted Task 31 limitation),
    # so only single-document exercises can honestly advertise what they earn.
    async def _skill_names_by_exercise(self, exercises: list) -> dict:
        single_source = {
            e.id: e.source_documents[0].document_id
            for e in exercises
            if len(e.source_documents) == 1
        }
        if not single_source:
            return {}

        result = await self.db.execute(
            select(DocumentSkill.document_id, Skill.name)
            .join(Skill, Skill.id == DocumentSkill.skill_id)
            .where(
                DocumentSkill.document_id.in_(set(single_source.values())),
                Skill.is_active.is_(True),
            )
            .order_by(Skill.name)
        )
        by_document: dict = {}
        for document_id, name in result.all():
            by_document.setdefault(document_id, []).append(name)

        return {
            exercise_id: by_document.get(document_id, [])
            for exercise_id, document_id in single_source.items()
        }

    async def update(self, class_id: UUID, data: ClassUpdate) -> ClassResponse:
        row = await get_or_404(self.db, Class, class_id, "Class not found.")
        update_data = data.model_dump(exclude_none = True)

        # Validate against the values the row will actually end up with.
        self._check_dates(
            update_data.get("start_date", row.start_date),
            update_data.get("end_date", row.end_date),
        )

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return ClassResponse.model_validate(row)

    async def activate(self, class_id: UUID) -> ClassResponse:
        return await self._set_active(class_id, True)

    async def deactivate(self, class_id: UUID) -> ClassResponse:
        return await self._set_active(class_id, False)

    async def _set_active(self, class_id: UUID, is_active: bool) -> ClassResponse:
        # Visibility flag only — members and exercises are left untouched.
        row = await get_or_404(self.db, Class, class_id, "Class not found.")
        row.is_active = is_active
        await self.db.commit()
        await self.db.refresh(row)
        return ClassResponse.model_validate(row)

    async def bulk_add_members(
        self, class_id: UUID, data: BulkAddMembersRequest
    ) -> BulkAddMembersResponse:
        await get_or_404(self.db, Class, class_id, "Class not found.")

        filters = []
        if data.department_id is not None:
            filters.append(User.department_id == data.department_id)
        if data.employee_level_id is not None:
            filters.append(User.employee_level_id == data.employee_level_id)
        if data.seniority_id is not None:
            filters.append(User.seniority_id == data.seniority_id)
        if not filters:
            raise HTTPException(
                status_code = 400, detail = "At least one filter is required."
            )

        result = await self.db.execute(
            select(User.id).where(
                User.role == "learner",
                User.is_active.is_(True),
                *filters,
            )
        )
        matched = set(result.scalars().all())

        result = await self.db.execute(
            select(ClassMember.user_id).where(ClassMember.class_id == class_id)
        )
        existing = set(result.scalars().all())

        # Already-members are skipped, so re-running the same filter is a no-op.
        to_add = matched - existing
        self.db.add_all(
            [ClassMember(class_id = class_id, user_id = uid) for uid in to_add]
        )
        await self.db.commit()

        return BulkAddMembersResponse(
            total_matched = len(matched),
            added = len(to_add),
            skipped = len(matched) - len(to_add),
        )
