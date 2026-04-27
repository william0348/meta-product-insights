"""
Facebook Insights API client — async Python port of report-worker.ts.

Provides three core functions:
  1. create_report_run()  — kick off an async Facebook report
  2. poll_report_status() — poll until the report finishes
  3. fetch_insights_data() — paginated download with retry logic
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Callable, Awaitable, Optional

import httpx

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────

GRAPH_API_VERSION = "v25.0"
PAGE_SIZE = 1000
MAX_PAGE_RETRIES = 8
MAX_MEGA_RETRIES = 3
MEGA_RETRY_DELAY_MS = 120_000  # 2 minutes between mega retries
MAX_REPORT_RETRIES = 2
POLL_INTERVAL_MS = 5_000
MAX_POLL_ATTEMPTS = 120  # ~10 minutes max

FIELD_LIST = [
    "product_views",
    "converted_product_omni_purchase",
    "converted_product_omni_purchase_values",
    "converted_promoted_product_omni_purchase",
    "converted_promoted_product_omni_purchase_values",
    "converted_promoted_product_website_pixel_purchase",
    "converted_promoted_product_website_pixel_purchase_value",
    "converted_promoted_product_app_custom_event_fb_mobile_purchase",
    "converted_promoted_product_app_custom_event_fb_mobile_purchase_value",
    "converted_promoted_product_offline_purchase",
    "converted_promoted_product_offline_purchase_value",
    "product_name",
    "product_content_id",
    "product_group_content_id",
    "product_brand",
    "product_category",
    "product_custom_label_0",
    "product_custom_label_1",
    "product_custom_label_2",
    "product_custom_label_3",
    "product_custom_label_4",
    "product_retailer_id",
    "impressions",
    "spend",
    "inline_link_clicks",
    "ctr",
    "inline_link_click_ctr",
    "cpm",
    "cpc",
    "cost_per_inline_link_click",
    "purchase_roas",
    "website_purchase_roas",
    "mobile_app_purchase_roas",
    "results",
    "cost_per_result",
    "actions",
    "action_values",
]

# Transient Facebook error codes that are safe to retry
_TRANSIENT_ERROR_CODES = {1, 2, 4, 17, 32, 80004, 190, 368}
_TRANSIENT_MSG_PATTERN = re.compile(r"unknown|temporarily|rate|throttl", re.IGNORECASE)
_RATE_LIMIT_CODES = {4, 32, 80004}
_RATE_LIMIT_MSG_PATTERN = re.compile(r"rate|throttl", re.IGNORECASE)


# ── Facebook API Functions ───────────────────────────────────────────────────


async def create_report_run(
    ad_account_id: str,
    date_start: str,
    date_end: str,
    access_token: str,
    level: str,
    breakdown: str,
    filters: Optional[list[dict[str, Any]]] = None,
) -> str:
    """Create a Facebook async report run. Returns the report_run_id."""

    formatted_id = (
        ad_account_id if ad_account_id.startswith("act_") else f"act_{ad_account_id}"
    )

    bd = breakdown or "product_id"
    fields_str = ",".join(FIELD_LIST)

    # Build URL-encoded body exactly like the frontend does
    from urllib.parse import urlencode
    body_params: dict[str, str] = {
        "access_token": access_token,
        "time_range": json.dumps({"since": date_start, "until": date_end}),
        "breakdowns": bd,
        "fields": fields_str,
        "is_async": "true",
        "export_format": "csv",
        "sort": "impressions_descending",
    }
    if level and level != "account":
        body_params["level"] = level

    encoded_body = urlencode(body_params)

    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{formatted_id}/insights"
    logger.info("[create_report_run] POST %s\n  body=%s", url, encoded_body[:500])

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            url,
            content=encoded_body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        data = resp.json()
        logger.info("[create_report_run] Response: %s", json.dumps(data)[:200])

    if data.get("error"):
        err = data["error"]
        msg = err.get("error_user_msg") or err.get("message") or "Unknown error"
        code = err.get("code", "?")
        raise RuntimeError(f"{msg} (Code: {code})")

    return data["report_run_id"]


async def poll_report_status(
    report_run_id: str,
    access_token: str,
    on_progress: Optional[Callable[[int], Awaitable[None]]] = None,
) -> dict[str, Any]:
    """
    Poll a Facebook async report until completion.

    Returns ``{"success": True}`` or ``{"success": False, "failure_reason": ...}``.
    Raises on timeout.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        for _attempt in range(MAX_POLL_ATTEMPTS):
            url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{report_run_id}"
            resp = await client.get(url, params={"access_token": access_token})
            data = resp.json()

            if data.get("error"):
                raise RuntimeError(data["error"].get("message", "Poll error"))

            status: str = data.get("async_status", "")
            percent: int = data.get("async_percent_completion", 0)

            if on_progress:
                await on_progress(percent)

            if status == "Job Completed":
                async_report_url = data.get("async_report_url")
                logger.info("[poll] Job Completed. async_report_url=%s", async_report_url)
                return {"success": True, "async_report_url": async_report_url}
            if status in ("Job Failed", "Job Skipped"):
                return {"success": False, "failure_reason": status}

            await asyncio.sleep(POLL_INTERVAL_MS / 1000)

    raise RuntimeError("Report generation timed out (polling exceeded max attempts)")


async def fetch_insights_data(
    report_run_id: str,
    access_token: str,
    on_progress: Optional[Callable[[int], Awaitable[None]]] = None,
    on_heartbeat: Optional[Callable[[str], Awaitable[None]]] = None,
    check_cancelled: Optional[Callable[[], Awaitable[bool]]] = None,
) -> list[dict[str, Any]]:
    """
    Fetch all paginated insights data for a completed report run.

    Implements the same retry logic as the TypeScript version:
    - Per-page retry loop (up to MAX_PAGE_RETRIES) with exponential backoff
    - Mega retry loop (up to MAX_MEGA_RETRIES) with 2min/4min/6min delays
    - Rate-limit detection via ``x-business-use-case-usage`` header
    - API-level error handling (Facebook 200 with error body)
    """
    all_data: list[dict[str, Any]] = []
    after: str | None = None
    page_count = 0

    async with httpx.AsyncClient(timeout=25.0) as client:
        while True:
            # ── Cancellation check ───────────────────────────────────
            if check_cancelled:
                cancelled = await check_cancelled()
                if cancelled:
                    logger.info(
                        "Job cancelled by user during data fetch at page %d "
                        "(%d records fetched)",
                        page_count + 1,
                        len(all_data),
                    )
                    raise RuntimeError("Job cancelled by user")

            # Build URL
            params: dict[str, Any] = {
                "access_token": access_token,
                "limit": PAGE_SIZE,
            }
            if after:
                params["after"] = after

            url = (
                f"https://graph.facebook.com/{GRAPH_API_VERSION}/"
                f"{report_run_id}/insights"
            )

            # ── Mega Retry Loop ──────────────────────────────────────
            response_data: dict[str, Any] | None = None
            mega_retry_count = 0

            while mega_retry_count <= MAX_MEGA_RETRIES:
                page_success = False

                # ── Per-page retry loop ──────────────────────────────
                for retry in range(MAX_PAGE_RETRIES + 1):
                    try:
                        resp = await client.get(
                            url,
                            params=params,
                            headers={"Accept-Encoding": "gzip, deflate"},
                        )
                        response_data = resp.json()

                        # Check Facebook rate-limit headers
                        usage_header = (
                            resp.headers.get("x-business-use-case-usage")
                            or resp.headers.get("x-app-usage")
                        )
                        if usage_header:
                            try:
                                usage = json.loads(usage_header)
                                for val in usage.values():
                                    entries = val if isinstance(val, list) else [val]
                                    for entry in entries:
                                        call_pct = (
                                            entry.get("call_count")
                                            or entry.get("total_cputime")
                                            or 0
                                        )
                                        if call_pct > 75:
                                            wait_sec = min(
                                                (call_pct // 10) * 5 + 5, 120
                                            )
                                            logger.info(
                                                "Rate limit approaching (%d%%), "
                                                "waiting %ds…",
                                                call_pct,
                                                wait_sec,
                                            )
                                            if on_heartbeat:
                                                await on_heartbeat(
                                                    f"Rate limit cooldown ({call_pct}%)…"
                                                )
                                            await asyncio.sleep(wait_sec)
                            except Exception:
                                pass  # ignore parse errors

                    except Exception as exc:
                        err_detail = str(exc) or "unknown"
                        if on_heartbeat:
                            await on_heartbeat(
                                f"Page {page_count + 1} retry "
                                f"{retry + 1}/{MAX_PAGE_RETRIES}: {err_detail}"
                            )
                        if retry < MAX_PAGE_RETRIES:
                            delay = min(2**retry * 2.0, 64.0)
                            logger.info(
                                "Page %d fetch failed (%s), retrying in %.0fs… "
                                "(%d/%d)",
                                page_count + 1,
                                err_detail,
                                delay,
                                retry + 1,
                                MAX_PAGE_RETRIES,
                            )
                            await asyncio.sleep(delay)
                            continue
                        # All per-page retries exhausted — fall through to mega retry
                        break

                    # API-level errors (Facebook returns 200 with error body)
                    if response_data and response_data.get("error"):
                        err_msg = (
                            response_data["error"].get("message")
                            or "Failed to fetch insights"
                        )
                        err_code: int = response_data["error"].get("code", 0)
                        is_transient = (
                            err_code in _TRANSIENT_ERROR_CODES
                            or bool(_TRANSIENT_MSG_PATTERN.search(err_msg))
                        )

                        if is_transient and retry < MAX_PAGE_RETRIES:
                            is_rate_limit = (
                                err_code in _RATE_LIMIT_CODES
                                or bool(_RATE_LIMIT_MSG_PATTERN.search(err_msg))
                            )
                            if is_rate_limit:
                                delay = min(2**retry * 30.0, 300.0)
                            else:
                                delay = min(2**retry * 3.0, 60.0)
                            logger.info(
                                "Page %d API error code=%d (%s), retrying in "
                                "%.0fs… (%d/%d)",
                                page_count + 1,
                                err_code,
                                err_msg,
                                delay,
                                retry + 1,
                                MAX_PAGE_RETRIES,
                            )
                            if on_heartbeat:
                                await on_heartbeat(
                                    f"API error on page {page_count + 1}, "
                                    f"retrying in {delay:.0f}s…"
                                )
                            await asyncio.sleep(delay)
                            response_data = None
                            continue

                        # Non-transient or exhausted retries
                        response_data = None
                        break

                    page_success = True
                    break  # success
                # ── End per-page retry loop ──────────────────────────

                if page_success and response_data:
                    break  # Got data, exit mega retry loop

                # Per-page retries exhausted — attempt mega retry
                if mega_retry_count < MAX_MEGA_RETRIES:
                    mega_retry_count += 1
                    mega_delay_s = (MEGA_RETRY_DELAY_MS * mega_retry_count) / 1000
                    logger.info(
                        "Page %d: all %d retries exhausted. Mega retry %d/%d "
                        "in %.0fs…",
                        page_count + 1,
                        MAX_PAGE_RETRIES,
                        mega_retry_count,
                        MAX_MEGA_RETRIES,
                        mega_delay_s,
                    )
                    if on_heartbeat:
                        await on_heartbeat(
                            f"Page {page_count + 1}: extended cooldown "
                            f"{mega_delay_s:.0f}s (mega retry "
                            f"{mega_retry_count}/{MAX_MEGA_RETRIES})"
                        )

                    # Send heartbeat every 30s during the long wait
                    intervals = int(mega_delay_s // 30)
                    for i in range(intervals):
                        await asyncio.sleep(30)
                        if on_heartbeat:
                            await on_heartbeat(
                                f"Page {page_count + 1}: waiting… "
                                f"({(i + 1) * 30}s / {mega_delay_s:.0f}s)"
                            )
                    remainder = mega_delay_s % 30
                    if remainder > 0:
                        await asyncio.sleep(remainder)

                    response_data = None
                    continue  # Retry the whole page

                # All mega retries exhausted
                raise RuntimeError(
                    f"Failed to fetch page {page_count + 1} after "
                    f"{MAX_PAGE_RETRIES} retries × {MAX_MEGA_RETRIES} mega retries"
                )
            # ── End Mega Retry Loop ──────────────────────────────────

            if not response_data:
                raise RuntimeError(
                    f"Failed to fetch insights page {page_count + 1} after all retries"
                )

            rows: list[dict[str, Any]] = response_data.get("data", [])
            all_data.extend(rows)
            page_count += 1
            logger.info(
                "Page %d: %d records (total: %d)",
                page_count,
                len(rows),
                len(all_data),
            )

            if on_progress:
                await on_progress(len(all_data))

            paging = response_data.get("paging", {})
            cursors = paging.get("cursors", {})
            if paging.get("next") and cursors.get("after"):
                after = cursors["after"]
            else:
                break

    return all_data
