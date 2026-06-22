import uuid

BASE = "/api/v1/config/departments"


async def test_create_department_success(client):
    resp = await client.post(BASE, json = {"name": "Sales"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Sales"


async def test_create_department_duplicate_name(client):
    await client.post(BASE, json = {"name": "Sales"})
    resp = await client.post(BASE, json = {"name": "SALES"})
    assert resp.status_code == 409


async def test_get_department_not_found(client):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_deactivate_department(client):
    created = await client.post(BASE, json = {"name": "Sales"})
    department_id = created.json()["id"]
    resp = await client.patch(f"{BASE}/{department_id}/deactivate")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False
