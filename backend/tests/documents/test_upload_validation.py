import uuid
from unittest.mock import patch

from app.core.dependencies import require_admin
from app.main import app
from app.modules.config.models import Category

BASE = "/api/v1/documents"


async def _seed_category(db):
    cat = Category(name = f"Cat {uuid.uuid4()}")
    db.add(cat)
    await db.flush()
    return cat


async def test_upload_markdown_with_odd_content_type_accepted(client, db_session):
    # The shared fixture stubs require_admin as a dict, but the upload route reads
    # current_user.id — override it with a minimal user (nullable uploader_id).
    app.dependency_overrides[require_admin] = lambda: type("U", (), {"id": None})()

    cat = await _seed_category(db_session)

    with patch("app.modules.documents.service.R2Storage") as mock_r2, \
         patch("worker.tasks.process_document"):
        mock_r2.return_value.upload.return_value = "key"
        resp = await client.post(
            f"{BASE}/upload",
            data = {"title": "Doc MD", "category_id": str(cat.id)},
            # A browser reporting an empty/odd content_type for a .md file is
            # exactly the case a filename-based check has to cover.
            files = {"file": ("notes.md", b"# Title\n\nSome text.", "")},
        )

    assert resp.status_code == 201
    assert resp.json()["mime_type"] == "text/markdown"


async def test_upload_unsupported_type_rejected(client, db_session):
    app.dependency_overrides[require_admin] = lambda: type("U", (), {"id": None})()

    cat = await _seed_category(db_session)

    resp = await client.post(
        f"{BASE}/upload",
        data = {"title": "Doc TXT", "category_id": str(cat.id)},
        files = {"file": ("notes.txt", b"plain text", "text/plain")},
    )

    assert resp.status_code == 422
    assert "PDF, DOCX, or Markdown" in resp.json()["detail"]
