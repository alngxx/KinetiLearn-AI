import uuid

BASE = "/api/v1/config/seniority-levels"


async def test_create_seniority_level_success(client):
    resp = await client.post(BASE, json = {"name": "Junior", "rank": 1})
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Junior"
    assert body["rank"] == 1


async def test_create_seniority_level_duplicate_rank(client):
    await client.post(BASE, json = {"name": "Junior", "rank": 1})
    resp = await client.post(BASE, json = {"name": "Senior", "rank": 1})
    assert resp.status_code == 409


async def test_create_seniority_level_duplicate_name(client):
    await client.post(BASE, json = {"name": "Junior", "rank": 1})
    resp = await client.post(BASE, json = {"name": "JUNIOR", "rank": 2})
    assert resp.status_code == 409


async def test_get_seniority_level_not_found(client):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404
