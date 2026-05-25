# Shared FastAPI dependencies for the KinetiLearn backend
# Routers import from this module instead of redefining session/auth wiring
from typing import AsyncGenerator

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal


# This function is a FastAPI dependency
# It creates one async database session per HTTP request.
# The session is automatically closed after the request finishes — even if an error occurs
# Usage in any router: db: AsyncSession = Depends(get_db)
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


# This is a placeholder for the real admin auth check — will be implemented in Week 3.
# For now it always raises 401 so we know auth is wired but not yet active.
# Usage in any router: _ = Depends(require_admin)
async def require_admin():
    raise HTTPException(status_code = 401, detail = "Not authenticated")
