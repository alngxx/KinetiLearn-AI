from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ClassCreate(BaseModel):
    name: str = Field(..., min_length = 1, max_length = 150)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class ClassUpdate(BaseModel):
    name: str | None = Field(default = None, min_length = 1, max_length = 150)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class DeleteResponse(BaseModel):
    deleted: int


class ClassResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    name: str
    description: str | None
    start_date: date | None
    end_date: date | None
    created_by: UUID | None
    is_active: bool
    created_at: datetime


# Exercises are attached to a class at generation time (exercises.class_id), so
# the class detail only surfaces them. end_time is the exercise deadline.
class ClassExerciseSummary(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    is_active: bool


class ClassDetailResponse(ClassResponse):
    member_count: int
    exercises: list[ClassExerciseSummary]


# Filters are combined with AND, matching the daily_quiz_configs audience
# targeting precedent. At least one must be provided (checked in the service).
class BulkAddMembersRequest(BaseModel):
    department_id: UUID | None = None
    employee_level_id: UUID | None = None
    seniority_id: UUID | None = None


class BulkAddMembersResponse(BaseModel):
    total_matched: int
    added: int
    skipped: int


# The Class columns a learner is allowed to see — no created_by. Split out so the
# service can build it straight off the ORM row, same as ClassResponse.
class MyClassBase(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    name: str
    description: str | None
    start_date: date | None
    end_date: date | None


# Progress is "how many of the class's finalized exercises this learner has
# submitted at least once".
class MyClassResponse(MyClassBase):
    enrolled_at: datetime
    exercise_count: int
    completed_exercise_count: int


# The Exercise columns a learner may see. Carries the schedule so the UI can show
# a deadline. No question content — that comes from GET /exams/{id}/take.
class LearnerExerciseBase(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    title: str
    description: str | None
    start_time: datetime
    end_time: datetime
    duration_minutes: int
    pass_score: int
    total_points: int


class LearnerExerciseSummary(LearnerExerciseBase):
    question_count: int
    # The caller's own attempts only. 0 means "chưa làm".
    attempt_count: int
    best_score: int | None
    is_passed: bool | None
    # Only populated for single-document exercises: a multi-document exam awards
    # no skill points at all, so listing skills for one would promise something
    # the scoring engine never delivers.
    skill_names: list[str]


# No file_url and no version: the storage key stays server-side, and a download
# goes through the separate membership-checked endpoint that mints a short-lived
# signed URL per click. Restricted to documents the AI Mentor can actually
# answer from (see ClassService.get_my_documents), so this list and the mentor's
# knowledge never disagree.
class LearnerDocumentSummary(BaseModel):
    id: UUID
    title: str
    category_name: str | None
    # "PDF" / "DOCX" / "MD" — MIME_EXT's extension, upper-cased for display.
    format: str


# A signed R2 URL, good for DOWNLOAD_URL_EXPIRE_SECONDS and nothing longer. It
# carries its own signature, so it needs no bearer token — which is exactly why
# it expires quickly. expires_in rides along so the UI could say so if it ever
# needs to; the URL is never stored.
class LearnerDocumentDownload(BaseModel):
    url: str
    expires_in: int
