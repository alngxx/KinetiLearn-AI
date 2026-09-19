"""Class assignment on documents: the class_documents join.

Covers the link itself — created at upload, reassigned via PATCH, filtered on in
the list endpoint, and cascaded from both sides. The exam-generation side of it
(rejecting a document that belongs to another class) lives in
tests/exams/test_exam_generation.py, next to the rest of that endpoint.
"""
import uuid
from unittest.mock import patch

from sqlalchemy import select

from app.core.dependencies import require_admin
from app.main import app
from app.modules.classes.models import Class
from app.modules.config.models import Category
from app.modules.documents.models import ClassDocument, Document, DocumentVersion

BASE = "/api/v1/documents"
CLASSES = "/api/v1/classes"


async def _seed_category(db):
    cat = Category(name = f"Cat {uuid.uuid4()}")
    db.add(cat)
    await db.flush()
    return cat


async def _seed_class(db):
    cls = Class(name = f"Class {uuid.uuid4()}")
    db.add(cls)
    await db.flush()
    return cls


async def _seed_document(db, *, classes = (), title = None):
    doc = Document(title = title or f"Doc {uuid.uuid4()}", active_version_number = 1)
    db.add(doc)
    await db.flush()
    db.add(DocumentVersion(
        document_id = doc.id,
        version_number = 1,
        file_url = "documents/x/v1.pdf",
        file_name = "f.pdf",
        file_size_bytes = 10,
        mime_type = "application/pdf",
        processing_status = "ready",
    ))
    for cls in classes:
        db.add(ClassDocument(class_id = cls.id, document_id = doc.id))
    await db.flush()
    return doc


async def _linked_class_ids(db, document_id):
    result = await db.execute(
        select(ClassDocument.class_id).where(ClassDocument.document_id == document_id)
    )
    return set(result.scalars().all())


async def _upload(client, cat, class_ids, *, title = "Doc A"):
    # The shared fixture stubs require_admin as a dict, but the upload route reads
    # current_user.id — override it with a minimal user (nullable uploader_id).
    app.dependency_overrides[require_admin] = lambda: type("U", (), {"id": None})()
    data = {"title": title, "category_id": str(cat.id)}
    if class_ids is not None:
        data["class_ids"] = [str(c) for c in class_ids]
    with patch("app.modules.documents.service.R2Storage") as mock_r2, \
         patch("worker.tasks.process_document"):
        mock_r2.return_value.upload.return_value = "key"
        return await client.post(
            f"{BASE}/upload",
            data = data,
            files = {"file": ("a.pdf", b"%PDF-1.4 test", "application/pdf")},
        )


# --- upload ---------------------------------------------------------------

async def test_upload_with_class_ids_persists_the_links(client, db_session):
    cat = await _seed_category(db_session)
    first = await _seed_class(db_session)
    second = await _seed_class(db_session)

    resp = await _upload(client, cat, [first.id, second.id])

    assert resp.status_code == 201
    document_id = uuid.UUID(resp.json()["document_id"])
    assert await _linked_class_ids(db_session, document_id) == {first.id, second.id}


async def test_upload_without_class_ids_rejected(client, db_session):
    cat = await _seed_category(db_session)

    resp = await _upload(client, cat, None)

    assert resp.status_code == 422


async def test_upload_with_unknown_class_rejected(client, db_session):
    cat = await _seed_category(db_session)
    missing = uuid.uuid4()

    resp = await _upload(client, cat, [missing])

    assert resp.status_code == 422
    assert str(missing) in resp.json()["detail"]


async def test_reupload_unions_classes_rather_than_replacing(client, db_session):
    # A version bump must not pull the document out of a class it was serving.
    cat = await _seed_category(db_session)
    first = await _seed_class(db_session)
    second = await _seed_class(db_session)

    created = await _upload(client, cat, [first.id], title = "Same title")
    assert created.status_code == 201
    document_id = uuid.UUID(created.json()["document_id"])

    again = await _upload(client, cat, [second.id], title = "Same title")

    assert again.status_code == 201
    # Same document, next version — not a new document.
    assert uuid.UUID(again.json()["document_id"]) == document_id
    assert again.json()["version_number"] == 2
    assert await _linked_class_ids(db_session, document_id) == {first.id, second.id}


# --- list filter ----------------------------------------------------------

async def test_list_filtered_by_class_returns_only_that_class(client, db_session):
    wanted = await _seed_class(db_session)
    other = await _seed_class(db_session)
    mine = await _seed_document(db_session, classes = [wanted])
    shared = await _seed_document(db_session, classes = [wanted, other])
    await _seed_document(db_session, classes = [other])
    await _seed_document(db_session)  # assigned to nothing at all
    await db_session.commit()

    resp = await client.get(BASE, params = {"class_id": str(wanted.id)})

    assert resp.status_code == 200
    returned = {row["document_id"] for row in resp.json()}
    assert returned == {str(mine.id), str(shared.id)}


async def test_list_includes_class_ids(client, db_session):
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session, classes = [cls])
    await db_session.commit()

    resp = await client.get(BASE)

    assert resp.status_code == 200
    row = next(r for r in resp.json() if r["document_id"] == str(doc.id))
    assert row["class_ids"] == [str(cls.id)]


# --- reassignment ---------------------------------------------------------

async def test_patch_replaces_the_class_assignment(client, db_session):
    first = await _seed_class(db_session)
    second = await _seed_class(db_session)
    third = await _seed_class(db_session)
    doc = await _seed_document(db_session, classes = [first, second])
    await db_session.commit()

    resp = await client.patch(
        f"{BASE}/{doc.id}",
        json = {"class_ids": [str(second.id), str(third.id)]},
    )

    assert resp.status_code == 200
    assert set(resp.json()["class_ids"]) == {str(second.id), str(third.id)}
    # first was dropped, third was added.
    assert await _linked_class_ids(db_session, doc.id) == {second.id, third.id}


async def test_patch_without_class_ids_leaves_them_alone(client, db_session):
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session, classes = [cls])
    await db_session.commit()

    resp = await client.patch(f"{BASE}/{doc.id}", json = {"title": "Renamed"})

    assert resp.status_code == 200
    assert resp.json()["title"] == "Renamed"
    assert await _linked_class_ids(db_session, doc.id) == {cls.id}


async def test_patch_to_an_empty_class_list_rejected(client, db_session):
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session, classes = [cls])
    await db_session.commit()

    resp = await client.patch(f"{BASE}/{doc.id}", json = {"class_ids": []})

    assert resp.status_code == 422
    assert await _linked_class_ids(db_session, doc.id) == {cls.id}


async def test_patch_with_unknown_class_rejected(client, db_session):
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session, classes = [cls])
    await db_session.commit()
    missing = uuid.uuid4()

    resp = await client.patch(f"{BASE}/{doc.id}", json = {"class_ids": [str(missing)]})

    assert resp.status_code == 422
    assert await _linked_class_ids(db_session, doc.id) == {cls.id}


# --- cascades -------------------------------------------------------------

async def test_deleting_a_class_drops_the_links_and_keeps_the_document(
    client, db_session
):
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session, classes = [cls])
    await db_session.commit()

    resp = await client.delete(f"{CLASSES}/{cls.id}")

    assert resp.status_code == 200
    assert await _linked_class_ids(db_session, doc.id) == set()
    assert await db_session.get(Document, doc.id) is not None


async def test_deleting_a_document_drops_the_links_and_keeps_the_class(
    client, db_session
):
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session, classes = [cls])
    await db_session.commit()

    resp = await client.delete(f"{BASE}/{doc.id}")

    assert resp.status_code == 200
    assert await _linked_class_ids(db_session, doc.id) == set()
    assert await db_session.get(Class, cls.id) is not None
