import uuid
from unittest.mock import patch

from app.core.dependencies import require_admin
from app.main import app
from app.modules.config.models import Category, Skill
from app.modules.documents.models import Document, DocumentVersion

BASE = "/api/v1/documents"


async def _seed_document(
    db,
    *,
    status = "ready",
    version_number = 1,
    active_version = None,
    is_active = True,
):
    doc = Document(
        title = f"Doc {uuid.uuid4()}",
        is_active = is_active,
        active_version_number = active_version,
    )
    db.add(doc)
    await db.flush()
    db.add(DocumentVersion(
        document_id = doc.id,
        version_number = version_number,
        file_url = "documents/x/v1.pdf",
        file_name = "f.pdf",
        file_size_bytes = 10,
        mime_type = "application/pdf",
        processing_status = status,
    ))
    await db.flush()
    return doc


async def _seed_skill(db):
    cat = Category(name = f"Cat {uuid.uuid4()}")
    db.add(cat)
    await db.flush()
    skill = Skill(category_id = cat.id, name = "S", basic_max = 50, intermediate_max = 80)
    db.add(skill)
    await db.flush()
    return skill


async def test_upload_enqueues_processing(client, db_session):
    # The shared fixture stubs require_admin as a dict, but the upload route reads
    # current_user.id — override it with a minimal user (nullable uploader_id).
    app.dependency_overrides[require_admin] = lambda: type("U", (), {"id": None})()

    cat = Category(name = f"Cat {uuid.uuid4()}")
    db_session.add(cat)
    await db_session.flush()

    with patch("app.modules.documents.service.R2Storage") as mock_r2, \
         patch("worker.tasks.process_document") as mock_task:
        mock_r2.return_value.upload.return_value = "key"
        resp = await client.post(
            f"{BASE}/upload",
            data = {"title": "Doc A", "category_id": str(cat.id)},
            files = {"file": ("a.pdf", b"%PDF-1.4 test", "application/pdf")},
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["processing_status"] == "pending"
    mock_task.delay.assert_called_once_with(body["document_id"], 1)


async def test_promote_ready_version(client, db_session):
    doc = await _seed_document(db_session, status = "ready", active_version = None)
    resp = await client.patch(f"{BASE}/{doc.id}/versions/1/promote")
    assert resp.status_code == 200
    assert resp.json()["active_version_number"] == 1


async def test_promote_not_ready_rejected(client, db_session):
    doc = await _seed_document(db_session, status = "pending")
    resp = await client.patch(f"{BASE}/{doc.id}/versions/1/promote")
    assert resp.status_code == 409
    assert "not ready" in resp.json()["detail"]


async def test_promote_missing_version(client, db_session):
    doc = await _seed_document(db_session, status = "ready")
    resp = await client.patch(f"{BASE}/{doc.id}/versions/99/promote")
    assert resp.status_code == 404


async def test_document_deactivate_then_activate(client, db_session):
    doc = await _seed_document(db_session, is_active = True)
    r1 = await client.patch(f"{BASE}/{doc.id}/deactivate")
    assert r1.status_code == 200
    assert r1.json()["is_active"] is False
    r2 = await client.patch(f"{BASE}/{doc.id}/activate")
    assert r2.status_code == 200
    assert r2.json()["is_active"] is True


async def test_skill_attach_detach_idempotent(client, db_session):
    doc = await _seed_document(db_session)
    skill = await _seed_skill(db_session)

    r1 = await client.post(f"{BASE}/{doc.id}/skills/{skill.id}")
    assert r1.status_code == 200
    assert str(skill.id) in r1.json()["skill_ids"]

    # Repeat attach is a no-op, not an error, and does not duplicate the tag.
    r2 = await client.post(f"{BASE}/{doc.id}/skills/{skill.id}")
    assert r2.status_code == 200
    assert r2.json()["skill_ids"].count(str(skill.id)) == 1

    r3 = await client.delete(f"{BASE}/{doc.id}/skills/{skill.id}")
    assert r3.status_code == 200
    assert str(skill.id) not in r3.json()["skill_ids"]

    # Repeat detach is also a no-op.
    r4 = await client.delete(f"{BASE}/{doc.id}/skills/{skill.id}")
    assert r4.status_code == 200


async def test_attach_unknown_skill_404(client, db_session):
    doc = await _seed_document(db_session)
    resp = await client.post(f"{BASE}/{doc.id}/skills/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_reprocess_reenqueues(client, db_session):
    doc = await _seed_document(db_session, status = "failed")
    with patch("worker.tasks.process_document") as mock_task:
        resp = await client.post(f"{BASE}/{doc.id}/versions/1/reprocess")
    assert resp.status_code == 200
    assert resp.json()["processing_status"] == "pending"
    mock_task.delay.assert_called_once_with(str(doc.id), 1)


async def test_reprocess_while_processing_rejected(client, db_session):
    doc = await _seed_document(db_session, status = "processing")
    resp = await client.post(f"{BASE}/{doc.id}/versions/1/reprocess")
    assert resp.status_code == 409
