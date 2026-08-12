from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# Audience targets are combined with AND, and NULL means "any" — same shape as
# the class bulk-add filters. All four are optional, so a config with none set
# targets every learner.
class DailyQuizConfigCreate(BaseModel):
    name: str = Field(..., min_length = 1, max_length = 150)
    prompt: str = Field(..., min_length = 1)
    source_document_id: UUID
    target_department_id: UUID | None = None
    target_seniority_id: UUID | None = None
    target_job_position_id: UUID | None = None
    target_employee_level_id: UUID | None = None
    start_date: date
    end_date: date | None = None
    # Local wall-clock time paired with timezone — see the TIME + IANA name
    # decision in the schema spec.
    push_time: time
    timezone: str = Field(default = "Asia/Ho_Chi_Minh", max_length = 50)
    expiry_hours: int = Field(default = 24, ge = 1)
    # le = 50 keeps question_count inside SmallInteger and matches the cap on
    # exam generation.
    question_count: int = Field(default = 5, ge = 1, le = 50)


class DailyQuizConfigUpdate(BaseModel):
    name: str | None = Field(default = None, min_length = 1, max_length = 150)
    prompt: str | None = Field(default = None, min_length = 1)
    source_document_id: UUID | None = None
    target_department_id: UUID | None = None
    target_seniority_id: UUID | None = None
    target_job_position_id: UUID | None = None
    target_employee_level_id: UUID | None = None
    start_date: date | None = None
    end_date: date | None = None
    push_time: time | None = None
    timezone: str | None = Field(default = None, max_length = 50)
    expiry_hours: int | None = Field(default = None, ge = 1)
    question_count: int | None = Field(default = None, ge = 1, le = 50)


class DailyQuizConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    name: str
    prompt: str
    source_document_id: UUID
    target_department_id: UUID | None
    target_seniority_id: UUID | None
    target_job_position_id: UUID | None
    target_employee_level_id: UUID | None
    start_date: date
    end_date: date | None
    push_time: time
    timezone: str
    expiry_hours: int
    question_count: int
    created_by: UUID | None
    is_active: bool
    created_at: datetime


# is_correct is left out on purpose — this is what a learner sees before
# answering, so the option rows must not carry the answer key.
class DailyQuizOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    option_label: str
    option_text: str


# explanation is left out for the same reason.
class DailyQuizQuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    question_text: str
    order_index: int
    options: list[DailyQuizOptionOut]


class DailyQuizTodayResponse(BaseModel):
    id: UUID
    quiz_date: date
    expires_at: datetime
    already_submitted: bool
    questions: list[DailyQuizQuestionOut]


class DailyQuizAnswerInput(BaseModel):
    daily_quiz_question_id: UUID
    # NULL means the learner skipped the question.
    selected_option_id: UUID | None = None


class DailyQuizSubmitRequest(BaseModel):
    daily_quiz_id: UUID
    answers: list[DailyQuizAnswerInput]


class DailyQuizSubmissionAnswerResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    daily_quiz_question_id: UUID
    selected_option_id: UUID | None
    is_correct: bool | None
    points_earned: int


class DailyQuizSubmissionResponse(BaseModel):
    id: UUID
    daily_quiz_id: UUID
    quiz_date: date
    score: int
    is_late: bool
    submitted_at: datetime


class DailyQuizSubmissionDetailResponse(DailyQuizSubmissionResponse):
    answers: list[DailyQuizSubmissionAnswerResponse]
