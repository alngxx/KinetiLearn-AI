from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, require_admin
from app.modules.auth.models import User
from app.modules.exams.schemas import (
    DeleteResponse,
    ExerciseResponse,
    FinalizeExerciseRequest,
    GenerateExerciseRequest,
    LearnerExerciseDetail,
    OptionUpdate,
    QuestionResponse,
    QuestionUpdate,
)
from app.modules.exams.service import ExamService

router = APIRouter()


@router.post(
    "/generate",
    response_model = ExerciseResponse,
    status_code = status.HTTP_201_CREATED,
)
async def generate_exercise(
    payload: GenerateExerciseRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await ExamService(db).generate(
        title = payload.title,
        class_id = payload.class_id,
        document_ids = payload.document_ids,
        num_questions = payload.num_questions,
        prompt = payload.prompt,
        creator_id = current_user.id,
    )


@router.get(
    "/{exercise_id}",
    response_model = ExerciseResponse,
    dependencies = [Depends(require_admin)],
)
async def get_exercise(exercise_id: UUID, db: AsyncSession = Depends(get_db)):
    return await ExamService(db).get_exercise(exercise_id)


# Learner-facing: the response schemas carry no is_correct and no explanation, so
# this is the only exam read a learner is given.
@router.get("/{exercise_id}/take", response_model = LearnerExerciseDetail)
async def take_exercise(
    exercise_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ExamService(db).get_for_learner(exercise_id, current_user.id)


@router.get(
    "/{exercise_id}/questions",
    response_model = list[QuestionResponse],
    dependencies = [Depends(require_admin)],
)
async def get_exercise_questions(
    exercise_id: UUID, db: AsyncSession = Depends(get_db)
):
    exercise = await ExamService(db).get_exercise(exercise_id)
    return exercise.questions


@router.patch(
    "/questions/{question_id}",
    response_model = QuestionResponse,
    dependencies = [Depends(require_admin)],
)
async def update_question(
    question_id: UUID,
    payload: QuestionUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await ExamService(db).update_question(question_id, payload)


@router.patch(
    "/questions/{question_id}/options/{option_id}",
    response_model = QuestionResponse,
    dependencies = [Depends(require_admin)],
)
async def update_option(
    question_id: UUID,
    option_id: UUID,
    payload: OptionUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await ExamService(db).update_option(question_id, option_id, payload)


@router.put(
    "/{exercise_id}/finalize",
    response_model = ExerciseResponse,
    dependencies = [Depends(require_admin)],
)
async def finalize_exercise(
    exercise_id: UUID,
    payload: FinalizeExerciseRequest,
    db: AsyncSession = Depends(get_db),
):
    return await ExamService(db).finalize(exercise_id, payload)


@router.delete(
    "",
    response_model = DeleteResponse,
    dependencies = [Depends(require_admin)],
)
async def delete_all_exercises(
    confirm: bool = False, db: AsyncSession = Depends(get_db)
):
    return await ExamService(db).delete_all(confirm)


@router.delete(
    "/{exercise_id}",
    response_model = DeleteResponse,
    dependencies = [Depends(require_admin)],
)
async def delete_exercise(exercise_id: UUID, db: AsyncSession = Depends(get_db)):
    return await ExamService(db).delete_exercise(exercise_id)
