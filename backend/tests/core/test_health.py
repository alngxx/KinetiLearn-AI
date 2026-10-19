from unittest.mock import AsyncMock

from app.core.dependencies import get_db
from app.main import app


async def test_health_ok(client):
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "database": "ok"}


async def test_health_returns_503_when_database_down(client):
    broken_session = AsyncMock()
    broken_session.execute.side_effect = ConnectionRefusedError("db down")

    async def override_get_db():
        yield broken_session

    app.dependency_overrides[get_db] = override_get_db
    res = await client.get("/health")
    assert res.status_code == 503
    assert res.json() == {"detail": "Database unavailable"}
