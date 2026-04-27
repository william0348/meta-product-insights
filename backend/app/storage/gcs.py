import json
import logging
from google.cloud import storage as gcs_storage
from ..config import settings

logger = logging.getLogger(__name__)
_client = None


def _get_client():
    global _client
    if _client is None:
        if settings.gcs_credentials_path:
            _client = gcs_storage.Client.from_service_account_json(settings.gcs_credentials_path)
        else:
            _client = gcs_storage.Client()
    return _client


async def storage_put(rel_key: str, data: str | bytes, content_type: str = "application/json") -> dict:
    """Upload data to GCS, return {"key": ..., "url": ...}"""
    import asyncio
    client = _get_client()
    bucket = client.bucket(settings.gcs_bucket)
    blob = bucket.blob(rel_key)

    if isinstance(data, str):
        data = data.encode("utf-8")

    # Run in executor since GCS client is synchronous
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: blob.upload_from_string(data, content_type=content_type))

    url = f"https://storage.googleapis.com/{settings.gcs_bucket}/{rel_key}"
    logger.info(f"[Storage] Uploaded {rel_key} ({len(data)} bytes)")
    return {"key": rel_key, "url": url}


async def storage_get(rel_key: str) -> dict:
    """Get a signed download URL for a GCS object"""
    import asyncio
    from datetime import timedelta
    client = _get_client()
    bucket = client.bucket(settings.gcs_bucket)
    blob = bucket.blob(rel_key)

    loop = asyncio.get_event_loop()
    url = await loop.run_in_executor(
        None, lambda: blob.generate_signed_url(expiration=timedelta(hours=24))
    )
    return {"key": rel_key, "url": url}
