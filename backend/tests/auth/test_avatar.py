"""POST and DELETE /users/me/avatar, plus the key-to-signed-URL swap.

Every user manages their own picture, so these routes hang off
get_current_user rather than require_admin — the tests authenticate a seeded
learner with a real token. R2Storage is patched where auth/service.py imports
it, the same seam tests/documents/* and tests/classes/* use; boto3 is never
touched.
"""
import uuid
from unittest.mock import patch

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.core.storage import StorageError
from app.main import app
from app.modules.auth.models import User

BASE = "/api/v1/users"
SIGNED = "https://r2.example.com/avatars/x.png?X-Amz-Signature=abc"

PNG = b"\x89PNG\r\n\x1a\n" + b"rest of the file"
JPEG = b"\xff\xd8\xff" + b"rest of the file"
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"rest of the file"


@pytest_asyncio.fixture
async def auth_client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app = app)
    async with AsyncClient(transport = transport, base_url = "http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
def mock_storage():
    with patch("app.modules.auth.service.R2Storage") as mock_r2:
        mock_r2.return_value.get_presigned_url.return_value = SIGNED
        yield mock_r2


async def _seed_user(db, avatar_url = None):
    user = User(
        id = uuid.uuid4(),
        email = f"{uuid.uuid4()}@kineti.com",
        password_hash = get_password_hash("secret123"),
        full_name = "Seed Learner",
        role = "learner",
        avatar_url = avatar_url,
    )
    db.add(user)
    await db.flush()
    return user


def _auth(user):
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {"Authorization": f"Bearer {token}"}


async def _stored_key(db, user_id):
    result = await db.execute(select(User.avatar_url).where(User.id == user_id))
    return result.scalar_one()


async def test_upload_stores_key_and_returns_signed_url(auth_client, db_session, mock_storage):
    user = await _seed_user(db_session)

    resp = await auth_client.post(
        f"{BASE}/me/avatar",
        files = {"file": ("me.png", PNG, "image/png")},
        headers = _auth(user),
    )

    assert resp.status_code == 200
    # The response carries a signed URL; the column carries the raw key. This
    # is the split the whole feature rests on.
    assert resp.json()["avatar_url"] == SIGNED
    key = await _stored_key(db_session, user.id)
    assert key.startswith(f"avatars/{user.id}/")
    assert key.endswith(".png")
    mock_storage.return_value.upload.assert_called_once()
    assert mock_storage.return_value.upload.call_args.args[0] == key


async def test_upload_accepts_jpeg_and_webp(auth_client, db_session, mock_storage):
    for content, expected_ext in ((JPEG, ".jpg"), (WEBP, ".webp")):
        user = await _seed_user(db_session)
        resp = await auth_client.post(
            f"{BASE}/me/avatar",
            files = {"file": ("me.bin", content, "application/octet-stream")},
            headers = _auth(user),
        )
        assert resp.status_code == 200
        assert (await _stored_key(db_session, user.id)).endswith(expected_ext)


async def test_upload_rejects_non_image_even_when_labelled_png(
    auth_client, db_session, mock_storage,
):
    user = await _seed_user(db_session)

    # The content type says PNG and the filename agrees; only the bytes tell
    # the truth, which is the point of sniffing them.
    resp = await auth_client.post(
        f"{BASE}/me/avatar",
        files = {"file": ("me.png", b"not really an image", "image/png")},
        headers = _auth(user),
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "File must be a PNG, JPEG, or WebP image"
    mock_storage.return_value.upload.assert_not_called()
    assert await _stored_key(db_session, user.id) is None


async def test_upload_rejects_oversized_image(auth_client, db_session, mock_storage):
    user = await _seed_user(db_session)
    too_big = PNG + b"x" * (2 * 1024 * 1024)

    resp = await auth_client.post(
        f"{BASE}/me/avatar",
        files = {"file": ("me.png", too_big, "image/png")},
        headers = _auth(user),
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Image exceeds the 2 MB limit"
    mock_storage.return_value.upload.assert_not_called()


async def test_upload_requires_authentication(auth_client, mock_storage):
    resp = await auth_client.post(
        f"{BASE}/me/avatar",
        files = {"file": ("me.png", PNG, "image/png")},
    )
    assert resp.status_code == 401


async def test_replacing_an_avatar_deletes_the_old_object(
    auth_client, db_session, mock_storage,
):
    user = await _seed_user(db_session, avatar_url = "avatars/old/key.png")

    resp = await auth_client.post(
        f"{BASE}/me/avatar",
        files = {"file": ("me.png", PNG, "image/png")},
        headers = _auth(user),
    )

    assert resp.status_code == 200
    mock_storage.return_value.delete.assert_called_once_with("avatars/old/key.png")
    assert await _stored_key(db_session, user.id) != "avatars/old/key.png"


async def test_upload_failure_reports_502_and_leaves_the_column_alone(
    auth_client, db_session, mock_storage,
):
    user = await _seed_user(db_session, avatar_url = "avatars/old/key.png")
    mock_storage.return_value.upload.side_effect = StorageError("boom")

    resp = await auth_client.post(
        f"{BASE}/me/avatar",
        files = {"file": ("me.png", PNG, "image/png")},
        headers = _auth(user),
    )

    assert resp.status_code == 502
    assert resp.json()["detail"] == "Failed to store the file"
    assert await _stored_key(db_session, user.id) == "avatars/old/key.png"


async def test_cleanup_failure_does_not_fail_the_upload(
    auth_client, db_session, mock_storage,
):
    # Removing the replaced object is best-effort on purpose: the new avatar is
    # already committed, so an orphan in R2 must not surface as a failed upload.
    user = await _seed_user(db_session, avatar_url = "avatars/old/key.png")
    mock_storage.return_value.delete.side_effect = StorageError("boom")

    resp = await auth_client.post(
        f"{BASE}/me/avatar",
        files = {"file": ("me.png", PNG, "image/png")},
        headers = _auth(user),
    )

    assert resp.status_code == 200
    assert (await _stored_key(db_session, user.id)).startswith(f"avatars/{user.id}/")


async def test_delete_clears_the_column_and_the_object(
    auth_client, db_session, mock_storage,
):
    user = await _seed_user(db_session, avatar_url = "avatars/old/key.png")

    resp = await auth_client.delete(f"{BASE}/me/avatar", headers = _auth(user))

    assert resp.status_code == 200
    assert resp.json()["avatar_url"] is None
    assert await _stored_key(db_session, user.id) is None
    mock_storage.return_value.delete.assert_called_once_with("avatars/old/key.png")


async def test_delete_without_an_avatar_never_touches_storage(
    auth_client, db_session, mock_storage,
):
    user = await _seed_user(db_session)

    resp = await auth_client.delete(f"{BASE}/me/avatar", headers = _auth(user))

    assert resp.status_code == 200
    assert resp.json()["avatar_url"] is None
    mock_storage.assert_not_called()


async def test_get_me_signs_the_stored_key(auth_client, db_session, mock_storage):
    user = await _seed_user(db_session, avatar_url = "avatars/old/key.png")

    resp = await auth_client.get(f"{BASE}/me", headers = _auth(user))

    assert resp.status_code == 200
    assert resp.json()["avatar_url"] == SIGNED
    mock_storage.return_value.get_presigned_url.assert_called_once()
    assert mock_storage.return_value.get_presigned_url.call_args.args[0] == "avatars/old/key.png"


async def test_get_me_falls_back_to_no_avatar_when_r2_is_unconfigured(
    auth_client, db_session, mock_storage,
):
    # An empty R2_* config makes R2Storage() raise. A page that shows a name
    # should degrade to initials, not 500.
    user = await _seed_user(db_session, avatar_url = "avatars/old/key.png")
    mock_storage.side_effect = StorageError("Missing R2 configuration")

    resp = await auth_client.get(f"{BASE}/me", headers = _auth(user))

    assert resp.status_code == 200
    assert resp.json()["avatar_url"] is None
