from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    exercise_id = Column(
        UUID(as_uuid=True),
        ForeignKey("exercises.id", ondelete="RESTRICT"),
        nullable=False,
    )
    attempt_number = Column(Integer, nullable=False, server_default=text("1"))
    started_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    submitted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    time_taken_seconds = Column(Integer, nullable=True)
    score = Column(Integer, nullable=True)
    is_passed = Column(Boolean, nullable=True)
    is_late = Column(Boolean, nullable=False, server_default=text("FALSE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    user = relationship("User")
    exercise = relationship("Exercise")
    answers = relationship(
        "SubmissionAnswer",
        back_populates="submission",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "exercise_id",
            "attempt_number",
            name="uq_submissions_user_exercise_attempt",
        ),
        Index("ix_submissions_user_id", "user_id"),
        Index("ix_submissions_exercise_id", "exercise_id"),
    )


class SubmissionAnswer(Base):
    __tablename__ = "submission_answers"

    submission_id = Column(
        UUID(as_uuid=True),
        ForeignKey("submissions.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    question_id = Column(
        UUID(as_uuid=True),
        ForeignKey("questions.id", ondelete="RESTRICT"),
        primary_key=True,
        nullable=False,
    )
    selected_option_id = Column(
        UUID(as_uuid=True),
        ForeignKey("question_options.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_correct = Column(Boolean, nullable=True)
    points_earned = Column(Integer, nullable=False, server_default=text("0"))
    answered_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    submission = relationship("Submission", back_populates="answers")


class SkillScore(Base):
    __tablename__ = "skill_scores"

    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    skill_id = Column(
        UUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="RESTRICT"),
        primary_key=True,
        nullable=False,
    )
    cumulative_score = Column(Integer, nullable=False, server_default=text("0"))
    current_level = Column(
        String(20),
        nullable=False,
        server_default=text("'basic'"),
    )
    last_updated_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (
        CheckConstraint(
            "current_level IN ('basic', 'intermediate', 'advanced')",
            name="ck_skill_scores_current_level_valid",
        ),
        Index("ix_skill_scores_user_id", "user_id"),
        Index("ix_skill_scores_skill_id", "skill_id"),
    )


class SkillScoreHistory(Base):
    __tablename__ = "skill_score_history"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    skill_id = Column(
        UUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="RESTRICT"),
        nullable=False,
    )
    score_delta = Column(Integer, nullable=False)
    source_type = Column(String(20), nullable=False)
    submission_id = Column(
        UUID(as_uuid=True),
        ForeignKey("submissions.id", ondelete="SET NULL"),
        nullable=True,
    )
    daily_quiz_submission_id = Column(
        UUID(as_uuid=True),
        ForeignKey("daily_quiz_submissions.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (
        CheckConstraint(
            "source_type IN ('exam', 'daily_quiz')",
            name="ck_skill_score_history_source_type_valid",
        ),
        CheckConstraint(
            "(source_type = 'exam' AND submission_id IS NOT NULL AND daily_quiz_submission_id IS NULL)"
            " OR "
            "(source_type = 'daily_quiz' AND daily_quiz_submission_id IS NOT NULL AND submission_id IS NULL)",
            name="ck_skill_score_history_source_consistency",
        ),
        Index(
            "ix_skill_score_history_user_skill",
            "user_id",
            "skill_id",
        ),
        Index("ix_skill_score_history_created_at", "created_at"),
    )
