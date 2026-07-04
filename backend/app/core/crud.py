from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def get_by_id(db: AsyncSession, model: type, id: UUID) -> Any | None:
    """
    Fetch a single record by its UUID
    Returns the instance if found, or None if it doesn't exist
    """
    result = await db.execute(select(model).where(model.id == id))
    return result.scalar_one_or_none()


async def get_or_404(db: AsyncSession, model: type, id: UUID, detail: str = "Not found.") -> Any:
    row = await get_by_id(db, model, id)
    if row is None:
        raise HTTPException(status_code = 404, detail = detail)
    return row


async def get_all(
    db: AsyncSession,
    model: type,
    skip: int = 0,
    limit: int = 100,
) -> list:
    """
    Fetch a list of records with pagination (phân trang)
    - skip: Number of records to skip (offset)
    - limit: Maximum number of records to return
    """
    result = await db.execute(select(model).offset(skip).limit(limit))
    return list(result.scalars().all())


async def create(db: AsyncSession, model: type, data: dict) -> Any:
    """
    Create a new record in the database using the provided dictionary data
    Flushes to assign an ID and refreshes to load default values
    """
    row = model(**data)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


async def update(
    db: AsyncSession,
    model: type,
    id: UUID,
    data: dict,
) -> Any | None:
    """
    Update an existing record by its UUID with the provided dictionary data.
    Dynamically sets attributes based on the data keys.
    """
    row = await get_by_id(db, model, id)
    if row is None:
        return None
    for key, value in data.items():
        setattr(row, key, value)
    await db.flush()
    await db.refresh(row)
    return row


async def soft_delete(db: AsyncSession, model: type, id: UUID) -> Any | None:
    """
    Perform a 'soft delete' on a record. 
    Instead of permanently removing it from the database, it sets `is_active` to False.
    """
    row = await get_by_id(db, model, id)
    if row is None:
        return None
    row.is_active = False
    await db.flush()
    await db.refresh(row)
    return row
