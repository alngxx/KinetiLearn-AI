import uuid

BASE = "/api/v1/config/job-positions"


async def test_create_job_position_success(client):
    resp = await client.post(BASE, json = {"name": "Backend Engineer"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Backend Engineer"


async def test_create_job_position_duplicate_name(client):
    await client.post(BASE, json = {"name": "Backend Engineer"})
    resp = await client.post(BASE, json = {"name": "BACKEND ENGINEER"})
    assert resp.status_code == 409


async def test_get_job_position_not_found(client):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404
