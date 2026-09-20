from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
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


# Form-based login so the Swagger "Authorize" button works. The OAuth2 password
# flow sends the email in the `username` field.
@router.post("/token", response_model = TokenResponse)
async def login_form(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    service = AuthService(db)
    user = await service.authenticate(form_data.username, form_data.password)
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
# Takes db only so the response can go through UserService, which is what turns
# the stored R2 key into a signed avatar URL. get_current_user already depends on
# get_db and FastAPI caches sub-dependencies per request, so this is the same
# session and costs nothing.
@users_router.get("/me", response_model = UserResponse)
async def get_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return UserService(db).to_response(current_user)


# Likewise declared before PUT /{user_id}. Any authenticated user changes only their own password.
@users_router.put("/me/password", response_model = UserResponse)
async def change_my_password(
    data: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await UserService(db).change_password(current_user.id, data)


# Everyone manages their own picture, so these are get_current_user rather than
# require_admin. Declared before /{user_id} for the same reason as /me.
@users_router.post("/me/avatar", response_model = UserResponse)
async def set_my_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await UserService(db).set_avatar(current_user.id, file)


@users_router.delete("/me/avatar", response_model = UserResponse)
async def remove_my_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await UserService(db).remove_avatar(current_user.id)


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
