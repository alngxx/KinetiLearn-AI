from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    email = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(150), nullable=False)
    role = Column(String(20), nullable=False, server_default=text("'learner'"))
    department_id = Column(
        UUID(as_uuid=True),
        ForeignKey("departments.id", ondelete="RESTRICT"),
        nullable=True,
    )
    seniority_id = Column(
        UUID(as_uuid=True),
        ForeignKey("seniority_levels.id", ondelete="RESTRICT"),
        nullable=True,
    )
    job_position_id = Column(
        UUID(as_uuid=True),
        ForeignKey("job_positions.id", ondelete="RESTRICT"),
        nullable=True,
    )
    employee_level_id = Column(
        UUID(as_uuid=True),
        ForeignKey("employee_levels.id", ondelete="RESTRICT"),
        nullable=True,
    )
    is_active = Column(Boolean, nullable=False, server_default=text("TRUE"))
    last_login_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    department = relationship(
        "Department",
        foreign_keys=[department_id],
        lazy="select",
    )
    seniority_level = relationship(
        "SeniorityLevel",
        foreign_keys=[seniority_id],
        lazy="select",
    )
    job_position = relationship(
        "JobPosition",
        foreign_keys=[job_position_id],
        lazy="select",
    )
    employee_level = relationship(
        "EmployeeLevel",
        foreign_keys=[employee_level_id],
        lazy="select",
    )

    __table_args__ = (
        CheckConstraint(
            "role IN ('admin', 'learner')",
            name="ck_users_role_valid",
        ),
        Index("ix_users_email", "email"),
        Index("ix_users_role", "role"),
        Index("ix_users_department_id", "department_id"),
        Index("ix_users_is_active", "is_active"),
    )
