import logging
from uuid import UUID, uuid4

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crud import get_or_404
from app.core.security import create_access_token as create_jwt
from app.core.security import get_password_hash, verify_password
from app.core.storage import R2Storage, StorageError
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    PasswordChange,
    UserCreate,
    UserResponse,
    UserUpdate,
)

logger = logging.getLogger(__name__)

AVATAR_MAX_SIZE = 2 * 1024 * 1024


# Sniffed from the bytes, not from file.content_type, which the client sets and
# can lie about. The extension follows what the file actually is, so nothing
# arbitrary ends up stored under an image URL. Documents deliberately does the
# opposite (it trusts a .md filename) because there the worst case is a
# mislabelled text file, not bytes served back to a browser.
def _image_kind(content: bytes) -> tuple[str, str] | None:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


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
        # One client per request at most, built on first use. R2Storage()
        # constructs a boto3 client, which is ~1.7ms of synchronous work;
        # get_all is unpaginated, so building one per row would park hundreds
        # of milliseconds of CPU on the event loop for a full roster.
        self._storage: R2Storage | None = None
        self._storage_unavailable = False

    def _get_storage(self) -> R2Storage | None:
        if self._storage is None and not self._storage_unavailable:
            try:
                self._storage = R2Storage()
            except StorageError:
                self._storage_unavailable = True
                logger.warning("R2 is not configured; avatars fall back to initials")
        return self._storage

    def _avatar_link(self, key: str | None) -> str | None:
        # A user without an avatar never touches storage. That is not just
        # speed: seeding and tests run with empty R2_* settings, where building
        # a client raises.
        if key is None:
            return None
        storage = self._get_storage()
        if storage is None:
            return None
        try:
            return storage.get_presigned_url(
                key,
                expires_in = settings.AVATAR_URL_EXPIRE_SECONDS,
            )
        except StorageError:
            # Initials are a better failure than a 500 on every page that shows
            # a name, but an operator still needs to know the bucket went away.
            logger.exception("Could not sign avatar %s", key)
            return None

    # The single place users.avatar_url (an R2 key) becomes UserResponse.avatar_url
    # (a signed URL). Every user endpoint goes through here so the raw key has
    # exactly one meaning and never leaves the service.
    def to_response(self, row: User) -> UserResponse:
        response = UserResponse.model_validate(row)
        response.avatar_url = self._avatar_link(row.avatar_url)
        return response

    async def set_avatar(self, user_id: UUID, file: UploadFile) -> UserResponse:
        content = await file.read()
        if len(content) > AVATAR_MAX_SIZE:
            raise HTTPException(status_code = 422, detail = "Image exceeds the 2 MB limit")

        kind = _image_kind(content)
        if kind is None:
            raise HTTPException(
                status_code = 422,
                detail = "File must be a PNG, JPEG, or WebP image",
            )
        ext, content_type = kind

        row = await get_or_404(self.db, User, user_id, "User not found.")
        # Captured before the row is touched: this is what gets cleaned up once
        # a replacement is committed in its place.
        old_key = row.avatar_url
        # A fresh key every time rather than a stable one per user. The browser
        # caches the image behind its signed URL, so reusing the key would keep
        # showing the picture that was just replaced.
        new_key = f"avatars/{user_id}/{uuid4().hex}.{ext}"

        storage = self._get_storage()
        if storage is None:
            raise HTTPException(status_code = 502, detail = "Failed to store the file")
        try:
            storage.upload(new_key, content, content_type)
        except StorageError:
            raise HTTPException(status_code = 502, detail = "Failed to store the file")

        try:
            row.avatar_url = new_key
            await self.db.commit()
            await self.db.refresh(row)
        except SQLAlchemyError:
            await self.db.rollback()
            # The new object is the orphan here — old_key is still what the
            # column holds and what the user is still being shown.
            try:
                storage.delete(new_key)
            except StorageError:
                logger.exception("Could not remove orphaned avatar %s", new_key)
            raise HTTPException(status_code = 500, detail = "Failed to save the avatar")

        # Only after the commit. Deleting first would, on a failed commit, leave
        # the column naming an object that no longer exists — a broken avatar
        # that cannot heal itself. Failing here instead just orphans one object,
        # as does losing a race with a second upload. Both are the cheap side.
        if old_key is not None:
            try:
                storage.delete(old_key)
            except StorageError:
                logger.exception("Could not remove replaced avatar %s", old_key)

        return self.to_response(row)

    async def remove_avatar(self, user_id: UUID) -> UserResponse:
        row = await get_or_404(self.db, User, user_id, "User not found.")
        old_key = row.avatar_url
        if old_key is None:
            return self.to_response(row)

        row.avatar_url = None
        await self.db.commit()
        await self.db.refresh(row)

        # Same ordering as set_avatar, same reason: the column is the truth, the
        # object is disposable.
        storage = self._get_storage()
        if storage is not None:
            try:
                storage.delete(old_key)
            except StorageError:
                logger.exception("Could not remove avatar %s", old_key)

        return self.to_response(row)

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
        return self.to_response(row)

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
        return [self.to_response(row) for row in result.scalars().all()]

    async def get_by_id(self, user_id: UUID) -> UserResponse:
        row = await get_or_404(self.db, User, user_id, "User not found.")
        return self.to_response(row)

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
        return self.to_response(row)

    async def change_password(self, user_id: UUID, data: PasswordChange) -> UserResponse:
        row = await get_or_404(self.db, User, user_id, "User not found.")
        if not verify_password(data.current_password, row.password_hash):
            raise HTTPException(status_code = 400, detail = "Current password incorrect")
        row.password_hash = get_password_hash(data.new_password)
        await self.db.commit()
        await self.db.refresh(row)
        return self.to_response(row)

    async def activate(self, user_id: UUID) -> UserResponse:
        row = await get_or_404(self.db, User, user_id, "User not found.")
        row.is_active = True
        await self.db.commit()
        await self.db.refresh(row)
        return self.to_response(row)

    async def deactivate(self, user_id: UUID) -> UserResponse:
        row = await get_or_404(self.db, User, user_id, "User not found.")
        row.is_active = False
        await self.db.commit()
        await self.db.refresh(row)
        return self.to_response(row)
