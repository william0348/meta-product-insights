"""
Report Worker - orchestrates the full Facebook Ads Insights report pipeline.

Python port of report-worker.ts. Handles:
- Creating and polling async report runs
- Fetching paginated insights data
- Post-processing filters (maxCVR, topConversionLimit)
- Uploading results to GCS
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

from ..facebook.insights import (
    create_report_run,
    poll_report_status,
    fetch_insights_data,
)
from ..facebook.catalog import batch_update_products, create_update_request
from ..storage.gcs import storage_put

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

        # Per-field verification
        for field_name, expected_values in update_fields.items():
            field_result: dict[str, Any] = {"matched": 0, "expected_values": expected_values}
            try:
                filter_params = {
                    "access_token": access_token,
                    "summary": "true",
                    "limit": 0,
                    "filter": json.dumps(
                        {"field": field_name, "operator": "IN", "values": expected_values}
                    ),
                }
                field_resp = await client.get(base_url, params=filter_params)
                field_resp.raise_for_status()
                field_data = field_resp.json()
                field_result["matched"] = (
                    field_data.get("summary", {}).get("total_count", 0)
                )
            except Exception as exc:
                logger.warning(
                    "Catalog verification failed for field %s: %s",
                    field_name,
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
        totalSpend, totalImpressions, durationMs, s3Url, error.
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
        "s3Url": None,
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

        # Same URLs as frontend routes.py fetchAll — export_report first, lookaside as fallback
        csv_urls = [
            f"https://www.facebook.com/ads/ads_insights/export_report?report_run_id={report_run_id}&format=csv&access_token={access_token}",
            f"https://lookaside.facebook.com/ads/ads_insights/download_report/business/?report_run_id={report_run_id}&access_token={access_token}",
        ]

        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            csv_text = None
            for url in csv_urls:
                for attempt in range(3):
                    try:
                        logger.info("Downloading CSV (attempt %d/3) from %s for job %d...", attempt + 1, url[:80], job_id)
                        touch_heartbeat(job_id)
                        resp = await client.get(url)
                        if resp.status_code == 200 and len(resp.text) > 100:
                            csv_text = resp.text
                            logger.info("CSV downloaded: %d bytes for job %d", len(csv_text), job_id)
                            break
                        elif resp.status_code == 500:
                            wait = 10 * (attempt + 1)
                            logger.warning("CSV download 500, waiting %ds (attempt %d/3)", wait, attempt + 1)
                            await asyncio.sleep(wait)
                        else:
                            logger.warning("CSV download status %d, size %d", resp.status_code, len(resp.text))
                            await asyncio.sleep(5)
                    except Exception as e:
                        logger.warning("CSV download error: %s", e)
                        await asyncio.sleep(5)
                if csv_text:
                    break

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

                raw_rows = await fetch_insights_data(
                    report_run_id=report_run_id,
                    access_token=access_token,
                    on_progress=_on_fetch_progress,
                    heartbeat_callback=lambda: touch_heartbeat(job_id),
                    cancellation_check=_check_cancellation,
                )

        logger.info("Data download complete: %d rows via %s for job %d", len(raw_rows), download_method, job_id)

        await db_update_job(job_id, {"progress": 90})
        touch_heartbeat(job_id)

        # ---------------------------------------------------------------
        # Step 4 - Map to ProductInsight
        # ---------------------------------------------------------------
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

        # ---------------------------------------------------------------
        # Step 6 - Store report data (inline JSON or GCS)
        # ---------------------------------------------------------------
        payload = json.dumps(insights, ensure_ascii=False)
        s3_url = None

        from ..config import settings as app_settings
        if app_settings.gcs_bucket:
            try:
                uid = _nanoid_generate(size=8)
                gcs_key = f"reports/{user_id}/{report_id}-{uid}.json"
                result = await storage_put(gcs_key, payload)
                s3_url = result.get("url", gcs_key)
                logger.info("Uploaded report to GCS: %s", gcs_key)
            except Exception as gcs_err:
                logger.warning("GCS upload failed, storing inline: %s", gcs_err)
                s3_url = None

        data_value = s3_url if s3_url else payload

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

                # Custom numbers
                if custom_numbers:
                    for key, value in custom_numbers.items():
                        update_data[key] = value

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
                await batch_update_products(
                    catalog_id=catalog_id,
                    access_token=effective_token,
                    requests=batch_requests,
                )
                logger.info(
                    "Sent %d catalog update requests for job %d",
                    len(batch_requests),
                    job_id,
                )

                # Verify updates
                if update_fields_for_verify:
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

        await db_update_job(
            job_id,
            {
                "status": "completed",
                "progress": 100,
                "completedAt": datetime.utcnow(),
            },
        )

        # Create history record
        history_data: dict[str, Any] = {
            "jobId": job_id,
            "reportId": report_id,
            "status": "completed",
            "totalItems": total_items,
            "totalSpend": total_spend,
            "totalImpressions": total_impressions,
            "durationMs": duration_ms,
            "s3Url": s3_url,
        }
        if catalog_verification:
            history_data["catalogVerification"] = catalog_verification

        await db_create_history(history_data)

        # ---------------------------------------------------------------
        # Step 10 - Update schedule_run if applicable
        # ---------------------------------------------------------------
        if schedule_run_id:
            try:
                schedule_run = await db_get_schedule_run(schedule_run_id)
                if schedule_run:
                    await db_update_schedule_run(
                        schedule_run_id,
                        {
                            "status": "completed",
                            "completedAt": datetime.utcnow(),
                            "reportId": report_id,
                            "totalItems": total_items,
                        },
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
                "s3Url": s3_url,
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

        # Update schedule run on failure
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

        result.update(
            {"durationMs": duration_ms, "error": error_message}
        )
        return result

    finally:
        # Clean up heartbeat
        worker_heartbeats.pop(job_id, None)
