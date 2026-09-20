"""R2Storage.get_presigned_url's Content-Disposition handling.

The rest of the codebase mocks R2Storage wholesale, so the params it builds are
never exercised anywhere else. boto3's client is stubbed here rather than the
class, because the params are the thing under test.
"""
from unittest.mock import MagicMock, patch

import pytest

from app.core.storage import R2Storage, StorageError


@pytest.fixture
def storage():
    # Patched so construction does not depend on R2 being configured wherever
    # the suite runs.
    with patch("app.core.storage.boto3"), patch("app.core.storage.settings") as cfg:
        cfg.R2_ACCESS_KEY = "key"
        cfg.R2_SECRET_KEY = "secret"
        cfg.R2_BUCKET_NAME = "bucket"
        cfg.R2_ENDPOINT_URL = "https://r2.example.com"
        instance = R2Storage()
    instance.client = MagicMock()
    instance.client.generate_presigned_url.return_value = "https://signed"
    return instance


def _params(storage):
    return storage.client.generate_presigned_url.call_args.kwargs["Params"]


def test_no_disposition_when_no_filename_given(storage):
    storage.get_presigned_url("documents/x/v1.pdf", expires_in = 300)

    assert "ResponseContentDisposition" not in _params(storage)
    assert storage.client.generate_presigned_url.call_args.kwargs["ExpiresIn"] == 300


def test_filename_becomes_an_attachment_disposition(storage):
    storage.get_presigned_url(
        "documents/x/v1.pdf", download_filename = "Leave handbook.pdf",
    )

    assert _params(storage)["ResponseContentDisposition"] == (
        "attachment; filename*=UTF-8''Leave%20handbook.pdf"
    )


# The project already carries Vietnamese copy, so a non-ASCII upload name is a
# realistic case — and a bare filename= parameter cannot express it.
def test_non_ascii_filename_is_percent_encoded(storage):
    storage.get_presigned_url(
        "documents/x/v1.pdf", download_filename = "Quy định nghỉ phép.pdf",
    )

    disposition = _params(storage)["ResponseContentDisposition"]
    assert disposition.startswith("attachment; filename*=UTF-8''")
    assert "%E1%BB%8B" in disposition  # "ị"
    assert disposition.isascii()


# A quote in the stored name cannot break out of the header, because the
# RFC 5987 form percent-encodes it rather than quoting the value.
def test_quote_in_filename_cannot_break_the_header(storage):
    storage.get_presigned_url(
        "documents/x/v1.pdf", download_filename = 'we"ird.pdf',
    )

    disposition = _params(storage)["ResponseContentDisposition"]
    assert '"' not in disposition
    assert "%22" in disposition


def test_client_failure_becomes_storage_error(storage):
    from botocore.exceptions import ClientError

    storage.client.generate_presigned_url.side_effect = ClientError({}, "GetObject")

    with pytest.raises(StorageError):
        storage.get_presigned_url("documents/x/v1.pdf")
