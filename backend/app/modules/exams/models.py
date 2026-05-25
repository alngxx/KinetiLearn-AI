from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class Exercise(Base):
    __tablename__ = "exercises"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    class_id = Column(
        UUID(as_uuid=True),
        ForeignKey("classes.id", ondelete="RESTRICT"),
        nullable=False,
    )
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    start_time = Column(TIMESTAMP(timezone=True), nullable=False)
    end_time = Column(TIMESTAMP(timezone=True), nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    pass_score = Column(Integer, nullable=False)
    total_points = Column(Integer, nullable=False)
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

    class_ = relationship("Class", back_populates="exercises")
    questions = relationship(
        "Question",
        back_populates="exercise",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint("end_time > start_time", name="ck_exercises_end_after_start"),
        CheckConstraint(
            "pass_score >= 0 AND pass_score <= total_points",
            name="ck_exercises_pass_score_within_total",
        ),
        Index("ix_exercises_class_id", "class_id"),
        Index("ix_exercises_start_time", "start_time"),
        Index("ix_exercises_end_time", "end_time"),
    )


class Question(Base):
    __tablename__ = "questions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    exercise_id = Column(
        UUID(as_uuid=True),
        ForeignKey("exercises.id", ondelete="CASCADE"),
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

    exercise = relationship("Exercise", back_populates="questions")
    options = relationship(
        "QuestionOption",
        back_populates="question",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["source_document_id", "source_version_number"],
            ["document_versions.document_id", "document_versions.version_number"],
            ondelete="SET NULL",
            name="fk_questions_source_document_version",
        ),
        UniqueConstraint(
            "exercise_id",
            "order_index",
            name="uq_questions_exercise_order_index",
        ),
        Index("ix_questions_exercise_id", "exercise_id"),
    )


class QuestionOption(Base):
    __tablename__ = "question_options"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    question_id = Column(
        UUID(as_uuid=True),
        ForeignKey("questions.id", ondelete="CASCADE"),
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

    question = relationship("Question", back_populates="options")

    __table_args__ = (
        UniqueConstraint(
            "question_id",
            "option_label",
            name="uq_question_options_question_label",
        ),
        Index("ix_question_options_question_id", "question_id"),
    )
