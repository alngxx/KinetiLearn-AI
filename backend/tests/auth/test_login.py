import uuid

import pytest_asyncio
from jose import jwt

from app.core.config import settings
from app.core.security import get_password_hash
from app.modules.auth.models import User

BASE = "/api/v1/auth/login"


async def _seed_user(db, email, password, role = "admin", is_active = True):
    user = User(
        id = uuid.uuid4(),
        email = email,
        password_hash = get_password_hash(password),
        full_name = "Test User",
        role = role,
        is_active = is_active,
    )
    db.add(user)
    await db.flush()
    return user


@pytest_asyncio.fixture
async def admin_user(db_session):
    return await _seed_user(db_session, "admin@kineti.com", "secret123")


async def test_login_success(client, admin_user):
    resp = await client.post(
        BASE, json = {"email": "admin@kineti.com", "password": "secret123"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"

    payload = jwt.decode(
        body["access_token"], settings.JWT_SECRET, algorithms = [settings.JWT_ALGORITHM]
    )
    assert payload["sub"] == str(admin_user.id)
    assert payload["role"] == "admin"


async def test_login_wrong_password(client, admin_user):
    resp = await client.post(
        BASE, json = {"email": "admin@kineti.com", "password": "wrong"}
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid credentials"}


async def test_login_nonexistent_email(client):
    resp = await client.post(
        BASE, json = {"email": "nobody@kineti.com", "password": "secret123"}
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid credentials"}


async def test_login_inactive_user(client, db_session):
    await _seed_user(db_session, "disabled@kineti.com", "secret123", is_active = False)
    resp = await client.post(
        BASE, json = {"email": "disabled@kineti.com", "password": "secret123"}
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Account is disabled"}


async def test_login_missing_password(client):
    resp = await client.post(BASE, json = {"email": "admin@kineti.com"})
    assert resp.status_code == 422
