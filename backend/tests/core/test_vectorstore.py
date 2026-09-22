"""The vectorstore facade's backend selection, and the Pinecone backend's own
filter-building and lazy-client logic.

No live Pinecone credentials are used anywhere here — the Pinecone client class is
mocked wholesale, the same way test_storage_presigned.py mocks boto3 rather than
hitting R2. app.core.vectorstore itself is reloaded per test because it picks its
backend at import time from settings.VECTOR_STORE_BACKEND; every test restores both
the setting and the module afterwards so the rest of the suite (which patches
"app.core.vectorstore.search" and similar by string path) is unaffected.
"""
import importlib
import sys
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.core import chroma_backend, pinecone_backend
from app.core.config import settings


@pytest.fixture
def reload_vectorstore():
    original = settings.VECTOR_STORE_BACKEND

    def _reload(backend_name):
        settings.VECTOR_STORE_BACKEND = backend_name
        sys.modules.pop("app.core.vectorstore", None)
        return importlib.import_module("app.core.vectorstore")

    yield _reload

    settings.VECTOR_STORE_BACKEND = original
    sys.modules.pop("app.core.vectorstore", None)
    importlib.import_module("app.core.vectorstore")


def test_chroma_is_selected_when_configured(reload_vectorstore):
    vectorstore = reload_vectorstore("chroma")
    assert vectorstore._backend is chroma_backend


def test_pinecone_is_selected_when_configured(reload_vectorstore):
    vectorstore = reload_vectorstore("pinecone")
    assert vectorstore._backend is pinecone_backend


def test_unrecognized_backend_raises_at_import_time(reload_vectorstore):
    with pytest.raises(RuntimeError, match = "Unrecognized VECTOR_STORE_BACKEND"):
        reload_vectorstore("weaviate")


# --- pinecone_backend._scope_filter -----------------------------------------

def test_single_document_scope_skips_the_or_wrapper():
    document_id = uuid4()

    result = pinecone_backend._scope_filter([(document_id, 3)])

    assert result == {
        "$and": [
            {"document_id": {"$eq": str(document_id)}},
            {"version_number": {"$eq": 3}},
        ]
    }
    assert "$or" not in result


def test_multi_document_scope_ors_the_and_clauses():
    doc_a, doc_b = uuid4(), uuid4()

    result = pinecone_backend._scope_filter([(doc_a, 1), (doc_b, 2)])

    assert result == {
        "$or": [
            {
                "$and": [
                    {"document_id": {"$eq": str(doc_a)}},
                    {"version_number": {"$eq": 1}},
                ]
            },
            {
                "$and": [
                    {"document_id": {"$eq": str(doc_b)}},
                    {"version_number": {"$eq": 2}},
                ]
            },
        ]
    }


# --- pinecone_backend lazy client --------------------------------------------

@pytest.fixture
def reset_pinecone_client():
    pinecone_backend._client = None
    pinecone_backend._index = None
    yield
    pinecone_backend._client = None
    pinecone_backend._index = None


def test_get_index_raises_clearly_without_credentials(reset_pinecone_client):
    with patch.object(settings, "PINECONE_API_KEY", ""), \
         patch.object(settings, "PINECONE_INDEX", ""):
        with pytest.raises(RuntimeError, match = "PINECONE_API_KEY"):
            pinecone_backend._get_index()


def test_get_index_builds_client_once_and_reuses_it(reset_pinecone_client):
    mock_index = MagicMock()
    mock_client = MagicMock()
    mock_client.Index.return_value = mock_index

    with patch.object(settings, "PINECONE_API_KEY", "key"), \
         patch.object(settings, "PINECONE_INDEX", "idx"), \
         patch("app.core.pinecone_backend.Pinecone", return_value = mock_client) as mock_pinecone:
        first = pinecone_backend._get_index()
        second = pinecone_backend._get_index()

    assert first is mock_index
    assert second is mock_index
    mock_pinecone.assert_called_once_with(api_key = "key")
    mock_client.Index.assert_called_once_with("idx")


def test_search_returns_native_score_without_l2_conversion(reset_pinecone_client):
    document_id = uuid4()
    match = MagicMock(id = "vec-1", score = 0.42)
    mock_index = MagicMock()
    mock_index.query.return_value = MagicMock(matches = [match])

    with patch.object(pinecone_backend, "_get_index", return_value = mock_index):
        hits = pinecone_backend.search([0.1, 0.2], [(document_id, 1)], top_k = 5)

    assert hits == [{"vector_id": "vec-1", "similarity": 0.42}]


def test_search_with_empty_scope_skips_the_query(reset_pinecone_client):
    mock_index = MagicMock()

    with patch.object(pinecone_backend, "_get_index", return_value = mock_index):
        hits = pinecone_backend.search([0.1, 0.2], [], top_k = 5)

    assert hits == []
    mock_index.query.assert_not_called()


def test_delete_on_a_namespace_that_does_not_exist_yet_is_a_no_op(reset_pinecone_client):
    # A namespace only exists once something has been upserted into it, so
    # Pinecone 404s a filter delete against a brand-new/already-empty index
    # instead of matching zero vectors - delete_version/delete_document must
    # swallow that and behave like Chroma's no-op-on-nothing-to-delete.
    from pinecone.errors.exceptions import NotFoundError

    mock_index = MagicMock()
    mock_index.delete.side_effect = NotFoundError(reason = "Namespace not found")

    with patch.object(pinecone_backend, "_get_index", return_value = mock_index):
        pinecone_backend.delete_version(uuid4(), 1)
        pinecone_backend.delete_document(uuid4())
