import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User

BASE = "/api/v1/users"


async def _seed_user(db, email, role = "admin", password = "secret123", is_active = True):
    user = User(
        id = uuid.uuid4(),
        email = email,
        password_hash = get_password_hash(password),
        full_name = "Seed User",
        role = role,
        is_active = is_active,
    )
    db.add(user)
    await db.flush()
    return user


def _auth(user):
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {"Authorization": f"Bearer {token}"}


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
async def admin(db_session):
    return await _seed_user(db_session, "admin@kineti.com", role = "admin")


async def test_create_user_success(auth_client, admin):
    resp = await auth_client.post(
        BASE,
        json = {"email": "new@kineti.com", "password": "password123", "full_name": "New Person", "role": "learner"},
        headers = _auth(admin),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == "new@kineti.com"
    assert body["role"] == "learner"
    assert body["is_active"] is True
    assert "password_hash" not in body
    assert "password" not in body


async def test_create_user_duplicate_email(auth_client, admin):
    payload = {"email": "dup@kineti.com", "password": "password123", "full_name": "Dup"}
    await auth_client.post(BASE, json = payload, headers = _auth(admin))
    resp = await auth_client.post(
        BASE,
        json = {"email": "DUP@kineti.com", "password": "password123", "full_name": "Dup2"},
        headers = _auth(admin),
    )
    assert resp.status_code == 409
    assert resp.json() == {"detail": "Email already exists"}


async def test_create_user_short_password(auth_client, admin):
    resp = await auth_client.post(
        BASE,
        json = {"email": "x@kineti.com", "password": "short", "full_name": "X"},
        headers = _auth(admin),
    )
    assert resp.status_code == 422


async def test_list_users(auth_client, admin):
    resp = await auth_client.get(BASE, headers = _auth(admin))
    assert resp.status_code == 200
    emails = [u["email"] for u in resp.json()]
    assert "admin@kineti.com" in emails


async def test_get_me(auth_client, admin):
    resp = await auth_client.get(f"{BASE}/me", headers = _auth(admin))
    assert resp.status_code == 200
    assert resp.json()["email"] == "admin@kineti.com"


async def test_get_user_not_found(auth_client, admin):
    resp = await auth_client.get(f"{BASE}/{uuid.uuid4()}", headers = _auth(admin))
    assert resp.status_code == 404


async def test_get_user_by_id(auth_client, admin, db_session):
    target = await _seed_user(db_session, "byid@kineti.com", role = "learner")
    resp = await auth_client.get(f"{BASE}/{target.id}", headers = _auth(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(target.id)
    assert body["email"] == "byid@kineti.com"
    assert "password_hash" not in body


async def test_update_user(auth_client, admin, db_session):
    target = await _seed_user(db_session, "update@kineti.com", role = "learner")
    resp = await auth_client.put(
        f"{BASE}/{target.id}",
        json = {"full_name": "Updated Name"},
        headers = _auth(admin),
    )
    assert resp.status_code == 200
    assert resp.json()["full_name"] == "Updated Name"


async def test_activate_user(auth_client, admin, db_session):
    target = await _seed_user(db_session, "reactivate@kineti.com", role = "learner")
    await auth_client.patch(f"{BASE}/{target.id}/deactivate", headers = _auth(admin))
    resp = await auth_client.patch(f"{BASE}/{target.id}/activate", headers = _auth(admin))
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True


async def test_get_me_no_token(auth_client):
    resp = await auth_client.get(f"{BASE}/me")
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Not authenticated"}


async def test_full_login_flow(auth_client, admin):
    create_resp = await auth_client.post(
        BASE,
        json = {"email": "flow@kineti.com", "password": "password123", "full_name": "Flow User", "role": "learner"},
        headers = _auth(admin),
    )
    assert create_resp.status_code == 201
    created = create_resp.json()

    login_resp = await auth_client.post(
        "/api/v1/auth/login",
        json = {"email": "flow@kineti.com", "password": "password123"},
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]

    me_resp = await auth_client.get(f"{BASE}/me", headers = {"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    body = me_resp.json()
    assert body["email"] == "flow@kineti.com"
    assert body["id"] == created["id"]
    assert "password_hash" not in body


async def test_deactivate_user(auth_client, admin, db_session):
    target = await _seed_user(db_session, "target@kineti.com", role = "learner")
    resp = await auth_client.patch(f"{BASE}/{target.id}/deactivate", headers = _auth(admin))
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


async def test_change_my_password_wrong_current(auth_client, admin):
    resp = await auth_client.put(
        f"{BASE}/me/password",
        json = {"current_password": "wrong", "new_password": "newpassword123"},
        headers = _auth(admin),
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Current password incorrect"}


async def test_change_my_password_success(auth_client, admin):
    resp = await auth_client.put(
        f"{BASE}/me/password",
        json = {"current_password": "secret123", "new_password": "newpassword123"},
        headers = _auth(admin),
    )
    assert resp.status_code == 200


async def test_learner_forbidden_on_admin_route(auth_client, db_session):
    learner = await _seed_user(db_session, "learner@kineti.com", role = "learner")
    resp = await auth_client.post(
        BASE,
        json = {"email": "z@kineti.com", "password": "password123", "full_name": "Z"},
        headers = _auth(learner),
    )
    assert resp.status_code == 403
    assert resp.json() == {"detail": "Admin access required"}


async def test_update_email_conflict(auth_client, admin, db_session):
    other = await _seed_user(db_session, "other@kineti.com", role = "learner")
    resp = await auth_client.put(
        f"{BASE}/{other.id}",
        json = {"email": "admin@kineti.com"},
        headers = _auth(admin),
    )
    assert resp.status_code == 409
    assert resp.json() == {"detail": "Email already exists"}
