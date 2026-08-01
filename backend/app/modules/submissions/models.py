from sqlalchemy import (
    Boolean,
    Column,
    ForeignKey,
    Index,
    Integer,
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
