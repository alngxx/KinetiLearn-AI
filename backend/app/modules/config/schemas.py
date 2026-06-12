from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


# Payload accepted on POST /categories — only fields a client can set on creation.
class CategoryCreate(BaseModel):
    # Display name, must be unique across all categories (DB enforces).
    name: str = Field(..., min_length = 1, max_length = 100)
    # Optional free-text description shown in the admin UI.
    description: Optional[str] = None


# Payload accepted on PATCH /categories/{id} — every field optional for partial updates.
class CategoryUpdate(BaseModel):
    # New display name; uniqueness still enforced by the DB.
    name: Optional[str] = Field(default = None, min_length = 1, max_length = 100)
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


# Payload accepted on POST /skills — full skill definition including the three score bands.
# Bands must be contiguous: intermediate_min = basic_max + 1, advanced_min = intermediate_max + 1.
class SkillCreate(BaseModel):
    # Category this skill belongs to; must reference an existing category.
    category_id: UUID
    # Skill name, unique within its category (DB enforces).
    name: str = Field(..., min_length = 1, max_length = 100)
    # Optional free-text description.
    description: Optional[str] = None
    # Lower bound of the "basic" band (inclusive). Defaults to 0 to match the DB default.
    basic_min: int = Field(default = 0, ge = 0)
    # Upper bound of the "basic" band (inclusive).
    basic_max: int = Field(..., ge = 0)
    # Lower bound of the "intermediate" band — must equal basic_max + 1.
    intermediate_min: int = Field(..., ge = 0)
    # Upper bound of the "intermediate" band.
    intermediate_max: int = Field(..., ge = 0)
    # Lower bound of the "advanced" band — must equal intermediate_max + 1.
    advanced_min: int = Field(..., ge = 0)
    # Upper bound of the "advanced" band.
    advanced_max: int = Field(..., ge = 0)

    # Reject payloads where bands are misordered or non-contiguous before they hit the DB,
    # so the client gets a 422 with a readable message instead of an IntegrityError.
    @model_validator(mode = "after")
    def check_band_contiguity(self) -> "SkillCreate":
        if self.basic_max < self.basic_min:
            raise ValueError("basic_max must be >= basic_min")
        if self.intermediate_min != self.basic_max + 1:
            raise ValueError("intermediate_min must equal basic_max + 1")
        if self.intermediate_max < self.intermediate_min:
            raise ValueError("intermediate_max must be >= intermediate_min")
        if self.advanced_min != self.intermediate_max + 1:
            raise ValueError("advanced_min must equal intermediate_max + 1")
        if self.advanced_max < self.advanced_min:
            raise ValueError("advanced_max must be >= advanced_min")
        return self


# Payload accepted on PATCH /skills/{id}. Any subset of fields may be sent.
# Range checks only run on the pairs the caller actually provided; the service layer
# must re-validate the full merged record against the DB before saving.
class SkillUpdate(BaseModel):
    # Move skill to a different category.
    category_id: Optional[UUID] = None
    # New skill name (unique within category).
    name: Optional[str] = Field(default = None, min_length = 1, max_length = 100)
    # New description, or null to clear.
    description: Optional[str] = None
    # Lower bound of the "basic" band.
    basic_min: Optional[int] = Field(default = None, ge = 0)
    # Upper bound of the "basic" band.
    basic_max: Optional[int] = Field(default = None, ge = 0)
    # Lower bound of the "intermediate" band.
    intermediate_min: Optional[int] = Field(default = None, ge = 0)
    # Upper bound of the "intermediate" band.
    intermediate_max: Optional[int] = Field(default = None, ge = 0)
    # Lower bound of the "advanced" band.
    advanced_min: Optional[int] = Field(default = None, ge = 0)
    # Upper bound of the "advanced" band.
    advanced_max: Optional[int] = Field(default = None, ge = 0)

    # Validate only the pairs the caller actually supplied. Partial updates may omit
    # half of a band, in which case the service layer fills the missing side from the DB row.
    @model_validator(mode = "after")
    def check_partial_band_consistency(self) -> "SkillUpdate":
        if self.basic_min is not None and self.basic_max is not None:
            if self.basic_max < self.basic_min:
                raise ValueError("basic_max must be >= basic_min")
        if self.basic_max is not None and self.intermediate_min is not None:
            if self.intermediate_min != self.basic_max + 1:
                raise ValueError("intermediate_min must equal basic_max + 1")
        if self.intermediate_min is not None and self.intermediate_max is not None:
            if self.intermediate_max < self.intermediate_min:
                raise ValueError("intermediate_max must be >= intermediate_min")
        if self.intermediate_max is not None and self.advanced_min is not None:
            if self.advanced_min != self.intermediate_max + 1:
                raise ValueError("advanced_min must equal intermediate_max + 1")
        if self.advanced_min is not None and self.advanced_max is not None:
            if self.advanced_max < self.advanced_min:
                raise ValueError("advanced_max must be >= advanced_min")
        return self


# Response shape returned by all skill endpoints.
class SkillResponse(BaseModel):
    # Lets Pydantic build instances directly from SQLAlchemy ORM objects.
    model_config = ConfigDict(from_attributes = True)

    # Primary key (UUID).
    id: UUID
    # Owning category.
    category_id: UUID
    # Skill name.
    name: str
    # Optional description.
    description: Optional[str]
    # Lower bound of the "basic" band.
    basic_min: int
    # Upper bound of the "basic" band.
    basic_max: int
    # Lower bound of the "intermediate" band.
    intermediate_min: int
    # Upper bound of the "intermediate" band.
    intermediate_max: int
    # Lower bound of the "advanced" band.
    advanced_min: int
    # Upper bound of the "advanced" band.
    advanced_max: int
    # Whether the skill is currently usable.
    is_active: bool
    # DB-managed creation timestamp.
    created_at: datetime


# Payload accepted on POST /departments — only fields a client can set on creation.
class DepartmentCreate(BaseModel):
    # Display name, must be unique across all departments (DB enforces).
    name: str = Field(..., min_length = 1, max_length = 100)
    # Optional free-text description shown in the admin UI.
    description: Optional[str] = None


# Payload accepted on PATCH /departments/{id} — every field optional for partial updates.
class DepartmentUpdate(BaseModel):
    # New display name; uniqueness still enforced by the DB.
    name: Optional[str] = Field(default = None, min_length = 1, max_length = 100)
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
    name: str = Field(..., min_length = 1, max_length = 50)
    # Numeric ordering rank, must be unique (DB enforces).
    rank: int = Field(..., ge = 0)


# Payload accepted on PATCH /seniority-levels/{id} — every field optional for partial updates.
class SeniorityLevelUpdate(BaseModel):
    # New display name; uniqueness still enforced by the DB.
    name: Optional[str] = Field(default = None, min_length = 1, max_length = 50)
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
