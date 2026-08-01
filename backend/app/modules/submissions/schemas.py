from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SubmissionAnswerInput(BaseModel):
    question_id: UUID
    # NULL means the learner skipped the question.
    selected_option_id: UUID | None = None


class SubmitRequest(BaseModel):
    exercise_id: UUID
    answers: list[SubmissionAnswerInput]


class SubmissionAnswerResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    question_id: UUID
    selected_option_id: UUID | None
    is_correct: bool | None
    points_earned: int


class SubmissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    user_id: UUID
    exercise_id: UUID
    attempt_number: int
    submitted_at: datetime | None
    score: int | None
    is_passed: bool | None
    is_late: bool


class SubmissionDetailResponse(SubmissionResponse):
    answers: list[SubmissionAnswerResponse]


# Admin score correction. is_passed is always recomputed from the new score
# against exercise.pass_score, so it is not settable here.
class ScoreUpdate(BaseModel):
    score: int = Field(..., ge = 0)
