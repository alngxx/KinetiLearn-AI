import uuid

BASE = "/api/v1/config/categories"


async def test_create_category_success(client):
    resp = await client.post(BASE, json = {"name": "Engineering"})
    assert resp.status_code == 201
    body = resp.json()
    assert "id" in body
    assert body["name"] == "Engineering"
    assert body["is_active"] is True


async def test_create_category_duplicate_name(client):
    await client.post(BASE, json = {"name": "Engineering"})
    resp = await client.post(BASE, json = {"name": "ENGINEERING"})
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_get_category_not_found(client):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_deactivate_category(client):
    created = await client.post(BASE, json = {"name": "Engineering"})
    category_id = created.json()["id"]
    resp = await client.patch(f"{BASE}/{category_id}/deactivate")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


async def test_create_category_missing_name(client):
    resp = await client.post(BASE, json = {})
    assert resp.status_code == 422


async def test_delete_category_success(client):
    created = await client.post(BASE, json = {"name": "Temp"})
    category_id = created.json()["id"]

    resp = await client.delete(f"{BASE}/{category_id}")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": 1}

    assert (await client.get(f"{BASE}/{category_id}")).status_code == 404


async def test_delete_category_with_skill_blocked(client):
    created = await client.post(BASE, json = {"name": "Engineering"})
    category_id = created.json()["id"]
    await client.post(
        "/api/v1/config/skills",
        json = {
            "category_id": category_id,
            "name": "Python",
            "basic_max": 40,
            "intermediate_max": 70,
        },
    )

    resp = await client.delete(f"{BASE}/{category_id}")
    assert resp.status_code == 409
    assert "skills assigned" in resp.json()["detail"]

    assert (await client.get(f"{BASE}/{category_id}")).status_code == 200


async def test_delete_category_not_found(client):
    resp = await client.delete(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_delete_then_recreate_category_same_name(client):
    created = await client.post(BASE, json = {"name": "Temp"})
    category_id = created.json()["id"]

    await client.delete(f"{BASE}/{category_id}")

    resp = await client.post(BASE, json = {"name": "Temp"})
    assert resp.status_code == 201
