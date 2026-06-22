import uuid

CATEGORIES = "/api/v1/config/categories"
BASE = "/api/v1/config/skills"

VALID_BANDS = {
    "basic_min": 0,
    "basic_max": 10,
    "intermediate_min": 11,
    "intermediate_max": 20,
    "advanced_min": 21,
    "advanced_max": 30,
}


async def _make_category(client, name = "Engineering"):
    resp = await client.post(CATEGORIES, json = {"name": name})
    return resp.json()["id"]


async def test_create_skill_success(client):
    category_id = await _make_category(client)
    resp = await client.post(
        BASE, json = {"category_id": category_id, "name": "Python", **VALID_BANDS}
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Python"
    assert body["category_id"] == category_id


async def test_create_skill_invalid_bands(client):
    category_id = await _make_category(client)
    bad_bands = {**VALID_BANDS, "intermediate_min": 15}
    resp = await client.post(
        BASE, json = {"category_id": category_id, "name": "Python", **bad_bands}
    )
    assert resp.status_code == 422


async def test_create_skill_duplicate_name_in_category(client):
    category_id = await _make_category(client)
    await client.post(
        BASE, json = {"category_id": category_id, "name": "Python", **VALID_BANDS}
    )
    resp = await client.post(
        BASE, json = {"category_id": category_id, "name": "Python", **VALID_BANDS}
    )
    assert resp.status_code == 409


async def test_get_skill_not_found(client):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404
