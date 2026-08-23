import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.config import settings
from app.core.database import Base
from app.core.dependencies import get_db, require_admin
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User

TEST_DB_NAME = "KinetiLearn_test"
test_url = make_url(settings.DATABASE_URL).set(database = TEST_DB_NAME)


async def _create_test_database():
    # CREATE DATABASE can't run inside a transaction, so connect to the default
    # "postgres" database with an autocommit engine and create the test DB if missing.
    admin_url = make_url(settings.DATABASE_URL).set(database = "postgres")
    engine = create_async_engine(admin_url, isolation_level = "AUTOCOMMIT")
    async with engine.connect() as conn:
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :name"),
            {"name": TEST_DB_NAME},
        )
        if not exists:
            await conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
    await engine.dispose()


@pytest_asyncio.fixture(scope = "session")
async def test_engine():
    await _create_test_database()
    engine = create_async_engine(test_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine):
    # Bind the session to an outer transaction and roll it back after the test.
    # join_transaction_mode="create_savepoint" turns service-level commits into
    # savepoints, so the final rollback discards everything the test wrote.
    connection = await test_engine.connect()
    trans = await connection.begin()
    session = AsyncSession(
        bind = connection,
        join_transaction_mode = "create_savepoint",
        expire_on_commit = False,
    )
    yield session
    await session.close()
    await trans.rollback()
    await connection.close()


@pytest_asyncio.fixture
async def client(db_session):
    async def override_get_db():
        yield db_session

    async def override_require_admin():
        return {"role": "admin"}

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_admin] = override_require_admin

    transport = ASGITransport(app = app)
    async with AsyncClient(transport = transport, base_url = "http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


# Auth-check fixture: only get_db is overridden, so require_admin and
# get_current_user run for real and 401/403 can be asserted. The `client`
# fixture above stubs require_admin out, which is what every other test wants.
@pytest_asyncio.fixture
async def auth_client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app = app)
    async with AsyncClient(transport = transport, base_url = "http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


async def seed_auth_user(db, role = "admin"):
    user = User(
        id = uuid.uuid4(),
        email = f"{role}-{uuid.uuid4()}@kineti.com",
        password_hash = get_password_hash("secret123"),
        full_name = "Test User",
        role = role,
    )
    db.add(user)
    await db.flush()
    return user


def auth_header(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'role': user.role})}"}
