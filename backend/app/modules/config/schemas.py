from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


# Payload accepted on POST /categories — only fields a client can set on creation.
class CategoryCreate(BaseModel):
    # Display name, must be unique across all categories (DB enforces).
    name: str = Field(..., min_length = 1, max_length = 100, pattern = r"^[a-zA-Z0-9]+$")
    # Optional free-text description shown in the admin UI.
    description: Optional[str] = None


# Payload accepted on PATCH /categories/{id} — every field optional for partial updates.
class CategoryUpdate(BaseModel):
    # New display name; uniqueness still enforced by the DB.
    name: Optional[str] = Field(default = None, min_length = 1, max_length = 100, pattern = r"^[a-zA-Z0-9]+$")
    # New description, or null to clear it.
    description: Optional[str] = None





# Response shape returned by all category endpoints.
class CategoryResponse(BaseModel):
    # Lets Pydantic build instances directly from SQLAlchemy ORM objects.
    model_config = ConfigDict(from_attributes = True)

    # Primary key from the DB (UUID).
    id: UUID
    # Display name.
    name: str
    # Optional description.
    description: Optional[str]
    # Whether the category is currently usable.
    is_active: bool
    # DB-managed creation timestamp (TIMESTAMPTZ).
    created_at: datetime


# Payload accepted on POST /skills.
class SkillCreate(BaseModel):
    category_id: UUID
    name: str = Field(..., min_length = 1, max_length = 100, pattern = r"^[a-zA-Z0-9]+$")
    description: Optional[str] = None
    basic_max: int = Field(..., ge = 0)
    intermediate_max: int = Field(..., ge = 0)

    @model_validator(mode = "after")
    def check_thresholds(self) -> "SkillCreate":
        if self.intermediate_max <= self.basic_max:
            raise ValueError("intermediate_max must be greater than basic_max")
        return self


# Payload accepted on PATCH /skills/{id}. Any subset of fields may be sent.
class SkillUpdate(BaseModel):
    category_id: Optional[UUID] = None
    name: Optional[str] = Field(default = None, min_length = 1, max_length = 100, pattern = r"^[a-zA-Z0-9]+$")
    description: Optional[str] = None
    basic_max: Optional[int] = Field(default = None, ge = 0)
    intermediate_max: Optional[int] = Field(default = None, ge = 0)

    @model_validator(mode = "after")
    def check_thresholds(self) -> "SkillUpdate":
        if self.basic_max is not None and self.intermediate_max is not None:
            if self.intermediate_max <= self.basic_max:
                raise ValueError("intermediate_max must be greater than basic_max")
        return self


# Response shape returned by all skill endpoints.
class SkillResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    category_id: UUID
    name: str
    description: Optional[str]
    basic_max: int
    intermediate_max: int
    is_active: bool
    created_at: datetime


# Payload accepted on POST /departments — only fields a client can set on creation.
class DepartmentCreate(BaseModel):
    # Display name, must be unique across all departments (DB enforces).
    name: str = Field(..., min_length = 1, max_length = 100, pattern = r"^[a-zA-Z0-9]+$")
    # Optional free-text description shown in the admin UI.
    description: Optional[str] = None


# Payload accepted on PATCH /departments/{id} — every field optional for partial updates.
class DepartmentUpdate(BaseModel):
    # New display name; uniqueness still enforced by the DB.
    name: Optional[str] = Field(default = None, min_length = 1, max_length = 100, pattern = r"^[a-zA-Z0-9]+$")
    # New description, or null to clear it.
    description: Optional[str] = None


# Response shape returned by all department endpoints.
class DepartmentResponse(BaseModel):
    # Lets Pydantic build instances directly from SQLAlchemy ORM objects.
    model_config = ConfigDict(from_attributes = True)

    # Primary key from the DB (UUID).
    id: UUID
    # Display name.
    name: str
    # Optional description.
    description: Optional[str]
    # Whether the department is currently usable.
    is_active: bool
    # DB-managed creation timestamp (TIMESTAMPTZ).
    created_at: datetime


# Payload accepted on POST /seniority-levels — name plus a unique numeric rank.
class SeniorityLevelCreate(BaseModel):
    # Display name, must be unique across all seniority levels (DB enforces).
    name: str = Field(..., min_length = 1, max_length = 50, pattern = r"^[a-zA-Z0-9]+$")
    # Numeric ordering rank, must be unique (DB enforces).
    rank: int = Field(..., ge = 0)


# Payload accepted on PATCH /seniority-levels/{id} — every field optional for partial updates.
class SeniorityLevelUpdate(BaseModel):
    # New display name; uniqueness still enforced by the DB.
    name: Optional[str] = Field(default = None, min_length = 1, max_length = 50, pattern = r"^[a-zA-Z0-9]+$")
    # New rank; uniqueness still enforced by the DB.
    rank: Optional[int] = Field(default = None, ge = 0)


# Response shape returned by all seniority level endpoints.
class SeniorityLevelResponse(BaseModel):
    # Lets Pydantic build instances directly from SQLAlchemy ORM objects.
    model_config = ConfigDict(from_attributes = True)

    # Primary key from the DB (UUID).
    id: UUID
    # Display name.
    name: str
    # Numeric ordering rank.
    rank: int
    # Whether the seniority level is currently usable.
    is_active: bool
    # DB-managed creation timestamp (TIMESTAMPTZ).
    created_at: datetime


# Payload accepted on POST /job-positions — only fields a client can set on creation.
class JobPositionCreate(BaseModel):
    # Display name, must be unique across all job positions (DB enforces).
    name: str = Field(..., min_length = 1, max_length = 100)
    # Optional free-text description shown in the admin UI.
    description: Optional[str] = None


# Payload accepted on PATCH /job-positions/{id} — every field optional for partial updates.
class JobPositionUpdate(BaseModel):
    # New display name; uniqueness still enforced by the DB.
    name: Optional[str] = Field(default = None, min_length = 1, max_length = 100, pattern = r"^[a-zA-Z0-9]+$")
    # New description, or null to clear it.
    description: Optional[str] = None


# Response shape returned by all job position endpoints.
class JobPositionResponse(BaseModel):
    # Lets Pydantic build instances directly from SQLAlchemy ORM objects.
    model_config = ConfigDict(from_attributes = True)

    # Primary key from the DB (UUID).
    id: UUID
    # Display name.
    name: str
    # Optional description.
    description: Optional[str]
    # Whether the job position is currently usable.
    is_active: bool
    # DB-managed creation timestamp (TIMESTAMPTZ).
    created_at: datetime


# Payload accepted on POST /employee-levels — name plus a unique numeric rank.
class EmployeeLevelCreate(BaseModel):
    # Display name, must be unique across all employee levels (DB enforces).
    name: str = Field(..., min_length = 1, max_length = 50)
    # Numeric ordering rank, must be unique (DB enforces).
    rank: int = Field(..., ge = 0)


# Payload accepted on PATCH /employee-levels/{id} — every field optional for partial updates.
class EmployeeLevelUpdate(BaseModel):
    # New display name; uniqueness still enforced by the DB.
    name: Optional[str] = Field(default = None, min_length = 1, max_length = 50, pattern = r"^[a-zA-Z0-9]+$")
    # New rank; uniqueness still enforced by the DB.
    rank: Optional[int] = Field(default = None, ge = 0)


# Response shape returned by all employee level endpoints.
class EmployeeLevelResponse(BaseModel):
    # Lets Pydantic build instances directly from SQLAlchemy ORM objects.
    model_config = ConfigDict(from_attributes = True)

    # Primary key from the DB (UUID).
    id: UUID
    # Display name.
    name: str
    # Numeric ordering rank.
    rank: int
    # Whether the employee level is currently usable.
    is_active: bool
    # DB-managed creation timestamp (TIMESTAMPTZ).
    created_at: datetime
