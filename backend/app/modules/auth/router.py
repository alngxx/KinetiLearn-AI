from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, require_admin
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    LoginRequest,
    PasswordChange,
    TokenResponse,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from app.modules.auth.service import AuthService, UserService

router = APIRouter()


@router.post("/login", response_model = TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    service = AuthService(db)
    user = await service.authenticate(body.email, body.password)
    token = service.create_access_token(user)
    return TokenResponse(access_token = token)


users_router = APIRouter(prefix = "/users", tags = ["Users"])


@users_router.post(
    "",
    response_model = UserResponse,
    status_code = status.HTTP_201_CREATED,
    dependencies = [Depends(require_admin)],
)
async def create_user(data: UserCreate, db: AsyncSession = Depends(get_db)):
    return await UserService(db).create(data)


@users_router.get(
    "",
    response_model = list[UserResponse],
    dependencies = [Depends(require_admin)],
)
async def list_users(
    role: str | None = None,
    department_id: UUID | None = None,
    seniority_id: UUID | None = None,
    employee_level_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await UserService(db).get_all(role, department_id, seniority_id, employee_level_id)


# Must be declared before GET /{user_id} so "me" isn't matched as a UUID path param.
@users_router.get("/me", response_model = UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


# Likewise declared before PUT /{user_id}. Any authenticated user changes only their own password.
@users_router.put("/me/password", response_model = UserResponse)
async def change_my_password(
    data: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await UserService(db).change_password(current_user.id, data)


@users_router.get(
    "/{user_id}",
    response_model = UserResponse,
    dependencies = [Depends(require_admin)],
)
async def get_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    return await UserService(db).get_by_id(user_id)


@users_router.put(
    "/{user_id}",
    response_model = UserResponse,
    dependencies = [Depends(require_admin)],
)
async def update_user(user_id: UUID, data: UserUpdate, db: AsyncSession = Depends(get_db)):
    return await UserService(db).update(user_id, data)


@users_router.patch(
    "/{user_id}/activate",
    response_model = UserResponse,
    dependencies = [Depends(require_admin)],
)
async def activate_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    return await UserService(db).activate(user_id)


@users_router.patch(
    "/{user_id}/deactivate",
    response_model = UserResponse,
    dependencies = [Depends(require_admin)],
)
async def deactivate_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    return await UserService(db).deactivate(user_id)
