from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_admin
from app.modules.auth.models import User
from app.modules.exams.schemas import (
    ExerciseResponse,
    GenerateExerciseRequest,
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
        document_id = payload.document_id,
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
