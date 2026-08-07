import itertools
import uuid

from app.core.dependencies import require_admin
from app.main import app
from app.modules.config.models import (
    Department,
    EmployeeLevel,
    JobPosition,
    SeniorityLevel,
)
from app.modules.documents.models import Document, DocumentVersion

BASE = "/api/v1/daily-quiz-configs"

# seniority_levels.rank and employee_levels.rank are NOT NULL and unique.
_ranks = itertools.count(1)


def _use_stub_admin():
    # The shared fixture stubs require_admin as a dict, but create reads
    # current_user.id — override with a minimal user (created_by is nullable).
    app.dependency_overrides[require_admin] = lambda: type("U", (), {"id": None})()


async def _seed_document(db, *, active_version = 1, status = "ready", is_active = True):
    doc = Document(
        title = f"Doc {uuid.uuid4()}",
        active_version_number = active_version,
        is_active = is_active,
    )
    db.add(doc)
    await db.flush()
    if active_version is not None:
        db.add(DocumentVersion(
            document_id = doc.id,
            version_number = active_version,
            file_url = "documents/x/v1.pdf",
            file_name = "f.pdf",
            file_size_bytes = 10,
            mime_type = "application/pdf",
            processing_status = status,
        ))
        await db.flush()
    return doc


async def _seed_department(db):
    d = Department(name = f"Dept {uuid.uuid4()}")
    db.add(d)
    await db.flush()
    return d


async def _seed_seniority(db):
    s = SeniorityLevel(name = f"Sen {uuid.uuid4()}"[:50], rank = next(_ranks))
    db.add(s)
    await db.flush()
    return s


async def _seed_job_position(db):
    j = JobPosition(name = f"Job {uuid.uuid4()}")
    db.add(j)
    await db.flush()
    return j


async def _seed_employee_level(db):
    e = EmployeeLevel(name = f"Lvl {uuid.uuid4()}"[:50], rank = next(_ranks))
    db.add(e)
    await db.flush()
    return e


def _payload(document_id, **overrides):
    body = {
        "name": "Daily security refresher",
        "prompt": "Ask about the escalation policy.",
        "source_document_id": str(document_id),
        "start_date": "2026-09-01",
        "push_time": "09:00:00",
    }
    body.update(overrides)
    return body


async def _create(client, db_session, **overrides):
    doc = await _seed_document(db_session)
    resp = await client.post(BASE, json = _payload(doc.id, **overrides))
    assert resp.status_code == 201
    return resp.json()


async def test_create_config_applies_defaults(client, db_session):
    _use_stub_admin()
    doc = await _seed_document(db_session)

    resp = await client.post(BASE, json = _payload(doc.id))
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Daily security refresher"
    assert body["source_document_id"] == str(doc.id)
    assert body["timezone"] == "Asia/Ho_Chi_Minh"
    assert body["expiry_hours"] == 24
    assert body["question_count"] == 5
    assert body["end_date"] is None
    assert body["is_active"] is True


async def test_create_config_stores_all_four_targets(client, db_session):
    _use_stub_admin()
    doc = await _seed_document(db_session)
    dept = await _seed_department(db_session)
    seniority = await _seed_seniority(db_session)
    position = await _seed_job_position(db_session)
    level = await _seed_employee_level(db_session)

    resp = await client.post(BASE, json = _payload(
        doc.id,
        target_department_id = str(dept.id),
        target_seniority_id = str(seniority.id),
        target_job_position_id = str(position.id),
        target_employee_level_id = str(level.id),
    ))
    assert resp.status_code == 201
    body = resp.json()
    assert body["target_department_id"] == str(dept.id)
    assert body["target_seniority_id"] == str(seniority.id)
    assert body["target_job_position_id"] == str(position.id)
    assert body["target_employee_level_id"] == str(level.id)


async def test_create_config_rejects_inactive_document(client, db_session):
    _use_stub_admin()
    doc = await _seed_document(db_session, is_active = False)

    resp = await client.post(BASE, json = _payload(doc.id))
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Document is inactive."


async def test_create_config_rejects_not_ready_version(client, db_session):
    _use_stub_admin()
    doc = await _seed_document(db_session, status = "processing")

    resp = await client.post(BASE, json = _payload(doc.id))
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Document is not ready."


async def test_create_config_rejects_document_without_active_version(client, db_session):
    _use_stub_admin()
    doc = await _seed_document(db_session, active_version = None)

    resp = await client.post(BASE, json = _payload(doc.id))
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Document is not ready."


async def test_create_config_unknown_document(client):
    _use_stub_admin()
    resp = await client.post(BASE, json = _payload(uuid.uuid4()))
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Document not found."


async def test_create_config_unknown_department(client, db_session):
    _use_stub_admin()
    doc = await _seed_document(db_session)

    resp = await client.post(BASE, json = _payload(
        doc.id, target_department_id = str(uuid.uuid4())
    ))
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Department not found."


async def test_create_config_end_date_before_start_date(client, db_session):
    _use_stub_admin()
    doc = await _seed_document(db_session)

    resp = await client.post(BASE, json = _payload(
        doc.id, start_date = "2026-09-10", end_date = "2026-09-01"
    ))
    assert resp.status_code == 400
    assert resp.json()["detail"] == "end_date must be on or after start_date."


async def test_create_config_unknown_timezone(client, db_session):
    _use_stub_admin()
    doc = await _seed_document(db_session)

    resp = await client.post(BASE, json = _payload(doc.id, timezone = "Asia/HoChiMinh"))
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Unknown timezone."


async def test_create_config_rejects_zero_question_count(client, db_session):
    _use_stub_admin()
    doc = await _seed_document(db_session)

    resp = await client.post(BASE, json = _payload(doc.id, question_count = 0))
    assert resp.status_code == 422


async def test_list_configs_excludes_inactive_by_default(client, db_session):
    _use_stub_admin()
    active = await _create(client, db_session)
    inactive = await _create(client, db_session)
    await client.patch(f"{BASE}/{inactive['id']}/deactivate")

    resp = await client.get(BASE)
    assert resp.status_code == 200
    ids = [c["id"] for c in resp.json()]
    assert active["id"] in ids
    assert inactive["id"] not in ids


async def test_list_configs_include_inactive(client, db_session):
    _use_stub_admin()
    config = await _create(client, db_session)
    await client.patch(f"{BASE}/{config['id']}/deactivate")

    resp = await client.get(BASE, params = {"include_inactive": True})
    assert resp.status_code == 200
    assert config["id"] in [c["id"] for c in resp.json()]


async def test_multiple_active_configs_on_same_document(client, db_session):
    # Nothing in the schema is unique, so several configs may target the same
    # document with different audiences and push times at once.
    _use_stub_admin()
    doc = await _seed_document(db_session)
    engineering = await _seed_department(db_session)
    sales = await _seed_department(db_session)

    first = await client.post(BASE, json = _payload(
        doc.id,
        name = "Engineering daily",
        target_department_id = str(engineering.id),
        push_time = "09:00:00",
    ))
    second = await client.post(BASE, json = _payload(
        doc.id,
        name = "Sales daily",
        target_department_id = str(sales.id),
        push_time = "14:30:00",
    ))
    assert first.status_code == 201
    assert second.status_code == 201

    resp = await client.get(BASE)
    ids = [c["id"] for c in resp.json()]
    assert first.json()["id"] in ids
    assert second.json()["id"] in ids


async def test_get_config_detail(client, db_session):
    _use_stub_admin()
    config = await _create(client, db_session)

    resp = await client.get(f"{BASE}/{config['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == config["id"]


async def test_get_config_not_found(client):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Daily quiz config not found."


async def test_update_config(client, db_session):
    _use_stub_admin()
    config = await _create(client, db_session)

    resp = await client.put(f"{BASE}/{config['id']}", json = {
        "name": "Renamed",
        "prompt": "Ask about incident severity.",
        "push_time": "18:15:00",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Renamed"
    assert body["prompt"] == "Ask about incident severity."
    assert body["push_time"] == "18:15:00"


async def test_update_config_rejects_bad_date_range(client, db_session):
    _use_stub_admin()
    config = await _create(client, db_session, start_date = "2026-09-10")

    resp = await client.put(f"{BASE}/{config['id']}", json = {"end_date": "2026-09-01"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "end_date must be on or after start_date."


async def test_update_config_rejects_not_ready_document(client, db_session):
    _use_stub_admin()
    config = await _create(client, db_session)
    other = await _seed_document(db_session, status = "failed")

    resp = await client.put(
        f"{BASE}/{config['id']}", json = {"source_document_id": str(other.id)}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Document is not ready."


async def test_update_config_not_found(client):
    resp = await client.put(f"{BASE}/{uuid.uuid4()}", json = {"name": "X"})
    assert resp.status_code == 404


async def test_deactivate_and_activate_config(client, db_session):
    _use_stub_admin()
    config = await _create(client, db_session)

    resp = await client.patch(f"{BASE}/{config['id']}/deactivate")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    resp = await client.patch(f"{BASE}/{config['id']}/activate")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True
