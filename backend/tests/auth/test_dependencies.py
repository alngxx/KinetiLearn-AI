import uuid
from datetime import timedelta

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.core.config import settings
from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User

BASE = "/api/v1/config/categories"


async def _seed_user(db, email, role = "admin", is_active = True):
    user = User(
        id = uuid.uuid4(),
        email = email,
        password_hash = get_password_hash("secret123"),
        full_name = "Test User",
        role = role,
        is_active = is_active,
    )
    db.add(user)
    await db.flush()
    return user


@pytest_asyncio.fixture
async def auth_client(db_session):
    # Only override get_db — require_admin/get_current_user run for real here.
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app = app)
    async with AsyncClient(transport = transport, base_url = "http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def test_no_token(auth_client):
    resp = await auth_client.get(BASE)
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Not authenticated"}


async def test_invalid_signature(auth_client):
    token = jwt.encode(
        {"sub": str(uuid.uuid4()), "role": "admin"}, "wrong-secret", algorithm = settings.JWT_ALGORITHM
    )
    resp = await auth_client.get(BASE, headers = _auth(token))
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Could not validate credentials"}


async def test_expired_token(auth_client, db_session):
    user = await _seed_user(db_session, "admin@kineti.com")
    token = create_access_token(
        {"sub": str(user.id), "role": "admin"}, expires_delta = timedelta(seconds = -1)
    )
    resp = await auth_client.get(BASE, headers = _auth(token))
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Could not validate credentials"}


async def test_user_not_in_db(auth_client):
    token = create_access_token({"sub": str(uuid.uuid4()), "role": "admin"})
    resp = await auth_client.get(BASE, headers = _auth(token))
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Could not validate credentials"}


async def test_inactive_user(auth_client, db_session):
    user = await _seed_user(db_session, "disabled@kineti.com", is_active = False)
    token = create_access_token({"sub": str(user.id), "role": "admin"})
    resp = await auth_client.get(BASE, headers = _auth(token))
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Account is disabled"}


async def test_non_admin_forbidden(auth_client, db_session):
    user = await _seed_user(db_session, "learner@kineti.com", role = "learner")
    token = create_access_token({"sub": str(user.id), "role": "learner"})
    resp = await auth_client.get(BASE, headers = _auth(token))
    assert resp.status_code == 403
    assert resp.json() == {"detail": "Admin access required"}


async def test_valid_admin(auth_client, db_session):
    user = await _seed_user(db_session, "admin@kineti.com")
    token = create_access_token({"sub": str(user.id), "role": "admin"})
    resp = await auth_client.get(BASE, headers = _auth(token))
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
