from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class DailyQuizConfig(Base):
    __tablename__ = "daily_quiz_configs"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name = Column(String(150), nullable=False)
    prompt = Column(Text, nullable=False)
    source_document_id = Column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="RESTRICT"),
        nullable=False,
    )
    target_department_id = Column(
        UUID(as_uuid=True),
        ForeignKey("departments.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_seniority_id = Column(
        UUID(as_uuid=True),
        ForeignKey("seniority_levels.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_job_position_id = Column(
        UUID(as_uuid=True),
        ForeignKey("job_positions.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_employee_level_id = Column(
        UUID(as_uuid=True),
        ForeignKey("employee_levels.id", ondelete="SET NULL"),
        nullable=True,
    )
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)
    push_time = Column(Time(timezone=False), nullable=False)
    timezone = Column(
        String(50),
        nullable=False,
        server_default=text("'Asia/Ho_Chi_Minh'"),
    )
    expiry_hours = Column(Integer, nullable=False, server_default=text("24"))
    question_count = Column(SmallInteger, nullable=False, server_default=text("5"))
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active = Column(Boolean, nullable=False, server_default=text("TRUE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    quizzes = relationship("DailyQuiz", back_populates="config")

    __table_args__ = (
        CheckConstraint(
            "end_date IS NULL OR end_date >= start_date",
            name="ck_daily_quiz_configs_end_date_after_start",
        ),
        CheckConstraint(
            "expiry_hours > 0",
            name="ck_daily_quiz_configs_expiry_hours_positive",
        ),
        CheckConstraint(
            "question_count > 0",
            name="ck_daily_quiz_configs_question_count_positive",
        ),
        Index("ix_daily_quiz_configs_is_active", "is_active"),
        Index("ix_daily_quiz_configs_target_department_id", "target_department_id"),
        Index("ix_daily_quiz_configs_target_seniority_id", "target_seniority_id"),
        Index(
            "ix_daily_quiz_configs_target_job_position_id",
            "target_job_position_id",
        ),
        Index(
            "ix_daily_quiz_configs_target_employee_level_id",
            "target_employee_level_id",
        ),
    )


class DailyQuiz(Base):
    __tablename__ = "daily_quizzes"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    config_id = Column(
        UUID(as_uuid=True),
        ForeignKey("daily_quiz_configs.id", ondelete="RESTRICT"),
        nullable=False,
    )
    quiz_date = Column(Date, nullable=False)
    generated_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    config = relationship("DailyQuizConfig", back_populates="quizzes")
    questions = relationship(
        "DailyQuizQuestion",
        back_populates="daily_quiz",
        cascade="all, delete-orphan",
    )
    submissions = relationship(
        "DailyQuizSubmission",
        back_populates="daily_quiz",
    )

    __table_args__ = (
        UniqueConstraint(
            "config_id",
            "quiz_date",
            name="uq_daily_quizzes_config_quiz_date",
        ),
        Index("ix_daily_quizzes_quiz_date", "quiz_date"),
        Index("ix_daily_quizzes_expires_at", "expires_at"),
    )


class DailyQuizQuestion(Base):
    __tablename__ = "daily_quiz_questions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    daily_quiz_id = Column(
        UUID(as_uuid=True),
        ForeignKey("daily_quizzes.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_document_id = Column(UUID(as_uuid=True), nullable=True)
    source_version_number = Column(Integer, nullable=True)
    question_text = Column(Text, nullable=False)
    explanation = Column(Text, nullable=True)
    points = Column(Integer, nullable=False, server_default=text("1"))
    order_index = Column(SmallInteger, nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    daily_quiz = relationship("DailyQuiz", back_populates="questions")
    options = relationship(
        "DailyQuizQuestionOption",
        back_populates="question",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["source_document_id", "source_version_number"],
            ["document_versions.document_id", "document_versions.version_number"],
            ondelete="SET NULL",
            name="fk_daily_quiz_questions_source_document_version",
        ),
        UniqueConstraint(
            "daily_quiz_id",
            "order_index",
            name="uq_daily_quiz_questions_quiz_order_index",
        ),
        Index("ix_daily_quiz_questions_daily_quiz_id", "daily_quiz_id"),
    )


class DailyQuizQuestionOption(Base):
    __tablename__ = "daily_quiz_question_options"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    daily_quiz_question_id = Column(
        UUID(as_uuid=True),
        ForeignKey("daily_quiz_questions.id", ondelete="CASCADE"),
        nullable=False,
    )
    option_label = Column(String(5), nullable=False)
    option_text = Column(Text, nullable=False)
    is_correct = Column(Boolean, nullable=False, server_default=text("FALSE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    question = relationship("DailyQuizQuestion", back_populates="options")

    __table_args__ = (
        UniqueConstraint(
            "daily_quiz_question_id",
            "option_label",
            name="uq_daily_quiz_question_options_question_label",
        ),
        Index(
            "ix_daily_quiz_question_options_daily_quiz_question_id",
            "daily_quiz_question_id",
        ),
    )


class DailyQuizSubmission(Base):
    __tablename__ = "daily_quiz_submissions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    daily_quiz_id = Column(
        UUID(as_uuid=True),
        ForeignKey("daily_quizzes.id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    score = Column(Integer, nullable=False, server_default=text("0"))
    time_taken_seconds = Column(Integer, nullable=True)
    submitted_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    is_late = Column(Boolean, nullable=False, server_default=text("FALSE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    daily_quiz = relationship("DailyQuiz", back_populates="submissions")
    answers = relationship(
        "DailyQuizSubmissionAnswer",
        back_populates="submission",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint(
            "daily_quiz_id",
            "user_id",
            name="uq_daily_quiz_submissions_quiz_user",
        ),
        Index("ix_daily_quiz_submissions_user_id", "user_id"),
        Index("ix_daily_quiz_submissions_daily_quiz_id", "daily_quiz_id"),
    )


class DailyQuizSubmissionAnswer(Base):
    __tablename__ = "daily_quiz_submission_answers"

    daily_quiz_submission_id = Column(
        UUID(as_uuid=True),
        ForeignKey("daily_quiz_submissions.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    daily_quiz_question_id = Column(
        UUID(as_uuid=True),
        ForeignKey("daily_quiz_questions.id", ondelete="RESTRICT"),
        primary_key=True,
        nullable=False,
    )
    selected_option_id = Column(
        UUID(as_uuid=True),
        ForeignKey("daily_quiz_question_options.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_correct = Column(Boolean, nullable=True)
    points_earned = Column(Integer, nullable=False, server_default=text("0"))
    answered_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    submission = relationship("DailyQuizSubmission", back_populates="answers")
