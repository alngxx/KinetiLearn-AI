# Shared FastAPI dependencies for the KinetiLearn backend
# Routers import from this module instead of redefining session/auth wiring
import uuid
from typing import AsyncGenerator

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal
from app.core.security import decode_token
from app.modules.auth.models import User


# This function is a FastAPI dependency
# It creates one async database session per HTTP request.
# The session is automatically closed after the request finishes — even if an error occurs
# Usage in any router: db: AsyncSession = Depends(get_db)
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


oauth2_scheme = OAuth2PasswordBearer(tokenUrl = "/api/v1/auth/token")


# Decodes the bearer token, loads the user, and checks the account is active.
# Usage in any router: current_user: User = Depends(get_current_user)
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exc = HTTPException(
        status_code = 401, detail = "Could not validate credentials"
    )
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exc
        user_uuid = uuid.UUID(user_id)
    except (JWTError, ValueError):
        raise credentials_exc

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exc
    if not user.is_active:
        raise HTTPException(status_code = 401, detail = "Account is disabled")
    return user


# Requires the authenticated user to have the admin role.
# Usage in any router: _ = Depends(require_admin)
async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code = 403, detail = "Admin access required")
    return current_user
