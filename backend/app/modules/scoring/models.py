from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID

from app.core.database import Base


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
