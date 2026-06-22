import uuid

BASE = "/api/v1/config/employee-levels"


async def test_create_employee_level_success(client):
    resp = await client.post(BASE, json = {"name": "L1", "rank": 1})
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "L1"
    assert body["rank"] == 1


async def test_create_employee_level_duplicate_rank(client):
    await client.post(BASE, json = {"name": "L1", "rank": 1})
    resp = await client.post(BASE, json = {"name": "L2", "rank": 1})
    assert resp.status_code == 409


async def test_create_employee_level_duplicate_name(client):
    await client.post(BASE, json = {"name": "L1", "rank": 1})
    resp = await client.post(BASE, json = {"name": "l1", "rank": 2})
    assert resp.status_code == 409


async def test_get_employee_level_not_found(client):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404
