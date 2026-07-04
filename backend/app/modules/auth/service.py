from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import get_or_404
from app.core.security import create_access_token as create_jwt
from app.core.security import get_password_hash, verify_password
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    PasswordChange,
    UserCreate,
    UserResponse,
    UserUpdate,
)


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def authenticate(self, email: str, password: str) -> User:
        result = await self.db.execute(
            select(User).where(func.lower(User.email) == email.lower())
        )
        user = result.scalar_one_or_none()
        if user is None or not verify_password(password, user.password_hash):
            raise HTTPException(status_code = 401, detail = "Invalid credentials")
        if not user.is_active:
            raise HTTPException(status_code = 401, detail = "Account is disabled")
        return user

    def create_access_token(self, user: User) -> str:
        return create_jwt({"sub": str(user.id), "role": user.role})


class UserService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _email_taken(self, email: str, exclude_id: UUID | None = None) -> bool:
        stmt = select(User.id).where(func.lower(User.email) == email.lower())
        if exclude_id is not None:
            stmt = stmt.where(User.id != exclude_id)
        result = await self.db.execute(stmt.limit(1))
        return result.scalar_one_or_none() is not None

    async def create(self, data: UserCreate) -> UserResponse:
        if await self._email_taken(data.email):
            raise HTTPException(status_code = 409, detail = "Email already exists")

        row = User(
            email = data.email,
            password_hash = get_password_hash(data.password),
            full_name = data.full_name,
            role = data.role,
            department_id = data.department_id,
            seniority_id = data.seniority_id,
            job_position_id = data.job_position_id,
            employee_level_id = data.employee_level_id,
        )
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return UserResponse.model_validate(row)

    async def get_all(
        self,
        role: str | None = None,
        department_id: UUID | None = None,
        seniority_id: UUID | None = None,
        employee_level_id: UUID | None = None,
    ) -> list[UserResponse]:
        stmt = select(User)
        if role is not None:
            stmt = stmt.where(User.role == role)
        if department_id is not None:
            stmt = stmt.where(User.department_id == department_id)
        if seniority_id is not None:
            stmt = stmt.where(User.seniority_id == seniority_id)
        if employee_level_id is not None:
            stmt = stmt.where(User.employee_level_id == employee_level_id)
        result = await self.db.execute(stmt)
        return [UserResponse.model_validate(row) for row in result.scalars().all()]

    async def get_by_id(self, user_id: UUID) -> UserResponse:
        row = await get_or_404(self.db, User, user_id, "User not found.")
        return UserResponse.model_validate(row)

    async def update(self, user_id: UUID, data: UserUpdate) -> UserResponse:
        row = await get_or_404(self.db, User, user_id, "User not found.")
        update_data = data.model_dump(exclude_none = True)

        new_email = update_data.get("email")
        if new_email is not None and new_email.lower() != row.email.lower():
            if await self._email_taken(new_email, exclude_id = user_id):
                raise HTTPException(status_code = 409, detail = "Email already exists")

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return UserResponse.model_validate(row)

    async def change_password(self, user_id: UUID, data: PasswordChange) -> UserResponse:
        row = await get_or_404(self.db, User, user_id, "User not found.")
        if not verify_password(data.current_password, row.password_hash):
            raise HTTPException(status_code = 400, detail = "Current password incorrect")
        row.password_hash = get_password_hash(data.new_password)
        await self.db.commit()
        await self.db.refresh(row)
        return UserResponse.model_validate(row)

    async def activate(self, user_id: UUID) -> UserResponse:
        row = await get_or_404(self.db, User, user_id, "User not found.")
        row.is_active = True
        await self.db.commit()
        await self.db.refresh(row)
        return UserResponse.model_validate(row)

    async def deactivate(self, user_id: UUID) -> UserResponse:
        row = await get_or_404(self.db, User, user_id, "User not found.")
        row.is_active = False
        await self.db.commit()
        await self.db.refresh(row)
        return UserResponse.model_validate(row)
