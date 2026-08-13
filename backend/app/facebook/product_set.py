"""Product Set (Marketing API) helpers — count products in a product set."""

import logging

import httpx

from .catalog import BASE_URL, _LIMITS

logger = logging.getLogger(__name__)


async def fetch_product_set_count(product_set_id: str, access_token: str) -> int:
    """Single API call using summary=true&limit=0 → total product count.

    Way faster than paginating: a 68k-product set goes from ~6 min to ~1 s."""
    url = f"{BASE_URL}/{product_set_id}/products"
    params = {
        "summary": "true",
        "limit": 0,
        "access_token": access_token,
    }
    async with httpx.AsyncClient(limits=_LIMITS, timeout=30.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        body = resp.json()
        count = int(((body.get("summary") or {}).get("total_count")) or 0)
    logger.info("Counted %d products in product_set %s", count, product_set_id)
    return count
