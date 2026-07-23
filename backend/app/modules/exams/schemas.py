from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# Request for POST /exams/generate. Only the source + minimal exercise identity;
# the schedule is placeholder until a separate finalize step.
class GenerateExerciseRequest(BaseModel):
    title: str = Field(..., min_length = 1, max_length = 255)
    class_id: UUID
    document_id: UUID
    num_questions: int = Field(..., ge = 1, le = 50)
    prompt: str = Field(..., min_length = 1)


class QuestionOptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    option_label: str
    option_text: str
    is_correct: bool


class QuestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    question_text: str
    explanation: str | None
    points: int
    order_index: int
    options: list[QuestionOptionResponse]


class ExerciseResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    title: str
    class_id: UUID
    is_active: bool
    total_points: int
    questions: list[QuestionResponse]
    # How many source chunks fed generation vs how many exist for that version,
    # so an admin can tell if a large document was only partially covered.
    chunks_used: int | None = None
    chunks_total: int | None = None


class QuestionUpdate(BaseModel):
    question_text: str | None = None
    explanation: str | None = None
    points: int | None = Field(default = None, ge = 1)


class OptionUpdate(BaseModel):
    option_text: str | None = None
    is_correct: bool | None = None


# Request for PUT /exams/{exercise_id}/finalize. Sets the real schedule and
# promotes a draft to a schedulable exercise. Fields are validated in the service
# so all rejections return a uniform {"detail": "message"}.
class FinalizeExerciseRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    duration_minutes: int
    pass_score: int
