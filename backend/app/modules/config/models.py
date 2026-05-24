from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
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


class Category(Base):
    __tablename__ = "categories"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("TRUE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    skills = relationship("Skill", back_populates="category")


class Skill(Base):
    __tablename__ = "skills"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    basic_min = Column(Integer, nullable=False, server_default=text("0"))
    basic_max = Column(Integer, nullable=False)
    intermediate_min = Column(Integer, nullable=False)
    intermediate_max = Column(Integer, nullable=False)
    advanced_min = Column(Integer, nullable=False)
    advanced_max = Column(Integer, nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("TRUE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    category = relationship("Category", back_populates="skills")

    __table_args__ = (
        CheckConstraint(
            "intermediate_min = basic_max + 1",
            name="ck_skills_intermediate_min_follows_basic_max",
        ),
        CheckConstraint(
            "advanced_min = intermediate_max + 1",
            name="ck_skills_advanced_min_follows_intermediate_max",
        ),
        UniqueConstraint("category_id", "name", name="uq_skills_category_name"),
        Index("ix_skills_category_id", "category_id"),
    )


class Department(Base):
    __tablename__ = "departments"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("TRUE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class SeniorityLevel(Base):
    __tablename__ = "seniority_levels"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name = Column(String(50), nullable=False, unique=True)
    rank = Column(SmallInteger, nullable=False, unique=True)
    is_active = Column(Boolean, nullable=False, server_default=text("TRUE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class JobPosition(Base):
    __tablename__ = "job_positions"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("TRUE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class EmployeeLevel(Base):
    __tablename__ = "employee_levels"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name = Column(String(50), nullable=False, unique=True)
    rank = Column(SmallInteger, nullable=False, unique=True)
    is_active = Column(Boolean, nullable=False, server_default=text("TRUE"))
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
