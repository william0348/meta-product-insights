"""
Facebook Catalog API client.

Async wrapper around the Facebook Graph API for catalog product operations
(fetch, batch update/create/delete). Uses httpx + asyncio.Semaphore for
concurrency control.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, TypedDict

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FB_API_VERSION = "v25.0"
BASE_URL = f"https://graph.facebook.com/{FB_API_VERSION}"
MAX_BATCH_SIZE = 3000
MAX_FETCH_BATCH_SIZE = 25
FETCH_CONCURRENCY = 10
UPDATE_CONCURRENCY = 10

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


class FBProduct(TypedDict, total=False):
    id: str
    retailer_id: str
    name: str
    custom_label_0: str
    custom_label_1: str
    custom_label_2: str
    custom_label_3: str
    custom_label_4: str
    tags: list[str]
    custom_number_0: float
    custom_number_1: float
    custom_number_2: float
    custom_number_3: float
    custom_number_4: float


class BatchRequestItem(TypedDict):
    method: str  # "UPDATE" | "DELETE" | "CREATE"
    data: dict[str, Any]


class BatchResponse(TypedDict):
    handles: list[str]
    validation_status: list[Any]


class BatchStatusResponse(TypedDict):
    data: list[dict[str, Any]]
    # Each dict may contain: status, errors_total_count, errors,
    # validation_status, ids_of_invalid_requests


class ParallelBatchResponse(TypedDict):
    handles: list[str]
    validation_status: list[Any]
    totalProcessed: int
    batchCount: int
    success: bool
    errors: list[str]


# ---------------------------------------------------------------------------
# Shared HTTP client
# ---------------------------------------------------------------------------

_LIMITS = httpx.Limits(max_connections=20, max_keepalive_connections=10)

PRODUCT_FIELDS = ",".join(
    [
        "id",
        "retailer_id",
        "name",
        "custom_label_0",
        "custom_label_1",
        "custom_label_2",
        "custom_label_3",
        "custom_label_4",
        "tags",
        "custom_number_0",
        "custom_number_1",
        "custom_number_2",
        "custom_number_3",
        "custom_number_4",
    ]
)

# ---------------------------------------------------------------------------
# Fetch helpers
# ---------------------------------------------------------------------------


async def fetch_product_batch(
    catalog_id: str,
    retailer_ids: list[str],
    access_token: str,
    *,
    max_retries: int = 3,
) -> list[dict[str, Any]]:
    """Fetch a single batch of products by retailer IDs with retry logic."""

    filter_param = json.dumps({"retailer_id": {"is_any": retailer_ids}})
    url = f"{BASE_URL}/{catalog_id}/products"
    params = {
        "filter": filter_param,
        "fields": PRODUCT_FIELDS,
        "limit": str(len(retailer_ids)),
        "access_token": access_token,
    }

    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(limits=_LIMITS, timeout=60.0) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
                products: list[dict[str, Any]] = data.get("data", [])
                logger.info(
                    "Fetched %d products for %d retailer IDs",
                    len(products),
                    len(retailer_ids),
                )
                return products
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            backoff = 2**attempt  # 1s, 2s, 4s
            logger.warning(
                "fetch_product_batch attempt %d/%d failed: %s — retrying in %ds",
                attempt + 1,
                max_retries,
                exc,
                backoff,
            )
            if attempt < max_retries - 1:
                await asyncio.sleep(backoff)
            else:
                logger.error(
                    "fetch_product_batch failed after %d retries", max_retries
                )
                raise

    return []  # unreachable, but keeps mypy happy


async def fetch_products_by_retailer_ids(
    catalog_id: str,
    retailer_ids: list[str],
    access_token: str,
    *,
    max_retries: int = 3,
) -> list[dict[str, Any]]:
    """Fetch products in parallel batches of MAX_FETCH_BATCH_SIZE."""

    if not retailer_ids:
        return []

    batches = [
        retailer_ids[i : i + MAX_FETCH_BATCH_SIZE]
        for i in range(0, len(retailer_ids), MAX_FETCH_BATCH_SIZE)
    ]
    logger.info(
        "Fetching %d retailer IDs in %d batches (concurrency=%d)",
        len(retailer_ids),
        len(batches),
        FETCH_CONCURRENCY,
    )

    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)
    all_products: list[dict[str, Any]] = []

    async def _fetch_with_semaphore(batch: list[str], idx: int) -> list[dict[str, Any]]:
        async with semaphore:
            # Small delay between batch groups to avoid rate limits
            if idx > 0:
                await asyncio.sleep(0.5)
            return await fetch_product_batch(
                catalog_id, batch, access_token, max_retries=max_retries
            )

    tasks = [_fetch_with_semaphore(batch, i) for i, batch in enumerate(batches)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.error("Batch %d failed: %s", i, result)
        else:
            all_products.extend(result)

    logger.info("Total products fetched: %d", len(all_products))
    return all_products


# ---------------------------------------------------------------------------
# Batch status
# ---------------------------------------------------------------------------


async def check_batch_request_status(
    catalog_id: str,
    handle: str,
    access_token: str,
    *,
    load_invalid_ids: bool = True,
) -> dict[str, Any]:
    """Check the status of a batch request by its handle."""

    url = f"{BASE_URL}/{catalog_id}/check_batch_request_status"
    params = {
        "handle": handle,
        "load_ids_of_invalid_requests": str(load_invalid_ids).lower(),
        "access_token": access_token,
    }

    async with httpx.AsyncClient(limits=_LIMITS, timeout=30.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        logger.info("Batch status for handle %s: %s", handle, json.dumps(data)[:200])
        return data


# ---------------------------------------------------------------------------
# Batch send / update
# ---------------------------------------------------------------------------


async def send_batch_request(
    catalog_id: str,
    requests: list[BatchRequestItem],
    access_token: str,
    *,
    allow_upsert: bool = False,
    batch_index: int = 0,
) -> dict[str, Any]:
    """Send a single items_batch request to Facebook."""

    url = f"{BASE_URL}/{catalog_id}/items_batch"
    payload: dict[str, Any] = {
        "access_token": access_token,
        "requests": json.dumps(requests),
    }
    if allow_upsert:
        payload["allow_upsert"] = "true"

    logger.info(
        "Sending batch %d with %d requests to catalog %s",
        batch_index,
        len(requests),
        catalog_id,
    )

    async with httpx.AsyncClient(limits=_LIMITS, timeout=120.0) as client:
        resp = await client.post(url, data=payload)
        resp.raise_for_status()
        data = resp.json()
        logger.info(
            "Batch %d response — handles: %s",
            batch_index,
            data.get("handles", []),
        )
        return data


async def batch_update_products(
    catalog_id: str,
    requests: list[BatchRequestItem],
    access_token: str,
    *,
    allow_upsert: bool = False,
) -> ParallelBatchResponse:
    """Split requests into MAX_BATCH_SIZE chunks and send in parallel."""

    if not requests:
        return ParallelBatchResponse(
            handles=[],
            validation_status=[],
            totalProcessed=0,
            batchCount=0,
            success=True,
            errors=[],
        )

    batches = [
        requests[i : i + MAX_BATCH_SIZE]
        for i in range(0, len(requests), MAX_BATCH_SIZE)
    ]
    logger.info(
        "batch_update_products: %d total requests → %d batches (concurrency=%d)",
        len(requests),
        len(batches),
        UPDATE_CONCURRENCY,
    )

    semaphore = asyncio.Semaphore(UPDATE_CONCURRENCY)
    all_handles: list[str] = []
    all_validation: list[Any] = []
    errors: list[str] = []

    async def _send_with_semaphore(
        batch: list[BatchRequestItem], idx: int
    ) -> dict[str, Any]:
        async with semaphore:
            if idx > 0:
                await asyncio.sleep(1.0)
            return await send_batch_request(
                catalog_id,
                batch,
                access_token,
                allow_upsert=allow_upsert,
                batch_index=idx,
            )

    tasks = [_send_with_semaphore(batch, i) for i, batch in enumerate(batches)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for i, result in enumerate(results):
        if isinstance(result, Exception):
            msg = f"Batch {i} failed: {result}"
            logger.error(msg)
            errors.append(msg)
        else:
            all_handles.extend(result.get("handles", []))
            all_validation.extend(result.get("validation_status", []))

    total_processed = len(requests) - len(errors) * MAX_BATCH_SIZE
    if total_processed < 0:
        total_processed = 0

    return ParallelBatchResponse(
        handles=all_handles,
        validation_status=all_validation,
        totalProcessed=len(requests),
        batchCount=len(batches),
        success=len(errors) == 0,
        errors=errors,
    )


# ---------------------------------------------------------------------------
# Request builders
# ---------------------------------------------------------------------------


def create_update_request(
    retailer_id: str, data: dict[str, Any]
) -> BatchRequestItem:
    """Build an UPDATE batch request item."""
    return BatchRequestItem(
        method="UPDATE",
        data={"id": retailer_id, **data},
    )


def create_delete_request(retailer_id: str) -> BatchRequestItem:
    """Build a DELETE batch request item."""
    return BatchRequestItem(
        method="DELETE",
        data={"id": retailer_id},
    )


def create_create_request(
    retailer_id: str, data: dict[str, Any]
) -> BatchRequestItem:
    """Build a CREATE batch request item."""
    return BatchRequestItem(
        method="CREATE",
        data={"id": retailer_id, **data},
    )
