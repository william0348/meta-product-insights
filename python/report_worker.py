#!/usr/bin/env python3
"""
Report Worker - Python backend for Facebook API data fetching and processing.

This script is spawned by the Node.js server as a child process.
It communicates progress back via database updates to the batch_jobs table.

Usage:
    python3 report_worker.py --config /path/to/job_config.json

The config JSON contains:
    - jobId: batch_jobs table ID
    - reportId: saved_reports table ID
    - userId: owner user ID
    - adAccountId: Facebook ad account ID
    - accessToken: Facebook access token
    - dateStart, dateEnd: date range
    - level, breakdown: report parameters
    - filters: optional API filters
    - updateToCatalog: boolean
    - catalogId, catalogAccessToken: for catalog updates
    - customLabel4, customNumbers: catalog update fields
    - scheduleRunId: optional schedule run tracking
    - databaseUrl: MySQL connection string
    - forgeApiUrl, forgeApiKey: S3 storage credentials
"""

import argparse
import asyncio
import json
import math
import os
import sys
import time
import traceback
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlparse, parse_qs

import aiohttp
import mysql.connector
import pandas as pd

# ─── Constants ───────────────────────────────────────────────────────────────

GRAPH_API_VERSION = "v22.0"
FB_CATALOG_API_VERSION = "v24.0"
PAGE_SIZE = 1000
MAX_PAGE_RETRIES = 3
MAX_REPORT_RETRIES = 2
POLL_INTERVAL = 5  # seconds
MAX_POLL_ATTEMPTS = 120  # 10 minutes max
CATALOG_BATCH_SIZE = 3000
CATALOG_CONCURRENCY = 5

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


# ─── Database Helper ─────────────────────────────────────────────────────────

class DBHelper:
    """Manages MySQL connection and batch_jobs updates."""

    def __init__(self, database_url: str):
        parsed = urlparse(database_url)
        self.config = {
            "host": parsed.hostname,
            "port": parsed.port or 3306,
            "user": parsed.username,
            "password": parsed.password,
            "database": parsed.path.lstrip("/"),
            "ssl_disabled": False,
        }
        self.conn = None

    def connect(self):
        self.conn = mysql.connector.connect(**self.config)

    def close(self):
        if self.conn and self.conn.is_connected():
            self.conn.close()

    def _ensure_connected(self):
        if not self.conn or not self.conn.is_connected():
            self.connect()

    def update_job(self, job_id: int, **kwargs):
        """Update batch_jobs row with given fields."""
        self._ensure_connected()
        set_parts = []
        values = []
        for key, val in kwargs.items():
            col = self._camel_to_snake(key)
            set_parts.append(f"`{col}` = %s")
            values.append(val)
        values.append(job_id)
        sql = f"UPDATE `batch_jobs` SET {', '.join(set_parts)} WHERE `id` = %s"
        cursor = self.conn.cursor()
        cursor.execute(sql, values)
        self.conn.commit()
        cursor.close()

    def update_saved_report(self, report_id: int, **kwargs):
        """Update saved_reports row with given fields."""
        self._ensure_connected()
        set_parts = []
        values = []
        for key, val in kwargs.items():
            col = self._camel_to_snake(key)
            set_parts.append(f"`{col}` = %s")
            values.append(val)
        values.append(report_id)
        sql = f"UPDATE `saved_reports` SET {', '.join(set_parts)} WHERE `id` = %s"
        cursor = self.conn.cursor()
        cursor.execute(sql, values)
        self.conn.commit()
        cursor.close()

    def insert_batch_history(self, data: dict) -> Optional[int]:
        """Insert a batch_history record and return its ID."""
        self._ensure_connected()
        cols = []
        placeholders = []
        values = []
        for key, val in data.items():
            cols.append(f"`{self._camel_to_snake(key)}`")
            placeholders.append("%s")
            if isinstance(val, (dict, list)):
                values.append(json.dumps(val))
            else:
                values.append(val)
        sql = f"INSERT INTO `batch_history` ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
        cursor = self.conn.cursor()
        cursor.execute(sql, values)
        self.conn.commit()
        last_id = cursor.lastrowid
        cursor.close()
        return last_id

    def update_batch_history(self, history_id: int, **kwargs):
        """Update batch_history row."""
        self._ensure_connected()
        set_parts = []
        values = []
        for key, val in kwargs.items():
            col = self._camel_to_snake(key)
            if isinstance(val, (dict, list)):
                val = json.dumps(val)
            set_parts.append(f"`{col}` = %s")
            values.append(val)
        values.append(history_id)
        sql = f"UPDATE `batch_history` SET {', '.join(set_parts)} WHERE `id` = %s"
        cursor = self.conn.cursor()
        cursor.execute(sql, values)
        self.conn.commit()
        cursor.close()

    def get_schedule_run(self, run_id: int) -> Optional[dict]:
        """Get a schedule_runs row."""
        self._ensure_connected()
        cursor = self.conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM `schedule_runs` WHERE `id` = %s", (run_id,))
        row = cursor.fetchone()
        cursor.close()
        return row

    def update_schedule_run(self, run_id: int, **kwargs):
        """Update schedule_runs row."""
        self._ensure_connected()
        set_parts = []
        values = []
        for key, val in kwargs.items():
            col = self._camel_to_snake(key)
            set_parts.append(f"`{col}` = %s")
            values.append(val)
        values.append(run_id)
        sql = f"UPDATE `schedule_runs` SET {', '.join(set_parts)} WHERE `id` = %s"
        cursor = self.conn.cursor()
        cursor.execute(sql, values)
        self.conn.commit()
        cursor.close()

    @staticmethod
    def _camel_to_snake(name: str) -> str:
        """Convert camelCase to snake_case for DB column names."""
        import re
        s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
        return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


# ─── S3 Storage Helper ───────────────────────────────────────────────────────

async def storage_put(
    session: aiohttp.ClientSession,
    forge_api_url: str,
    forge_api_key: str,
    rel_key: str,
    data: bytes,
    content_type: str = "application/json",
) -> str:
    """Upload data to S3 via Manus storage proxy. Returns the public URL."""
    base_url = forge_api_url.rstrip("/")
    upload_url = f"{base_url}/v1/storage/upload?path={rel_key}"

    form = aiohttp.FormData()
    form.add_field(
        "file",
        data,
        filename=rel_key.split("/")[-1],
        content_type=content_type,
    )

    async with session.post(
        upload_url,
        data=form,
        headers={"Authorization": f"Bearer {forge_api_key}"},
        timeout=aiohttp.ClientTimeout(total=120),
    ) as resp:
        if resp.status != 200:
            body = await resp.text()
            raise RuntimeError(f"S3 upload failed ({resp.status}): {body}")
        result = await resp.json()
        return result["url"]


# ─── Facebook API Helpers ────────────────────────────────────────────────────

async def create_report_run(
    session: aiohttp.ClientSession,
    ad_account_id: str,
    date_start: str,
    date_end: str,
    access_token: str,
    level: str = "account",
    breakdown: str = "product_id",
    filters: Optional[list] = None,
) -> str:
    """Create a Facebook async report run. Returns report_run_id."""
    formatted_id = ad_account_id if ad_account_id.startswith("act_") else f"act_{ad_account_id}"

    params = {
        "access_token": access_token,
        "level": level,
        "fields": json.dumps(FIELD_LIST),
        "time_range": json.dumps({"since": date_start, "until": date_end}),
        "action_breakdowns": json.dumps(["action_type"]),
        "breakdowns": json.dumps([breakdown]),
        "time_increment": "all_days",
    }
    if filters:
        params["filtering"] = json.dumps(filters)

    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{formatted_id}/insights"

    async with session.post(url, params=params, timeout=aiohttp.ClientTimeout(total=60)) as resp:
        data = await resp.json()
        if "error" in data:
            err_msg = data["error"].get("error_user_msg") or data["error"].get("message", "Unknown")
            code = data["error"].get("code", "?")
            raise RuntimeError(f"{err_msg} (Code: {code})")
        return data["report_run_id"]


async def poll_report_status(
    session: aiohttp.ClientSession,
    report_run_id: str,
    access_token: str,
    on_progress=None,
) -> dict:
    """Poll until the report is complete. Returns {'success': bool, 'failure_reason': str?}."""
    for attempt in range(MAX_POLL_ATTEMPTS):
        url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{report_run_id}"
        params = {"access_token": access_token}

        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            data = await resp.json()

        if "error" in data:
            raise RuntimeError(data["error"].get("message", "Poll error"))

        status = data.get("async_status", "")
        percent = data.get("async_percent_completion", 0)

        if on_progress:
            await on_progress(percent)

        if status == "Job Completed":
            return {"success": True}
        elif status in ("Job Failed", "Job Skipped"):
            return {"success": False, "failure_reason": status}

        await asyncio.sleep(POLL_INTERVAL)

    raise RuntimeError("Report generation timed out (polling exceeded max attempts)")


async def fetch_insights_data(
    session: aiohttp.ClientSession,
    report_run_id: str,
    access_token: str,
    on_progress=None,
) -> list[dict]:
    """Fetch all paginated insights data. Returns list of raw row dicts."""
    all_data = []
    after = None
    page_count = 0

    while True:
        url = (
            f"https://graph.facebook.com/{GRAPH_API_VERSION}/{report_run_id}/insights"
            f"?access_token={access_token}&limit={PAGE_SIZE}"
        )
        if after:
            url += f"&after={after}"

        # Retry logic per page
        response_data = None
        for retry in range(MAX_PAGE_RETRIES + 1):
            try:
                async with session.get(
                    url, timeout=aiohttp.ClientTimeout(total=60)
                ) as resp:
                    response_data = await resp.json()
                break
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                if retry < MAX_PAGE_RETRIES:
                    delay = (2 ** retry) * 2
                    print(
                        f"[Python] Page {page_count + 1} fetch failed ({type(e).__name__}), "
                        f"retrying in {delay}s... ({retry + 1}/{MAX_PAGE_RETRIES})",
                        flush=True,
                    )
                    await asyncio.sleep(delay)
                else:
                    raise

        if response_data is None:
            raise RuntimeError("Failed to fetch insights page after retries")

        if "error" in response_data:
            raise RuntimeError(
                response_data["error"].get("message", "Failed to fetch insights")
            )

        rows = response_data.get("data", [])
        all_data.extend(rows)

        page_count += 1
        print(
            f"[Python] Page {page_count}: {len(rows)} records (total: {len(all_data)})",
            flush=True,
        )

        if on_progress:
            await on_progress(len(all_data))

        # Check for next page
        paging = response_data.get("paging", {})
        if paging.get("next") and paging.get("cursors", {}).get("after"):
            after = paging["cursors"]["after"]
        else:
            break

    return all_data


# ─── Data Mapping ────────────────────────────────────────────────────────────

def map_row_to_product_insight(row: dict) -> dict:
    """Map a raw Facebook API row to our ProductInsight structure."""
    def p_float(val):
        if not val:
            return 0.0
        try:
            return float(str(val).replace("$", "").replace(",", ""))
        except (ValueError, TypeError):
            return 0.0

    def p_int(val):
        if not val:
            return 0
        try:
            return int(float(str(val).replace(",", "")))
        except (ValueError, TypeError):
            return 0

    # Extract omni_purchase from actions array
    ad_purchases = 0
    actions = row.get("actions")
    if isinstance(actions, list):
        for a in actions:
            if a.get("action_type") == "omni_purchase":
                ad_purchases = p_int(a.get("value"))
                break

    link_clicks = p_int(row.get("inline_link_clicks"))
    catalog_purchases = p_int(row.get("converted_product_omni_purchase"))

    # CVR = Catalog Purchases / Link Clicks * 100
    cvr = (catalog_purchases / link_clicks * 100) if link_clicks > 0 else 0.0

    return {
        "product_name": row.get("product_name") or row.get("product_retailer_id") or "N/A",
        "product_retailer_id": row.get("product_retailer_id") or row.get("product_content_id") or "N/A",
        "product_brand": row.get("product_brand"),
        "impressions": p_int(row.get("impressions")),
        "spend": p_float(row.get("spend")),
        "link_clicks": link_clicks,
        "inline_link_click_ctr": p_float(row.get("inline_link_click_ctr")),
        "cvr": round(cvr, 6),
        "cpm": p_float(row.get("cpm")),
        "cost_per_inline_link_click": p_float(row.get("cost_per_inline_link_click")),
        "purchases": ad_purchases,
        "adds_to_cart": 0,
        "catalog_purchases": catalog_purchases,
        "product_set_purchases": p_int(row.get("converted_promoted_product_omni_purchase")),
        "product_views": p_int(row.get("product_views")),
    }


# ─── Catalog Batch Update ───────────────────────────────────────────────────

async def batch_update_catalog(
    session: aiohttp.ClientSession,
    catalog_id: str,
    catalog_access_token: str,
    retailer_ids: list[str],
    update_data: dict,
) -> dict:
    """Batch update products in a Facebook catalog. Returns {success, errors, handles}."""
    total_success = 0
    total_errors = 0
    all_handles = []

    # Build requests
    requests_list = []
    for rid in retailer_ids:
        item = {"method": "UPDATE", "data": {"id": rid, **update_data}}
        requests_list.append(item)

    # Split into batches
    batches = [
        requests_list[i : i + CATALOG_BATCH_SIZE]
        for i in range(0, len(requests_list), CATALOG_BATCH_SIZE)
    ]

    url = f"https://graph.facebook.com/{FB_CATALOG_API_VERSION}/{catalog_id}/items_batch"

    # Process batches with concurrency control
    semaphore = asyncio.Semaphore(CATALOG_CONCURRENCY)

    async def process_batch(batch):
        nonlocal total_success, total_errors
        async with semaphore:
            payload = {
                "access_token": catalog_access_token,
                "item_type": "PRODUCT_ITEM",
                "requests": json.dumps(batch),
            }
            try:
                async with session.post(
                    url, data=payload, timeout=aiohttp.ClientTimeout(total=120)
                ) as resp:
                    result = await resp.json()
                    if "error" in result:
                        total_errors += len(batch)
                        print(f"[Python] Catalog batch error: {result['error'].get('message', 'Unknown')}", flush=True)
                    else:
                        handles = result.get("handles", [])
                        all_handles.extend(handles)
                        total_success += len(batch)
            except Exception as e:
                total_errors += len(batch)
                print(f"[Python] Catalog batch exception: {e}", flush=True)

    await asyncio.gather(*[process_batch(b) for b in batches])

    return {"success": total_success, "errors": total_errors, "handles": all_handles}


# ─── Main Worker ─────────────────────────────────────────────────────────────

async def run_worker(config: dict):
    """Main entry point for the report worker."""
    start_time = time.time()

    job_id = config["jobId"]
    report_id = config["reportId"]
    user_id = config["userId"]
    ad_account_id = config["adAccountId"]
    access_token = config["accessToken"]
    date_start = config["dateStart"]
    date_end = config["dateEnd"]
    level = config.get("level", "account")
    breakdown = config.get("breakdown", "product_id")
    filters = config.get("filters")
    database_url = config["databaseUrl"]
    forge_api_url = config["forgeApiUrl"]
    forge_api_key = config["forgeApiKey"]

    db = DBHelper(database_url)
    db.connect()

    try:
        async with aiohttp.ClientSession() as session:
            # ── Step 1: Create report run (with retry) ──
            report_run_id = None
            used_filters = filters
            last_failure = ""

            for attempt in range(MAX_REPORT_RETRIES + 1):
                if attempt > 0:
                    print(f"[Python] Retry attempt {attempt}/{MAX_REPORT_RETRIES} (prev: {last_failure})", flush=True)
                    db.update_job(job_id, statusMessage=f"Retrying report generation (attempt {attempt + 1})...")
                    if attempt == 1 and used_filters:
                        print("[Python] Retry without API-level filters", flush=True)
                        used_filters = None
                    await asyncio.sleep(5)

                print(f"[Python] Creating report run for {ad_account_id}... (attempt {attempt + 1})", flush=True)
                report_run_id = await create_report_run(
                    session, ad_account_id, date_start, date_end,
                    access_token, level, breakdown, used_filters,
                )
                print(f"[Python] Report run created: {report_run_id}", flush=True)

                # ── Step 2: Poll for completion ──
                db.update_job(job_id, statusMessage="Waiting for report generation...")

                async def on_poll_progress(percent):
                    progress = int(percent * 0.5)  # 0-50%
                    db.update_job(
                        job_id,
                        progress=progress,
                        statusMessage=f"Generating report: {percent}%",
                    )

                poll_result = await poll_report_status(
                    session, report_run_id, access_token, on_poll_progress,
                )

                if poll_result["success"]:
                    break
                else:
                    last_failure = poll_result.get("failure_reason", "Unknown")
                    print(f"[Python] Facebook async job failed (attempt {attempt + 1}): {last_failure}", flush=True)
                    if attempt == MAX_REPORT_RETRIES:
                        raise RuntimeError(
                            f"Report generation failed after {MAX_REPORT_RETRIES + 1} attempts. "
                            f"Last status: {last_failure}"
                        )

            if filters and not used_filters:
                print("[Python] Note: API-level filters removed during retry. Data is unfiltered.", flush=True)

            # ── Step 3: Fetch all data ──
            db.update_job(job_id, progress=50, statusMessage="Fetching report data...")

            estimated_total = 80000

            async def on_fetch_progress(loaded):
                fetch_pct = min(int((loaded / estimated_total) * 40), 40)
                total_pct = 50 + fetch_pct  # 50-90%
                db.update_job(
                    job_id,
                    progress=total_pct,
                    processedItems=loaded,
                    statusMessage=f"Fetched {loaded:,} records...",
                )

            raw_data = await fetch_insights_data(
                session, report_run_id, access_token, on_fetch_progress,
            )

            # ── Step 4: Map data using pandas ──
            print(f"[Python] Mapping {len(raw_data)} rows...", flush=True)
            mapped_data = [map_row_to_product_insight(row) for row in raw_data]

            # Use pandas for statistics
            df = pd.DataFrame(mapped_data)
            total_spend = float(df["spend"].sum()) if len(df) > 0 else 0.0
            total_impressions = int(df["impressions"].sum()) if len(df) > 0 else 0

            # ── Step 5: Upload to S3 ──
            json_data = json.dumps(mapped_data, ensure_ascii=False)
            size_mb = len(json_data.encode("utf-8")) / 1024 / 1024
            print(f"[Python] Uploading {len(mapped_data)} records ({size_mb:.1f}MB) to S3...", flush=True)

            import secrets
            s3_key = f"reports/{user_id}/{report_id}-{secrets.token_urlsafe(6)}.json"
            s3_url = await storage_put(
                session, forge_api_url, forge_api_key,
                s3_key, json_data.encode("utf-8"), "application/json",
            )
            print(f"[Python] Report data uploaded to S3: {s3_key}", flush=True)

            # Update saved_reports
            duration_ms = int((time.time() - start_time) * 1000)
            db.update_saved_report(
                report_id,
                data=s3_url,
                totalItems=len(mapped_data),
                totalSpend=round(total_spend * 100),  # cents
                totalImpressions=total_impressions,
                status="completed",
                generatedAt=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                durationMs=duration_ms,
            )

            # ── Step 6: Catalog update (if requested) ──
            update_to_catalog = config.get("updateToCatalog", False)
            catalog_id = config.get("catalogId")
            catalog_access_token = config.get("catalogAccessToken")

            if update_to_catalog and catalog_id and catalog_access_token:
                print(f"[Python] Combined workflow: Updating catalog with {len(mapped_data)} products...", flush=True)
                db.update_job(job_id, progress=91, statusMessage=f"Updating catalog with {len(mapped_data)} products...")

                retailer_ids = [
                    item["product_retailer_id"]
                    for item in mapped_data
                    if item["product_retailer_id"] and item["product_retailer_id"] != "N/A"
                ]

                if retailer_ids:
                    # Build update data
                    update_fields = {}
                    custom_label_4 = config.get("customLabel4")
                    if custom_label_4:
                        update_fields["custom_label_4"] = custom_label_4

                    custom_numbers = config.get("customNumbers", {})
                    for key, value in custom_numbers.items():
                        if value and str(value).strip():
                            update_fields[key] = float(value)

                    # Create batch history record
                    updated_field_names = list(update_fields.keys())
                    history_id = db.insert_batch_history({
                        "userId": user_id,
                        "catalogId": catalog_id,
                        "operationType": "UPDATE",
                        "totalItems": len(retailer_ids),
                        "batchCount": math.ceil(len(retailer_ids) / CATALOG_BATCH_SIZE),
                        "updatedFields": updated_field_names,
                        "updateCriteria": {
                            "sourceField": "scheduled_report",
                            "targetField": "custom_label_4, custom_number_0-4",
                            "condition": f"reportId={report_id}",
                            "description": (
                                f"Scheduled report update: customLabel4={custom_label_4 or 'N/A'}, "
                                f"customNumbers={json.dumps(custom_numbers)}"
                            ),
                        },
                        "status": "processing",
                    })

                    try:
                        result = await batch_update_catalog(
                            session, catalog_id, catalog_access_token,
                            retailer_ids, update_fields,
                        )

                        if history_id:
                            db.update_batch_history(
                                history_id,
                                status="failed" if result["errors"] > 0 else "completed",
                                handles=result["handles"],
                                successCount=result["success"],
                                errorCount=result["errors"],
                                durationMs=int((time.time() - start_time) * 1000),
                            )

                        print(
                            f"[Python] Catalog update completed: {result['success']} success, "
                            f"{result['errors']} errors",
                            flush=True,
                        )
                        db.update_job(
                            job_id, progress=95,
                            statusMessage=f"Catalog updated: {result['success']} products",
                        )
                    except Exception as cat_err:
                        print(f"[Python] Catalog update failed: {cat_err}", flush=True)
                        db.update_job(
                            job_id,
                            statusMessage=f"Report completed, but catalog update failed: {str(cat_err)[:200]}",
                        )

            # ── Step 7: Mark job completed ──
            final_duration_ms = int((time.time() - start_time) * 1000)
            status_msg = (
                f"Report + Catalog update completed: {len(mapped_data)} products"
                if update_to_catalog
                else f"Report completed: {len(mapped_data)} products"
            )

            db.update_job(
                job_id,
                status="completed",
                progress=100,
                processedItems=len(mapped_data),
                totalItems=len(mapped_data),
                successCount=len(mapped_data),
                completedAt=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                statusMessage=status_msg,
            )

            print(f"[Python] Job {job_id} completed: {len(mapped_data)} products in {final_duration_ms}ms", flush=True)

            # ── Step 8: Update schedule run if applicable ──
            schedule_run_id = config.get("scheduleRunId")
            if schedule_run_id:
                try:
                    run = db.get_schedule_run(schedule_run_id)
                    if run:
                        new_completed = (run.get("completed_jobs") or 0) + 1
                        total_done = new_completed + (run.get("failed_jobs") or 0)
                        all_done = total_done >= (run.get("total_jobs") or 1)

                        run_status = "running"
                        if all_done:
                            run_status = "completed" if (run.get("failed_jobs") or 0) == 0 else "partial"

                        update_kwargs = {
                            "completedJobs": new_completed,
                            "totalItems": (run.get("total_items") or 0) + len(mapped_data),
                            "totalSpend": (run.get("total_spend") or 0) + round(total_spend * 100),
                            "totalImpressions": (run.get("total_impressions") or 0) + total_impressions,
                            "status": run_status,
                        }
                        if all_done:
                            update_kwargs["completedAt"] = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                            started = run.get("started_at")
                            if started:
                                update_kwargs["durationMs"] = int((time.time() - started.timestamp()) * 1000)

                        db.update_schedule_run(schedule_run_id, **update_kwargs)
                        print(f"[Python] Updated schedule run {schedule_run_id}: {run_status}", flush=True)
                except Exception as run_err:
                    print(f"[Python] Failed to update schedule run: {run_err}", flush=True)

            # Output result summary as JSON for Node.js to parse
            result = {
                "success": True,
                "jobId": job_id,
                "reportId": report_id,
                "totalItems": len(mapped_data),
                "totalSpend": total_spend,
                "totalImpressions": total_impressions,
                "durationMs": final_duration_ms,
                "s3Url": s3_url,
            }
            print(f"__RESULT__{json.dumps(result)}__END_RESULT__", flush=True)

    except Exception as e:
        error_msg = str(e)[:500]
        print(f"[Python] Job {job_id} failed: {error_msg}", flush=True)
        traceback.print_exc()

        # Update saved report as failed
        try:
            db.update_saved_report(report_id, status="failed", errorMessage=error_msg)
        except Exception:
            pass

        # Output error for Node.js
        result = {"success": False, "jobId": job_id, "error": error_msg}
        print(f"__RESULT__{json.dumps(result)}__END_RESULT__", flush=True)

        # Re-raise so the process exits with non-zero code
        raise

    finally:
        db.close()


# ─── Entry Point ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Report Worker")
    parser.add_argument("--config", required=True, help="Path to job config JSON file")
    args = parser.parse_args()

    with open(args.config, "r") as f:
        config = json.load(f)

    asyncio.run(run_worker(config))


if __name__ == "__main__":
    main()
