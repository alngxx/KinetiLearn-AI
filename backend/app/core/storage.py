import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings


class StorageError(Exception):
    """Raised when an R2 storage operation fails."""


class R2Storage:
    def __init__(self):
        required = {
            "R2_ACCESS_KEY": settings.R2_ACCESS_KEY,
            "R2_SECRET_KEY": settings.R2_SECRET_KEY,
            "R2_BUCKET_NAME": settings.R2_BUCKET_NAME,
            "R2_ENDPOINT_URL": settings.R2_ENDPOINT_URL,
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise StorageError(f"Missing R2 configuration: {', '.join(missing)}")

        self.bucket = settings.R2_BUCKET_NAME
        self.client = boto3.client(
            "s3",
            endpoint_url = settings.R2_ENDPOINT_URL,
            aws_access_key_id = settings.R2_ACCESS_KEY,
            aws_secret_access_key = settings.R2_SECRET_KEY,
            config = Config(signature_version = "s3v4"),
        )

    def upload(self, key: str, data: bytes,
               content_type: str = "application/octet-stream") -> str:
        try:
            self.client.put_object(
                Bucket = self.bucket, Key = key, Body = data,
                ContentType = content_type,
            )
        except (BotoCoreError, ClientError) as e:
            raise StorageError(f"Failed to upload '{key}': {e}") from e
        return key

    def download(self, key: str) -> bytes:
        try:
            obj = self.client.get_object(Bucket = self.bucket, Key = key)
            return obj["Body"].read()
        except (BotoCoreError, ClientError) as e:
            raise StorageError(f"Failed to download '{key}': {e}") from e

    def get_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        try:
            return self.client.generate_presigned_url(
                "get_object",
                Params = {"Bucket": self.bucket, "Key": key},
                ExpiresIn = expires_in,
            )
        except (BotoCoreError, ClientError) as e:
            raise StorageError(f"Failed to generate URL for '{key}': {e}") from e

    def delete(self, key: str) -> None:
        # S3/R2 delete_object is inherently idempotent: deleting a
        # non-existent key returns success, so no special-casing needed.
        try:
            self.client.delete_object(Bucket = self.bucket, Key = key)
        except (BotoCoreError, ClientError) as e:
            raise StorageError(f"Failed to delete '{key}': {e}") from e
