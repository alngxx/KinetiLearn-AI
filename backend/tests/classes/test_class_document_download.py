"""GET /classes/{class_id}/documents/{document_id}/download.

Mints a short-lived signed R2 URL, behind the same gate and the same predicate
as the Materials list — a learner can only ever download what that list already
shows them. R2Storage is patched where classes/service.py imports it, matching
the seam tests/documents/* already use; boto3 itself is never touched.
"""
import uuid
from unittest.mock import MagicMock, patch

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.core.storage import StorageError
from app.main import app
from app.modules.auth.models import User
from app.modules.classes.models import Class, ClassMember
from app.modules.documents.models import ClassDocument, Document, DocumentVersion

BASE = "/api/v1/classes"
SIGNED = "https://r2.example.com/documents/x/v1.pdf?X-Amz-Signature=abc"


@pytest_asyncio.fixture
async def auth_client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app = app)
    async with AsyncClient(transport = transport, base_url = "http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
def mock_storage():
    """Hands back the patched class, with the instance's signer already stubbed."""
    with patch("app.modules.classes.service.R2Storage") as mock_r2:
        mock_r2.return_value.get_presigned_url.return_value = SIGNED
        yield mock_r2


def _auth(user):
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {"Authorization": f"Bearer {token}"}


async def _seed_user(db):
    user = User(
        id = uuid.uuid4(),
        email = f"{uuid.uuid4()}@kineti.com",
        password_hash = get_password_hash("secret123"),
        full_name = "Seed Learner",
        role = "learner",
    )
    db.add(user)
    await db.flush()
    return user


async def _seed_class(db, *members):
    cls = Class(name = f"Class {uuid.uuid4()}")
    db.add(cls)
    await db.flush()
    for user in members:
        db.add(ClassMember(class_id = cls.id, user_id = user.id))
    await db.flush()
    return cls


async def _seed_document(
    db,
    cls,
    *,
    title = "Leave handbook",
    file_name = "Leave handbook.pdf",
    processing_status = "ready",
    is_active = True,
    active_version_number = 1,
    versions = (1,),
):
    doc = Document(
        title = title,
        active_version_number = active_version_number,
        is_active = is_active,
    )
    db.add(doc)
    await db.flush()
    for number in versions:
        db.add(DocumentVersion(
            document_id = doc.id,
            version_number = number,
            file_url = f"documents/{doc.id}/v{number}.pdf",
            file_name = file_name,
            file_size_bytes = 10,
            mime_type = "application/pdf",
            processing_status = processing_status,
        ))
    db.add(ClassDocument(class_id = cls.id, document_id = doc.id))
    await db.flush()
    return doc


def _url(cls, doc):
    return f"{BASE}/{cls.id}/documents/{doc.id}/download"


async def test_member_gets_a_signed_url(auth_client, db_session, mock_storage):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(db_session, cls)
    await db_session.commit()

    resp = await auth_client.get(_url(cls, doc), headers = _auth(user))
    assert resp.status_code == 200
    assert resp.json() == {
        "url": SIGNED,
        "expires_in": settings.DOWNLOAD_URL_EXPIRE_SECONDS,
    }


# The expiry is asserted on the signing call, not by waiting it out.
async def test_url_is_signed_with_a_real_expiry_and_the_stored_filename(
    auth_client, db_session, mock_storage
):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(db_session, cls, file_name = "Leave handbook.pdf")
    await db_session.commit()

    await auth_client.get(_url(cls, doc), headers = _auth(user))

    call = mock_storage.return_value.get_presigned_url.call_args
    assert call.args[0] == f"documents/{doc.id}/v1.pdf"
    assert call.kwargs["expires_in"] == settings.DOWNLOAD_URL_EXPIRE_SECONDS
    assert call.kwargs["expires_in"] > 0
    # Without this the browser saves every document as "v1.pdf".
    assert call.kwargs["download_filename"] == "Leave handbook.pdf"


# A newer version that has not been promoted must not be the one handed out.
async def test_signs_the_promoted_version_not_the_newest(
    auth_client, db_session, mock_storage
):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(
        db_session, cls, active_version_number = 1, versions = (1, 2),
    )
    await db_session.commit()

    await auth_client.get(_url(cls, doc), headers = _auth(user))

    key = mock_storage.return_value.get_presigned_url.call_args.args[0]
    assert key == f"documents/{doc.id}/v1.pdf"


async def test_non_member_rejected(auth_client, db_session, mock_storage):
    member = await _seed_user(db_session)
    outsider = await _seed_user(db_session)
    cls = await _seed_class(db_session, member)
    doc = await _seed_document(db_session, cls)
    await db_session.commit()

    resp = await auth_client.get(_url(cls, doc), headers = _auth(outsider))
    assert resp.status_code == 403
    assert resp.json() == {"detail": "You are not a member of this class."}
    mock_storage.return_value.get_presigned_url.assert_not_called()


# The one that matters most: being enrolled somewhere is not being enrolled
# here, and a document is only downloadable under a class it is linked to.
async def test_document_from_another_class_is_not_served(
    auth_client, db_session, mock_storage
):
    user = await _seed_user(db_session)
    mine = await _seed_class(db_session, user)
    other = await _seed_class(db_session, user)
    elsewhere = await _seed_document(db_session, other, title = "Not for this class")
    await db_session.commit()

    resp = await auth_client.get(_url(mine, elsewhere), headers = _auth(user))
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Document not found."}
    mock_storage.return_value.get_presigned_url.assert_not_called()


async def test_not_ready_version_rejected(auth_client, db_session, mock_storage):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(db_session, cls, processing_status = "processing")
    await db_session.commit()

    resp = await auth_client.get(_url(cls, doc), headers = _auth(user))
    assert resp.status_code == 404
    mock_storage.return_value.get_presigned_url.assert_not_called()


async def test_soft_deleted_document_rejected(auth_client, db_session, mock_storage):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(db_session, cls, is_active = False)
    await db_session.commit()

    resp = await auth_client.get(_url(cls, doc), headers = _auth(user))
    assert resp.status_code == 404


async def test_document_with_no_active_version_rejected(
    auth_client, db_session, mock_storage
):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(db_session, cls, active_version_number = None)
    await db_session.commit()

    resp = await auth_client.get(_url(cls, doc), headers = _auth(user))
    assert resp.status_code == 404


# Same body as every other miss, so the id cannot be used to probe the corpus.
async def test_unknown_document_is_indistinguishable(
    auth_client, db_session, mock_storage
):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    real = await _seed_document(db_session, cls, is_active = False)
    await db_session.commit()

    hidden = await auth_client.get(_url(cls, real), headers = _auth(user))
    missing = await auth_client.get(
        f"{BASE}/{cls.id}/documents/{uuid.uuid4()}/download", headers = _auth(user)
    )
    assert hidden.status_code == missing.status_code == 404
    assert hidden.json() == missing.json() == {"detail": "Document not found."}


async def test_storage_failure_is_a_502(auth_client, db_session, mock_storage):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(db_session, cls)
    await db_session.commit()

    mock_storage.return_value.get_presigned_url.side_effect = StorageError("r2 down")

    resp = await auth_client.get(_url(cls, doc), headers = _auth(user))
    assert resp.status_code == 502
    assert resp.json() == {"detail": "Failed to generate a download link."}


# R2Storage.__init__ raises when the bucket is unconfigured. That is a storage
# failure like any other, not a bare 500.
async def test_unconfigured_storage_is_a_502(auth_client, db_session, mock_storage):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(db_session, cls)
    await db_session.commit()

    mock_storage.side_effect = StorageError("Missing R2 configuration")

    resp = await auth_client.get(_url(cls, doc), headers = _auth(user))
    assert resp.status_code == 502


async def test_requires_auth(auth_client, db_session, mock_storage):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(db_session, cls)
    await db_session.commit()

    resp = await auth_client.get(_url(cls, doc))
    assert resp.status_code == 401
