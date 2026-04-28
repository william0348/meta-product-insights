"""
Report Worker - orchestrates the full Facebook Ads Insights report pipeline.

Python port of report-worker.ts. Handles:
- Creating and polling async report runs
- Fetching paginated insights data
- Post-processing filters (maxCVR, topConversionLimit)
- Storing results to local file under backend/reports/
- Optionally updating product catalog with custom labels
- Heartbeat tracking for job health monitoring
"""

import asyncio
import csv
import io
import json
import logging
import time
from datetime import datetime
from typing import Any, Optional, Callable, Awaitable

import httpx
from nanoid import generate as _nanoid_generate

from sqlalchemy import update as sql_update

from ..facebook.insights import (
    create_report_run,
    poll_report_status,
    fetch_insights_data,
)
from ..facebook.catalog import batch_update_products, create_update_request
from ..database import get_session_factory
from ..models import ScheduledJob, ScheduleRun

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MAX_REPORT_RETRIES = 2
FB_CATALOG_API_VERSION = "v25.0"

# ---------------------------------------------------------------------------
# In-memory heartbeat
# ---------------------------------------------------------------------------
worker_heartbeats: dict[int, float] = {}  # jobId -> epoch timestamp


def touch_heartbeat(job_id: int) -> None:
    """Record the current time as the last heartbeat for *job_id*."""
    worker_heartbeats[job_id] = time.time()


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def p_float(val: Any) -> float:
    """Parse *val* to float. Returns 0.0 on ``None``, empty string, or error."""
    if val is None or val == "":
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def p_int(val: Any) -> int:
    """Parse *val* to int. Returns 0 on ``None``, empty string, or error."""
    if val is None or val == "":
        return 0
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return 0


def _get(row: dict, *keys: str) -> Any:
    """Get value from row trying multiple possible column names."""
    for k in keys:
        v = row.get(k)
        if v is not None:
            return v
    return None


def map_row_to_product_insight(row: dict) -> dict:
    """Convert a raw row (JSON or CSV format) to normalised ProductInsight dict."""
    is_csv = "Product Name" in row or "Impressions" in row

    if is_csv:
        return _map_csv_row(row)
    return _map_json_row(row)


def _map_csv_row(row: dict) -> dict:
    """Map CSV format row (column names like 'Product Name', 'Impressions')."""
    link_clicks = p_int(_get(row, "Product link clicks", "Link clicks"))
    catalog_purchases = p_int(_get(row, "Product purchases", "Meta purchases"))
    cvr = (catalog_purchases / link_clicks * 100) if link_clicks > 0 else 0.0

    return {
        "product_name": _get(row, "Product Name") or "",
        "product_retailer_id": _get(row, "Content ID") or "",
        "product_brand": _get(row, "Brand") or "",
        "impressions": p_int(_get(row, "Impressions")),
        "spend": p_float(_get(row, "Product amount spent")),
        "link_clicks": link_clicks,
        "inline_link_click_ctr": p_float(_get(row, "CTR (link click-through rate)")),
        "cvr": round(cvr, 4),
        "cpm": p_float(_get(row, "CPM (cost per 1,000 impressions)")),
        "cost_per_inline_link_click": p_float(_get(row, "Product CPC (cost per product link click)")),
        "purchases": p_int(_get(row, "Product attributed orders")),
        "adds_to_cart": p_int(_get(row, "Product adds to cart", "Meta adds to cart")),
        "catalog_purchases": catalog_purchases,
        "product_set_purchases": p_int(_get(row, "Product set purchases")),
        "product_views": p_int(_get(row, "Product views")),
    }


def _map_json_row(row: dict) -> dict:
    """Map JSON format row (column names like 'product_name', 'impressions')."""
    actions: list[dict] = row.get("actions") or []
    omni_purchase = 0
    adds_to_cart = 0
    product_views = 0
    for action in actions:
        action_type = action.get("action_type", "")
        action_value = p_int(action.get("value"))
        if action_type == "omni_purchase":
            omni_purchase = action_value
        elif action_type == "omni_add_to_cart":
            adds_to_cart = action_value
        elif action_type == "omni_view_content":
            product_views = action_value

    catalog_purchases = p_int(_get(row, "converted_product_omni_purchase"))
    if catalog_purchases == 0:
        catalog_purchases = omni_purchase

    link_clicks = p_int(row.get("inline_link_clicks"))
    cvr = (catalog_purchases / link_clicks) * 100 if link_clicks > 0 else 0.0

    return {
        "product_name": row.get("product_name", ""),
        "product_retailer_id": row.get("product_retailer_id", row.get("product_id", "")),
        "product_brand": row.get("product_brand", ""),
        "impressions": p_int(row.get("impressions")),
        "spend": p_float(row.get("spend")),
        "link_clicks": link_clicks,
        "inline_link_click_ctr": p_float(row.get("inline_link_click_ctr")),
        "cvr": round(cvr, 4),
        "cpm": p_float(row.get("cpm")),
        "cost_per_inline_link_click": p_float(row.get("cost_per_inline_link_click")),
        "purchases": omni_purchase,
        "adds_to_cart": adds_to_cart,
        "catalog_purchases": catalog_purchases,
        "product_set_purchases": p_int(_get(row, "converted_promoted_product_omni_purchase")),
        "product_views": product_views,
    }


# ---------------------------------------------------------------------------
# Catalog verification
# ---------------------------------------------------------------------------

async def verify_catalog_update(
    catalog_id: str,
    access_token: str,
    update_fields: dict[str, list[str]],
) -> dict:
    """Verify that catalog products were updated by querying the Catalog API.

    For each field in *update_fields* we check how many products match the
    expected values.  Returns a dict with ``total_catalog_products`` and
    per-field ``matched`` counts.
    """
    base_url = f"https://graph.facebook.com/{FB_CATALOG_API_VERSION}/{catalog_id}/products"
    result: dict[str, Any] = {"total_catalog_products": 0, "fields": {}}

    async with httpx.AsyncClient(timeout=30) as client:
        # Total product count
        resp = await client.get(
            base_url,
            params={
                "access_token": access_token,
                "summary": "true",
                "limit": 0,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        result["total_catalog_products"] = (
            data.get("summary", {}).get("total_count", 0)
        )

        # Per-field verification.
        # FB Catalog filter syntax is {<field>: {<operator>: <value>}}.
        # Use "is_any" for multi-value or "eq" for single-value match.
        for field_name, expected_values in update_fields.items():
            field_result: dict[str, Any] = {"matched": 0, "expected_values": expected_values}
            try:
                if len(expected_values) == 1:
                    filter_obj = {field_name: {"eq": expected_values[0]}}
                else:
                    filter_obj = {field_name: {"is_any": expected_values}}

                filter_params = {
                    "access_token": access_token,
                    "summary": "true",
                    "limit": 0,
                    "filter": json.dumps(filter_obj),
                }
                field_resp = await client.get(base_url, params=filter_params)
                field_resp.raise_for_status()
                field_data = field_resp.json()
                field_result["matched"] = (
                    field_data.get("summary", {}).get("total_count", 0)
                )
                logger.info(
                    "Catalog verify %s=%s: matched %d / %d",
                    field_name, expected_values,
                    field_result["matched"], result["total_catalog_products"],
                )
            except Exception as exc:
                logger.warning(
                    "Catalog verification failed for field %s (filter=%s): %s",
                    field_name, json.dumps(filter_obj) if 'filter_obj' in locals() else "?",
                    exc,
                )
                field_result["error"] = str(exc)

            result["fields"][field_name] = field_result

    return result


# ---------------------------------------------------------------------------
# Main worker
# ---------------------------------------------------------------------------

async def run_report_worker(
    config: dict,
    db_update_job: Callable[..., Awaitable],
    db_update_report: Callable[..., Awaitable],
    db_create_history: Callable[..., Awaitable],
    db_update_history: Callable[..., Awaitable],
    db_get_schedule_run: Callable[..., Awaitable],
    db_update_schedule_run: Callable[..., Awaitable],
    db_get_job: Callable[..., Awaitable],
) -> dict:
    """Execute the full report pipeline for a single job.

    Parameters
    ----------
    config : dict
        A WorkerConfig dict containing job parameters (see module docstring).
    db_update_job, db_update_report, ... : async callables
        Database callback functions so the worker stays decoupled from
        SQLAlchemy / any specific ORM.

    Returns
    -------
    dict
        A WorkerResult dict with keys: success, jobId, reportId, totalItems,
        totalSpend, totalImpressions, durationMs, error.
    """

    job_id: int = config["jobId"]
    report_id: int = config["reportId"]
    user_id: int = config["userId"]
    ad_account_id: str = config["adAccountId"]
    access_token: str = config["accessToken"]
    date_start: str = config["dateStart"]
    date_end: str = config["dateEnd"]
    level: str = config.get("level", "account")
    breakdown: str = config.get("breakdown", "product_id")
    filters: Optional[list[dict]] = None  # Never pass filters to Facebook API; all filtering done in Python

    # Post-processing filter thresholds (applied in Python after CSV download)
    min_spend: Optional[float] = config.get("minSpend")
    min_ctr: Optional[float] = config.get("minCTR")
    max_spend: Optional[float] = config.get("maxSpend")
    max_cvr: Optional[float] = config.get("maxCVR")
    top_conversion_limit: Optional[int] = config.get("topConversionLimit")

    # Catalog update options
    update_to_catalog: bool = config.get("updateToCatalog", False)
    catalog_id: Optional[str] = config.get("catalogId")
    catalog_access_token: Optional[str] = config.get("catalogAccessToken")
    custom_label_4: Optional[str] = config.get("customLabel4")
    enable_custom_label_4: bool = config.get("enableCustomLabel4", False)
    custom_numbers: Optional[dict] = config.get("customNumbers")
    custom_labels: Optional[dict] = config.get("customLabels")
    schedule_run_id: Optional[int] = config.get("scheduleRunId")

    start_time = time.time()
    touch_heartbeat(job_id)

    # Initialise result scaffold
    result: dict[str, Any] = {
        "success": False,
        "jobId": job_id,
        "reportId": report_id,
        "totalItems": 0,
        "totalSpend": 0.0,
        "totalImpressions": 0,
        "durationMs": 0,
        "error": None,
    }

    try:
        # ---------------------------------------------------------------
        # Step 1 - Create report run (with retry)
        # ---------------------------------------------------------------
        report_run_id: Optional[str] = None
        current_filters = filters

        for attempt in range(MAX_REPORT_RETRIES + 1):
            try:
                logger.info(
                    "Creating report run (attempt %d/%d) for job %d",
                    attempt + 1,
                    MAX_REPORT_RETRIES + 1,
                    job_id,
                )

                # On retry, drop API-level filters to widen the net
                if attempt > 0 and current_filters:
                    logger.warning(
                        "Retry %d: dropping API-level filters for job %d",
                        attempt,
                        job_id,
                    )
                    current_filters = None

                report_run_id = await create_report_run(
                    ad_account_id=ad_account_id,
                    access_token=access_token,
                    date_start=date_start,
                    date_end=date_end,
                    level=level,
                    breakdown=breakdown,
                    filters=current_filters,
                )
                break  # success
            except Exception as exc:
                if attempt >= MAX_REPORT_RETRIES:
                    raise
                logger.warning(
                    "Report run creation failed (attempt %d): %s",
                    attempt + 1,
                    exc,
                )
                await asyncio.sleep(2 ** attempt)  # simple backoff

        if not report_run_id:
            raise RuntimeError("Failed to create report run after retries")

        report_run_id = str(report_run_id)
        logger.info("Report run ID: %s (type=%s) for job %d", report_run_id, type(report_run_id).__name__, job_id)

        await db_update_job(job_id, {"status": "running", "progress": 5, "statusMessage": "Report run created, polling..."})

        # ---------------------------------------------------------------
        # Step 2 - Poll for completion (progress 0-50%)
        # ---------------------------------------------------------------
        logger.info("Polling report %s for job %d", report_run_id, job_id)

        async def _on_poll_progress(pct: int) -> None:
            # Map polling progress (0-100) into overall 5-50%
            overall = 5 + int(pct * 0.45)
            await db_update_job(job_id, {"progress": overall})
            touch_heartbeat(job_id)

        poll_result = await poll_report_status(
            report_run_id=report_run_id,
            access_token=access_token,
            on_progress=_on_poll_progress,
        )

        await db_update_job(job_id, {"progress": 50})
        touch_heartbeat(job_id)

        # ---------------------------------------------------------------
        # Step 3 - Download CSV using async_report_url from poll result
        # ---------------------------------------------------------------
        logger.info("Downloading insights data for report %s", report_run_id)
        await db_update_job(job_id, {"statusMessage": "Downloading report data..."})

        raw_rows: list[dict] = []
        download_method = "csv"

        # Match the frontend path exactly (routes.py /facebook/insights):
        # bare httpx (no custom headers), lookaside-only, 4 attempts.
        # Adding browser-like headers triggered FB 400; the async_report_url
        # path is also dropped to keep behaviour identical to the working
        # frontend endpoint.
        download_url = (
            f"https://lookaside.facebook.com/ads/ads_insights/download_report/business/"
            f"?report_run_id={report_run_id}&access_token={access_token}"
        )

        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            csv_text = None
            for attempt in range(4):
                try:
                    logger.info(
                        "Downloading CSV (attempt %d/4) from %s for job %d...",
                        attempt + 1, download_url[:80], job_id,
                    )
                    touch_heartbeat(job_id)
                    resp = await client.get(download_url)
                    if resp.status_code == 200 and len(resp.text) > 100:
                        # FB returns an HTML login/error page when access_token
                        # is rejected. Treat as failure so JSON fallback runs.
                        content_type = resp.headers.get("content-type", "").lower()
                        text_head = resp.text.lstrip()[:200].lower()
                        if "text/html" in content_type or text_head.startswith("<"):
                            logger.warning(
                                "CSV endpoint returned HTML (likely auth error) for job %d. "
                                "First 200 chars: %s",
                                job_id, resp.text[:200],
                            )
                            await asyncio.sleep(2)
                            continue
                        csv_text = resp.text
                        logger.info("CSV downloaded: %d bytes for job %d", len(csv_text), job_id)
                        break
                    if resp.status_code == 500:
                        wait = 30 * (attempt + 1)
                        logger.warning(
                            "CSV download 500, waiting %ds (attempt %d/4). Body: %s",
                            wait, attempt + 1, resp.text[:300],
                        )
                        await asyncio.sleep(wait)
                    else:
                        logger.warning(
                            "CSV download status %d, size %d. Body: %s",
                            resp.status_code, len(resp.text), resp.text[:300],
                        )
                        await asyncio.sleep(5)
                except Exception as e:
                    logger.warning("CSV download error: %s", e)
                    await asyncio.sleep(5)

            if csv_text:
                # Log first 500 chars of CSV to debug
                logger.info("CSV preview for job %d: %s", job_id, csv_text[:500])
                reader = csv.DictReader(io.StringIO(csv_text))
                raw_rows = list(reader)
                logger.info("CSV parsed: %d rows for job %d", len(raw_rows), job_id)
                if raw_rows:
                    logger.info("CSV first row keys: %s", list(raw_rows[0].keys())[:10])
                    logger.info("CSV first row values: %s", {k: raw_rows[0][k] for k in list(raw_rows[0].keys())[:10]})
                await db_update_job(job_id, {"progress": 85, "statusMessage": f"Downloaded {len(raw_rows)} rows via CSV"})
            else:
                # Fallback to paginated JSON
                download_method = "json_fallback"
                logger.warning("CSV download failed for job %d, falling back to paginated JSON", job_id)

                async def _check_cancellation() -> bool:
                    try:
                        job = await db_get_job(job_id)
                        if job and getattr(job, "status", None) == "cancelled":
                            return True
                    except Exception:
                        pass
                    return False

                async def _on_fetch_progress(pct: int) -> None:
                    overall = 50 + int(pct * 0.40)
                    await db_update_job(job_id, {"progress": overall})
                    touch_heartbeat(job_id)

                async def _on_fetch_heartbeat(_msg: str) -> None:
                    touch_heartbeat(job_id)

                raw_rows = await fetch_insights_data(
                    report_run_id=report_run_id,
                    access_token=access_token,
                    on_progress=_on_fetch_progress,
                    on_heartbeat=_on_fetch_heartbeat,
                    check_cancelled=_check_cancellation,
                )

        logger.info("Data download complete: %d rows via %s for job %d", len(raw_rows), download_method, job_id)

        await db_update_job(job_id, {"progress": 90})
        touch_heartbeat(job_id)

        # ---------------------------------------------------------------
        # Step 4 - Map to ProductInsight
        # ---------------------------------------------------------------
        await db_update_job(job_id, {
            "progress": 90,
            "statusMessage": f"Mapping {len(raw_rows)} rows...",
        })
        insights = [map_row_to_product_insight(row) for row in raw_rows]
        logger.info("Mapped %d rows to product insights for job %d", len(insights), job_id)

        # ---------------------------------------------------------------
        # Step 5 - Post-processing filters (Python-side, not API-level)
        # ---------------------------------------------------------------
        raw_count = len(insights)

        if min_spend is not None:
            insights = [i for i in insights if i["spend"] >= min_spend]
        if min_ctr is not None:
            insights = [i for i in insights if i["inline_link_click_ctr"] >= min_ctr]
        if max_spend is not None:
            insights = [i for i in insights if i["spend"] <= max_spend]
        if max_cvr is not None:
            before = len(insights)
            insights = [i for i in insights if i["cvr"] < max_cvr]
            logger.info(
                "maxCVR filter (<%s): %d -> %d items",
                max_cvr,
                before,
                len(insights),
            )

        if len(insights) != raw_count:
            logger.info("Post-processing filters: %d -> %d items (minSpend=%s minCTR=%s maxSpend=%s maxCVR=%s)",
                         raw_count, len(insights), min_spend, min_ctr, max_spend, max_cvr)

        if top_conversion_limit is not None and top_conversion_limit > 0:
            insights.sort(
                key=lambda i: i["purchases"] + i["catalog_purchases"],
                reverse=True,
            )
            insights = insights[:top_conversion_limit]
            logger.info(
                "topConversionLimit: kept top %d items",
                top_conversion_limit,
            )

        # Aggregate totals
        total_items = len(insights)
        total_spend = round(sum(i["spend"] for i in insights), 2)
        total_impressions = sum(i["impressions"] for i in insights)

        await db_update_job(job_id, {
            "totalItems": total_items,
            "processedItems": total_items,
            "statusMessage": f"Filtered to {total_items:,} items (raw {raw_count:,})",
        })

        # ---------------------------------------------------------------
        # Step 6 - Store report data to local file
        # ---------------------------------------------------------------
        payload = json.dumps(insights, ensure_ascii=False)
        data_value = None

        try:
            from pathlib import Path
            backend_root = Path(__file__).resolve().parents[2]
            local_dir = backend_root / "reports" / str(user_id)
            local_dir.mkdir(parents=True, exist_ok=True)
            uid = _nanoid_generate(size=8)
            local_path = local_dir / f"{report_id}-{uid}.json"
            local_path.write_text(payload, encoding="utf-8")
            data_value = f"file://{local_path}"
            logger.info(
                "Stored report to local file: %s (%d bytes)",
                local_path, len(payload),
            )
        except Exception as fs_err:
            logger.warning(
                "Local file write failed: %s. Falling back to inline.",
                fs_err,
            )

        # Last-resort: inline. Will fail on TiDB if payload > 6 MB; only used
        # when local file write fails.
        if data_value is None:
            data_value = payload

        logger.info("Report data stored (%d items, %d bytes)", total_items, len(payload))

        # ---------------------------------------------------------------
        # Step 7 - Update saved_reports
        # ---------------------------------------------------------------
        await db_update_report(
            report_id,
            {
                "status": "completed",
                "data": data_value,
                "totalItems": total_items,
                "totalSpend": total_spend,
                "totalImpressions": total_impressions,
            },
        )

        # ---------------------------------------------------------------
        # Step 8 - Catalog update (optional)
        # ---------------------------------------------------------------
        catalog_verification: Optional[dict] = None

        if update_to_catalog and catalog_id:
            effective_token = catalog_access_token or access_token
            logger.info(
                "Updating catalog %s with %d products for job %d",
                catalog_id,
                total_items,
                job_id,
            )
            await db_update_job(job_id, {
                "statusMessage": f"Updating catalog {catalog_id} with {total_items:,} products...",
            })

            # Build batch update requests
            batch_requests: list[dict] = []
            update_fields_for_verify: dict[str, list[str]] = {}

            for insight in insights:
                retailer_id = insight.get("product_retailer_id")
                if not retailer_id:
                    continue

                update_data: dict[str, Any] = {}

                # Custom label 4
                if enable_custom_label_4 and custom_label_4:
                    update_data["custom_label_4"] = custom_label_4
                    update_fields_for_verify.setdefault("custom_label_4", [])
                    if custom_label_4 not in update_fields_for_verify["custom_label_4"]:
                        update_fields_for_verify["custom_label_4"].append(custom_label_4)

                # Custom numbers — FB expects float, not string
                if custom_numbers:
                    for key, value in custom_numbers.items():
                        if value is None or str(value).strip() == "":
                            continue
                        try:
                            num_value = float(value)
                        except (ValueError, TypeError):
                            logger.warning(
                                "Skipping custom_number %s=%r (not a valid number)",
                                key, value,
                            )
                            continue
                        update_data[key] = num_value
                        update_fields_for_verify.setdefault(key, [])
                        if num_value not in update_fields_for_verify[key]:
                            update_fields_for_verify[key].append(num_value)

                # Custom labels
                if custom_labels:
                    for key, value in custom_labels.items():
                        update_data[key] = value
                        update_fields_for_verify.setdefault(key, [])
                        if value not in update_fields_for_verify[key]:
                            update_fields_for_verify[key].append(value)

                if update_data:
                    batch_requests.append(
                        create_update_request(retailer_id, update_data)
                    )

            if batch_requests:
                await db_update_job(job_id, {
                    "statusMessage": f"Sending {len(batch_requests):,} catalog updates to Facebook...",
                })
                batch_result = await batch_update_products(
                    catalog_id=catalog_id,
                    access_token=effective_token,
                    requests=batch_requests,
                )
                num_handles = len(batch_result.get("handles", []))
                num_errors = len(batch_result.get("errors", []))
                logger.info(
                    "Sent %d catalog update requests for job %d — handles=%d errors=%d success=%s",
                    len(batch_requests), job_id, num_handles, num_errors,
                    batch_result.get("success"),
                )
                if num_errors:
                    for err in batch_result.get("errors", [])[:3]:
                        logger.warning("  Batch error: %s", err)

                # Estimate success: requests in batches that didn't fail.
                # batch_update_products splits into MAX_BATCH_SIZE chunks, so
                # each failed batch loses up to MAX_BATCH_SIZE requests.
                from ..facebook.catalog import MAX_BATCH_SIZE as CATALOG_MAX
                estimated_success = max(
                    0, len(batch_requests) - num_errors * CATALOG_MAX,
                )
                await db_update_job(job_id, {
                    "successCount": estimated_success,
                    "errorCount": num_errors * CATALOG_MAX if num_errors else 0,
                    "statusMessage": (
                        f"Catalog batch: {estimated_success:,} sent, "
                        f"{num_errors} batch(es) failed"
                    ) if num_errors else (
                        f"Catalog batch sent: {len(batch_requests):,} products"
                    ),
                })
            else:
                logger.warning(
                    "No catalog updates to send for job %d (insights=%d, custom_numbers=%s, custom_label_4=%s)",
                    job_id, len(insights), bool(custom_numbers), bool(custom_label_4),
                )
                await db_update_job(job_id, {
                    "statusMessage": (
                        f"No catalog updates queued (insights={len(insights):,}, "
                        f"check customNumbers/customLabel4 settings)"
                    ),
                })

            # Verify updates (runs whether batch was sent or skipped, as long
            # as we have fields we expected to update). FB items_batch is
            # async so wait briefly to let updates propagate before querying.
            if update_fields_for_verify:
                if batch_requests:
                    verify_delay = 15
                    await db_update_job(job_id, {
                        "statusMessage": f"Waiting {verify_delay}s for FB to process batch before verifying...",
                    })
                    await asyncio.sleep(verify_delay)
                try:
                    catalog_verification = await verify_catalog_update(
                        catalog_id=catalog_id,
                        access_token=effective_token,
                        update_fields=update_fields_for_verify,
                    )
                    logger.info(
                        "Catalog verification result for job %d: %s",
                        job_id,
                        json.dumps(catalog_verification),
                    )
                except Exception as verify_exc:
                    logger.warning(
                        "Catalog verification failed for job %d: %s",
                        job_id,
                        verify_exc,
                    )

        # ---------------------------------------------------------------
        # Step 9 - Mark job completed (progress 100%)
        # ---------------------------------------------------------------
        duration_ms = int((time.time() - start_time) * 1000)

        # Build a final status message that reflects what actually ran
        catalog_summary = ""
        if update_to_catalog and catalog_id:
            if catalog_verification:
                fields = catalog_verification.get("fields", {})
                if fields:
                    parts = [
                        f"{name}: {info.get('matched', 0)}/{catalog_verification.get('total_catalog_products', 0)}"
                        for name, info in fields.items()
                    ]
                    catalog_summary = f" | catalog verified: {', '.join(parts)}"
            else:
                catalog_summary = " | catalog: no verification"

        await db_update_job(
            job_id,
            {
                "status": "completed",
                "progress": 100,
                "completedAt": datetime.utcnow(),
                "totalItems": total_items,
                "processedItems": total_items,
                "statusMessage": (
                    f"Completed: {total_items:,} items, "
                    f"${total_spend:,.2f} spend, {total_impressions:,} impressions"
                    f"{catalog_summary}"
                ),
            },
        )

        # ---------------------------------------------------------------
        # Step 10 - Update schedule_run if applicable
        # ---------------------------------------------------------------
        if schedule_run_id:
            try:
                schedule_run = await db_get_schedule_run(schedule_run_id)
                if schedule_run:
                    completed_at = datetime.utcnow()
                    started_at = getattr(schedule_run, "startedAt", None)
                    run_duration_ms = (
                        int((completed_at - started_at).total_seconds() * 1000)
                        if started_at else duration_ms
                    )
                    catalog_items_updated = (
                        len(batch_requests)
                        if (update_to_catalog and catalog_id and 'batch_requests' in locals())
                        else 0
                    )
                    await db_update_schedule_run(
                        schedule_run_id,
                        {
                            "status": "completed",
                            "completedAt": completed_at,
                            "completedJobs": (schedule_run.completedJobs or 0) + 1,
                            "totalItems": (schedule_run.totalItems or 0) + total_items,
                            # totalSpend stored in cents
                            "totalSpend": (schedule_run.totalSpend or 0) + int(round(total_spend * 100)),
                            "totalImpressions": (schedule_run.totalImpressions or 0) + total_impressions,
                            "catalogItemsUpdated": (schedule_run.catalogItemsUpdated or 0) + catalog_items_updated,
                            "durationMs": run_duration_ms,
                        },
                    )

                    # Also flip the parent scheduled_job's lastRunStatus from
                    # "running" to "success" so the schedule list UI reflects
                    # reality.
                    sched_id = getattr(schedule_run, "scheduleId", None)
                    if sched_id:
                        try:
                            sf = get_session_factory()
                            async with sf() as s:
                                await s.execute(
                                    sql_update(ScheduledJob)
                                    .where(ScheduledJob.id == sched_id)
                                    .values(lastRunStatus="success")
                                )
                                await s.commit()
                        except Exception as sj_exc:
                            logger.warning(
                                "Failed to update scheduled_job %d lastRunStatus: %s",
                                sched_id, sj_exc,
                            )
            except Exception as sched_exc:
                logger.warning(
                    "Failed to update schedule run %d: %s",
                    schedule_run_id,
                    sched_exc,
                )

        # Build success result
        result.update(
            {
                "success": True,
                "totalItems": total_items,
                "totalSpend": total_spend,
                "totalImpressions": total_impressions,
                "durationMs": duration_ms,
            }
        )

        logger.info(
            "Job %d completed successfully in %dms (%d items, $%.2f spend)",
            job_id,
            duration_ms,
            total_items,
            total_spend,
        )
        return result

    except Exception as exc:
        duration_ms = int((time.time() - start_time) * 1000)
        error_message = str(exc)
        logger.error("Job %d failed after %dms: %s", job_id, duration_ms, error_message, exc_info=True)

        # Update saved_report as failed
        try:
            await db_update_report(
                report_id,
                {"status": "failed", "errorMessage": error_message},
            )
        except Exception as rpt_exc:
            logger.error(
                "Failed to update report %d on error: %s", report_id, rpt_exc
            )

        # If not cancelled, mark batch_job as failed
        is_cancelled = False
        try:
            job = await db_get_job(job_id)
            if job and getattr(job, "status", None) == "cancelled":
                is_cancelled = True
        except Exception:
            pass

        if not is_cancelled:
            try:
                await db_update_job(
                    job_id,
                    {
                        "status": "failed",
                        "progress": 0,
                        "statusMessage": error_message,
                        "completedAt": datetime.utcnow(),
                    },
                )
            except Exception as job_exc:
                logger.error(
                    "Failed to update job %d on error: %s", job_id, job_exc
                )

        # Update schedule run + parent scheduled_job on failure
        if schedule_run_id:
            try:
                await db_update_schedule_run(
                    schedule_run_id,
                    {
                        "status": "failed",
                        "completedAt": datetime.utcnow(),
                        "statusMessage": error_message,
                    },
                )
            except Exception:
                pass
            try:
                from sqlalchemy import select as sql_select
                sf = get_session_factory()
                async with sf() as s:
                    res = await s.execute(
                        sql_select(ScheduleRun.scheduleId)
                        .where(ScheduleRun.id == schedule_run_id)
                    )
                    sched_id = res.scalar()
                    if sched_id:
                        await s.execute(
                            sql_update(ScheduledJob)
                            .where(ScheduledJob.id == sched_id)
                            .values(lastRunStatus="failed")
                        )
                        await s.commit()
            except Exception as sj_exc:
                logger.warning(
                    "Failed to update scheduled_job lastRunStatus on failure: %s",
                    sj_exc,
                )

        result.update(
            {"durationMs": duration_ms, "error": error_message}
        )
        return result

    finally:
        # Clean up heartbeat
        worker_heartbeats.pop(job_id, None)
