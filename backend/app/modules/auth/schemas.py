from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# Payload accepted on POST /users. FK tags are optional — not every user is fully
# tagged at creation time. Column is seniority_id (see User model), not seniority_level_id.
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length = 8)
    full_name: str = Field(..., min_length = 1, max_length = 100)
    role: str = "learner"
    department_id: Optional[UUID] = None
    seniority_id: Optional[UUID] = None
    job_position_id: Optional[UUID] = None
    employee_level_id: Optional[UUID] = None


# Payload accepted on PUT /users/{id} — partial profile update. No password or role
# here; those have dedicated endpoints.
class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = Field(default = None, min_length = 1, max_length = 100)
    department_id: Optional[UUID] = None
    seniority_id: Optional[UUID] = None
    job_position_id: Optional[UUID] = None
    employee_level_id: Optional[UUID] = None


# Payload accepted on PUT /users/me/password.
class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length = 8)


# Response shape for all user endpoints. Never includes password_hash.
class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    email: EmailStr
    full_name: str
    role: str
    is_active: bool
    department_id: Optional[UUID]
    seniority_id: Optional[UUID]
    job_position_id: Optional[UUID]
    employee_level_id: Optional[UUID]
    created_at: datetime
