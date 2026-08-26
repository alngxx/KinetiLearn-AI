from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# Request for POST /exams/generate. Only the source + minimal exercise identity;
# the schedule is placeholder until a separate finalize step.
class GenerateExerciseRequest(BaseModel):
    title: str = Field(..., min_length = 1, max_length = 255)
    class_id: UUID
    document_ids: list[UUID] = Field(..., min_length = 1, max_length = 10)
    num_questions: int = Field(..., ge = 1, le = 50)
    # Optional steering. Blank or omitted means "no particular angle" and the
    # service substitutes a neutral instruction — the system prompt and the
    # source material already fully specify the task without it.
    prompt: str = ""


# Returned by POST /exams/generate (202) and GET /exams/jobs/{job_id}. Generation
# runs in the worker, so the admin polls this until status is terminal. Progress
# moves one LLM batch at a time (QUIZ_BATCH_SIZE in core/llm.py), so a small exam
# is a single step from 0 to done.
class GenerationJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    # Carried so a wait resumed from a fresh page load knows which class the
    # finished draft belongs to — the route's class can be stale after a retarget.
    class_id: UUID
    status: str
    questions_done: int
    num_questions: int
    # Set only once status is "succeeded" — the exercise is written in one commit
    # at the end, so a job that has not succeeded has produced nothing.
    exercise_id: UUID | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


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
    description: str | None
    class_id: UUID
    is_active: bool
    # Placeholders until the first finalize; the previous schedule after an
    # unpublish. is_active is what says which state it's in.
    start_time: datetime
    end_time: datetime
    duration_minutes: int
    pass_score: int
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


# Request for PATCH /exams/{exercise_id}. Title only: everything else about a
# draft is either generated or set by finalize.
class ExerciseUpdate(BaseModel):
    title: str = Field(..., min_length = 1, max_length = 255)


# Request for PUT /exams/{exercise_id}/finalize. Sets the real schedule and
# promotes a draft to a schedulable exercise. Fields are validated in the service
# so all rejections return a uniform {"detail": "message"}.
class FinalizeExerciseRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    duration_minutes: int
    pass_score: int


# Returned by the DELETE endpoints — how many exercises were removed.
class DeleteResponse(BaseModel):
    deleted: int


# is_correct is left out on purpose — this is what a learner sees before
# answering, so the option rows must not carry the answer key. Same split the
# daily quiz module makes with DailyQuizOptionOut.
class LearnerOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    option_label: str
    option_text: str


# explanation is left out for the same reason.
class LearnerQuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    question_text: str
    points: int
    order_index: int
    options: list[LearnerOptionOut]


class LearnerExerciseDetail(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    class_id: UUID
    title: str
    description: str | None
    start_time: datetime
    end_time: datetime
    duration_minutes: int
    pass_score: int
    total_points: int
    questions: list[LearnerQuestionOut]
