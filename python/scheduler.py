#!/usr/bin/env python3
"""
Standalone scheduler for Meta Product Insights.
Runs as a background daemon, polls DB for due scheduled jobs, and executes them.

Usage:
    python3 scheduler.py                    # Run scheduler daemon
    python3 scheduler.py --run-now <id>     # Run a specific schedule immediately
    python3 scheduler.py --list             # List all schedules

Requires DATABASE_URL in environment or .env file.
"""

import argparse
import asyncio
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timedelta
from typing import Optional

import aiohttp
import mysql.connector

from config import get_config
from error_classifier import classify_error, calculate_retry_delay
from report_worker import (
    create_report_run,
    poll_report_status,
    fetch_insights_data,
    map_row_to_product_insight,
    batch_update_catalog,
    verify_catalog_update,
    storage_put,
    DBHelper,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("scheduler")

# ─── Constants ───────────────────────────────────────────────────────────────

SCHEDULER_INTERVAL_SEC = 60  # Check for due jobs every 60 seconds
MAX_RETRIES = 3
CATALOG_BATCH_SIZE = 3000


# ─── Date Range Calculation ──────────────────────────────────────────────────

def calculate_date_range(date_range_type: str) -> tuple[str, str]:
    """Calculate date range based on preset type."""
    now = datetime.now()
    date_end = now - timedelta(days=1)  # Yesterday

    if date_range_type == "last_7_days":
        date_start = now - timedelta(days=7)
    elif date_range_type == "last_14_days":
        date_start = now - timedelta(days=14)
    elif date_range_type == "last_30_days":
        date_start = now - timedelta(days=30)
    elif date_range_type == "last_week":
        # Last complete week (Mon-Sun)
        days_since_monday = now.weekday()
        last_monday = now - timedelta(days=days_since_monday + 7)
        date_start = last_monday
        date_end = last_monday + timedelta(days=6)
    elif date_range_type == "last_month":
        first_of_month = now.replace(day=1)
        date_end = first_of_month - timedelta(days=1)
        date_start = date_end.replace(day=1)
    else:
        date_start = now - timedelta(days=7)

    return date_start.strftime("%Y-%m-%d"), date_end.strftime("%Y-%m-%d")


def build_api_filters(config: dict) -> list:
    """Build Facebook API filtering params from config."""
    filters = []
    if config.get("minSpend"):
        filters.append({
            "field": "spend",
            "operator": "GREATER_THAN",
            "value": float(config["minSpend"]),
        })
    if config.get("minCTR"):
        filters.append({
            "field": "inline_link_click_ctr",
            "operator": "GREATER_THAN",
            "value": float(config["minCTR"]),
        })
    if config.get("maxSpend"):
        filters.append({
            "field": "spend",
            "operator": "LESS_THAN",
            "value": float(config["maxSpend"]),
        })
    return filters


# ─── Cron Parsing ────────────────────────────────────────────────────────────

def parse_cron_next_run(cron_expr: str, timezone: str = "Asia/Taipei") -> Optional[datetime]:
    """Parse 6-field cron expression and calculate next run time.
    Format: second minute hour dayOfMonth month dayOfWeek
    Only supports single values (no ranges/lists).
    """
    parts = cron_expr.strip().split()
    if len(parts) != 6:
        log.warning(f"Invalid cron expression: {cron_expr}")
        return None

    _, minute, hour, dom, month, dow = parts
    now = datetime.now()

    try:
        target_hour = int(hour)
        target_minute = int(minute)
    except ValueError:
        return None

    # Weekly schedule (specific day of week)
    if dow != "*" and dom == "*":
        target_dow = int(dow) % 7  # 0=Sun in cron, 0=Mon in Python
        # Convert cron dow (0=Sun) to Python weekday (0=Mon)
        python_dow = (target_dow - 1) % 7
        days_ahead = python_dow - now.weekday()
        if days_ahead < 0 or (days_ahead == 0 and
            (now.hour > target_hour or
             (now.hour == target_hour and now.minute >= target_minute))):
            days_ahead += 7
        next_run = now.replace(
            hour=target_hour, minute=target_minute, second=0, microsecond=0
        ) + timedelta(days=days_ahead)
        return next_run

    # Monthly schedule (specific day of month)
    if dom != "*":
        target_dom = int(dom)
        next_run = now.replace(
            day=target_dom, hour=target_hour, minute=target_minute,
            second=0, microsecond=0
        )
        if next_run <= now:
            # Move to next month
            if now.month == 12:
                next_run = next_run.replace(year=now.year + 1, month=1)
            else:
                next_run = next_run.replace(month=now.month + 1)
        return next_run

    # Daily schedule
    next_run = now.replace(
        hour=target_hour, minute=target_minute, second=0, microsecond=0
    )
    if next_run <= now:
        next_run += timedelta(days=1)
    return next_run


# ─── Schedule Execution ─────────────────────────────────────────────────────

class ScheduleDB:
    """Database operations for the scheduler."""

    def __init__(self, database_url: str):
        self.db = DBHelper(database_url)
        self.db.connect()

    def get_due_schedules(self) -> list[dict]:
        """Get all enabled schedules where nextRunAt <= now."""
        self.db._ensure_connected()
        cursor = self.db.conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT * FROM `scheduled_jobs` WHERE `enabled` = %s AND `nextRunAt` <= %s",
            (True, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")),
        )
        rows = cursor.fetchall()
        cursor.close()
        return rows

    def get_schedule(self, schedule_id: int) -> Optional[dict]:
        self.db._ensure_connected()
        cursor = self.db.conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM `scheduled_jobs` WHERE `id` = %s", (schedule_id,))
        row = cursor.fetchone()
        cursor.close()
        return row

    def list_schedules(self) -> list[dict]:
        self.db._ensure_connected()
        cursor = self.db.conn.cursor(dictionary=True)
        cursor.execute("SELECT `id`, `name`, `jobType`, `enabled`, `cronExpression`, `lastRunAt`, `nextRunAt`, `lastRunStatus`, `runCount` FROM `scheduled_jobs` ORDER BY `id`")
        rows = cursor.fetchall()
        cursor.close()
        return rows

    def update_schedule(self, schedule_id: int, **kwargs):
        self.db._ensure_connected()
        set_parts = []
        values = []
        for key, val in kwargs.items():
            set_parts.append(f"`{key}` = %s")
            values.append(val)
        values.append(schedule_id)
        sql = f"UPDATE `scheduled_jobs` SET {', '.join(set_parts)} WHERE `id` = %s"
        cursor = self.db.conn.cursor()
        cursor.execute(sql, values)
        self.db.conn.commit()
        cursor.close()

    def get_user_token(self, user_id: int, token_type: str) -> Optional[dict]:
        self.db._ensure_connected()
        cursor = self.db.conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT * FROM `user_tokens` WHERE `userId` = %s AND `tokenType` = %s ORDER BY `updatedAt` DESC LIMIT 1",
            (user_id, token_type),
        )
        row = cursor.fetchone()
        cursor.close()
        return row

    def create_schedule_run(self, data: dict) -> int:
        self.db._ensure_connected()
        cols = []
        placeholders = []
        values = []
        for key, val in data.items():
            cols.append(f"`{key}`")
            placeholders.append("%s")
            values.append(json.dumps(val) if isinstance(val, (dict, list)) else val)
        sql = f"INSERT INTO `schedule_runs` ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
        cursor = self.db.conn.cursor()
        cursor.execute(sql, values)
        self.db.conn.commit()
        run_id = cursor.lastrowid
        cursor.close()
        return run_id

    def create_batch_job(self, data: dict) -> int:
        self.db._ensure_connected()
        cols = []
        placeholders = []
        values = []
        for key, val in data.items():
            cols.append(f"`{key}`")
            placeholders.append("%s")
            values.append(json.dumps(val) if isinstance(val, (dict, list)) else val)
        sql = f"INSERT INTO `batch_jobs` ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
        cursor = self.db.conn.cursor()
        cursor.execute(sql, values)
        self.db.conn.commit()
        job_id = cursor.lastrowid
        cursor.close()
        return job_id

    def create_saved_report(self, data: dict) -> int:
        self.db._ensure_connected()
        cols = []
        placeholders = []
        values = []
        for key, val in data.items():
            cols.append(f"`{key}`")
            placeholders.append("%s")
            values.append(json.dumps(val) if isinstance(val, (dict, list)) else val)
        sql = f"INSERT INTO `saved_reports` ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
        cursor = self.db.conn.cursor()
        cursor.execute(sql, values)
        self.db.conn.commit()
        report_id = cursor.lastrowid
        cursor.close()
        return report_id

    def close(self):
        self.db.close()


async def execute_report_job(
    sdb: ScheduleDB,
    config: dict,
    schedule: dict,
    schedule_run_id: int,
    job_id: int,
    report_id: int,
):
    """Execute a single report generation + optional catalog update job."""
    cfg = get_config()
    start_time = time.time()

    ad_account_id = config.get("adAccountId", "")
    access_token = config.get("accessToken", "")
    date_range_type = config.get("dateRangeType", "last_7_days")
    level = config.get("level", "account")
    breakdown = config.get("breakdown", "product_id")

    date_start, date_end = calculate_date_range(date_range_type)
    filters = build_api_filters(config)
    max_cvr = float(config.get("maxCVR", 0)) if config.get("maxCVR") else None
    top_limit = int(config.get("topConversionLimit", 0)) if config.get("topConversionLimit") else None

    log.info(f"Job {job_id}: {ad_account_id} | {date_start} to {date_end}")

    async with aiohttp.ClientSession(
        headers={"Accept-Encoding": "gzip, deflate"},
        auto_decompress=True,
    ) as session:
        # Step 1: Create report run
        sdb.db.update_job(job_id, status="running", statusMessage="Creating report...",
                          startedAt=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"))

        report_run_id = await create_report_run(
            session, ad_account_id, date_start, date_end,
            access_token, level, breakdown, filters,
        )
        log.info(f"Job {job_id}: Report run created: {report_run_id}")

        # Step 2: Poll
        sdb.db.update_job(job_id, statusMessage="Waiting for report...")

        async def on_poll(pct):
            sdb.db.update_job(job_id, progress=int(pct * 0.5),
                              statusMessage=f"Generating: {pct}%")

        poll_result = await poll_report_status(session, report_run_id, access_token, on_poll)
        if not poll_result["success"]:
            raise RuntimeError(f"Report failed: {poll_result.get('failure_reason')}")

        # Step 3: Fetch data
        sdb.db.update_job(job_id, progress=50, statusMessage="Fetching data...")

        async def on_fetch(loaded):
            pct = 50 + min(int(loaded / 80000 * 40), 40)
            sdb.db.update_job(job_id, progress=pct, processedItems=loaded,
                              statusMessage=f"Fetched {loaded:,} records...")

        raw_data = await fetch_insights_data(session, report_run_id, access_token, on_fetch)
        log.info(f"Job {job_id}: Fetched {len(raw_data)} raw records")

        # Step 4: Map data
        mapped = [map_row_to_product_insight(row) for row in raw_data]

        # Post-processing filters
        if max_cvr and max_cvr > 0:
            before = len(mapped)
            mapped = [d for d in mapped if d["cvr"] < max_cvr]
            log.info(f"Job {job_id}: maxCVR filter {before} -> {len(mapped)}")

        if top_limit and top_limit > 0:
            mapped.sort(key=lambda d: d["purchases"] + d["catalog_purchases"], reverse=True)
            mapped = mapped[:top_limit]

        total_spend = sum(d["spend"] for d in mapped)
        total_impressions = sum(d["impressions"] for d in mapped)

        # Step 5: Upload to S3
        if cfg.forge_api_url and cfg.forge_api_key:
            import secrets
            s3_key = f"reports/{schedule['userId']}/{report_id}-{secrets.token_urlsafe(6)}.json"
            json_data = json.dumps(mapped, ensure_ascii=False).encode("utf-8")
            s3_url = await storage_put(session, cfg.forge_api_url, cfg.forge_api_key,
                                       s3_key, json_data)
            sdb.db.update_saved_report(
                report_id, data=s3_url, totalItems=len(mapped),
                totalSpend=round(total_spend * 100), totalImpressions=total_impressions,
                status="completed",
                generatedAt=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                durationMs=int((time.time() - start_time) * 1000),
            )
        else:
            # Store data inline if no S3
            sdb.db.update_saved_report(
                report_id, data=json.dumps(mapped, ensure_ascii=False),
                totalItems=len(mapped),
                totalSpend=round(total_spend * 100), totalImpressions=total_impressions,
                status="completed",
                generatedAt=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                durationMs=int((time.time() - start_time) * 1000),
            )

        # Step 6: Catalog update
        update_to_catalog = config.get("updateToCatalog", False)
        catalog_id = config.get("catalogId")
        catalog_token = config.get("catalogAccessToken")

        if update_to_catalog and catalog_id and catalog_token:
            sdb.db.update_job(job_id, progress=91,
                              statusMessage=f"Updating catalog with {len(mapped)} products...")
            retailer_ids = [d["product_retailer_id"] for d in mapped
                           if d["product_retailer_id"] != "N/A"]

            update_fields = {}
            if config.get("enableCustomLabel4", True) and config.get("customLabel4"):
                update_fields["custom_label_4"] = config["customLabel4"]
            for key, val in config.get("customNumbers", {}).items():
                if val and str(val).strip():
                    update_fields[key] = float(val)

            if retailer_ids and update_fields:
                result = await batch_update_catalog(
                    session, catalog_id, catalog_token, retailer_ids, update_fields,
                )
                log.info(f"Job {job_id}: Catalog updated {result['success']} success, {result['errors']} errors")

                # Verify
                verification = await verify_catalog_update(
                    session, catalog_id, catalog_token, update_fields,
                )
                verify_parts = []
                for fname, finfo in verification.get("fields", {}).items():
                    matched = finfo.get("matched_count", -1)
                    total = finfo.get("total_count", 0)
                    verify_parts.append(f"{fname}: {matched}/{total}")
                log.info(f"Job {job_id}: Verification: {'; '.join(verify_parts)}")

        # Step 7: Complete
        duration_ms = int((time.time() - start_time) * 1000)
        sdb.db.update_job(
            job_id, status="completed", progress=100,
            processedItems=len(mapped), totalItems=len(mapped),
            successCount=len(mapped),
            completedAt=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            statusMessage=f"Completed: {len(mapped)} products in {duration_ms // 1000}s",
        )

        # Step 8: Update schedule run
        run = sdb.db.get_schedule_run(schedule_run_id)
        if run:
            new_completed = (run.get("completed_jobs") or 0) + 1
            total_done = new_completed + (run.get("failed_jobs") or 0)
            all_done = total_done >= (run.get("total_jobs") or 1)
            run_status = "running"
            if all_done:
                run_status = "completed" if (run.get("failed_jobs") or 0) == 0 else "partial"

            update_kwargs = {
                "completedJobs": new_completed,
                "totalItems": (run.get("total_items") or 0) + len(mapped),
                "totalSpend": (run.get("total_spend") or 0) + round(total_spend * 100),
                "totalImpressions": (run.get("total_impressions") or 0) + total_impressions,
                "status": run_status,
            }
            if all_done:
                update_kwargs["completedAt"] = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                started = run.get("started_at") or run.get("startedAt")
                if started and hasattr(started, "timestamp"):
                    update_kwargs["durationMs"] = int((time.time() - started.timestamp()) * 1000)
            sdb.db.update_schedule_run(schedule_run_id, **update_kwargs)

        log.info(f"Job {job_id}: Done in {duration_ms // 1000}s — {len(mapped)} products")
        return {"totalItems": len(mapped), "totalSpend": total_spend}


async def process_schedule(sdb: ScheduleDB, schedule: dict, trigger_type: str = "auto"):
    """Process one scheduled job: resolve tokens, create batch jobs, execute."""
    schedule_id = schedule["id"]
    user_id = schedule["userId"]
    job_type = schedule["jobType"]

    log.info(f"Processing schedule {schedule_id}: {schedule.get('name', 'unnamed')} ({job_type})")

    # Get access token
    ads_token = sdb.get_user_token(user_id, "ads_management")
    if not ads_token:
        log.error(f"Schedule {schedule_id}: No ads_management token for user {user_id}")
        return

    # Get report configs (multi-account or legacy single)
    report_configs = []
    raw_configs = schedule.get("reportConfigs")
    if isinstance(raw_configs, str):
        raw_configs = json.loads(raw_configs)
    base_config = schedule.get("config")
    if isinstance(base_config, str):
        base_config = json.loads(base_config)

    if raw_configs and isinstance(raw_configs, list) and len(raw_configs) > 0:
        for rc in raw_configs:
            merged = {**(base_config or {}), **rc}
            merged["accessToken"] = rc.get("accessToken") or ads_token["accessToken"]
            report_configs.append(merged)
    elif base_config and base_config.get("adAccountId"):
        base_config["accessToken"] = ads_token["accessToken"]
        report_configs.append(base_config)
    else:
        log.error(f"Schedule {schedule_id}: No valid report config")
        return

    # Get catalog token if needed
    if job_type in ("catalog_update", "report_and_catalog"):
        cat_token = sdb.get_user_token(user_id, "catalog_management")
        if cat_token:
            for rc in report_configs:
                if not rc.get("catalogAccessToken"):
                    rc["catalogAccessToken"] = cat_token["accessToken"]
                if not rc.get("catalogId") and cat_token.get("catalogId"):
                    rc["catalogId"] = cat_token["catalogId"]

    # Create schedule run
    schedule_run_id = sdb.create_schedule_run({
        "scheduleId": schedule_id,
        "userId": user_id,
        "triggerType": trigger_type,
        "totalJobs": len(report_configs),
        "status": "running",
    })

    # Process each config
    for i, rc in enumerate(report_configs):
        config_name = rc.get("name", f"Config {i + 1}")
        log.info(f"Schedule {schedule_id}: Processing {config_name} ({i + 1}/{len(report_configs)})")

        # Create saved report
        date_start, date_end = calculate_date_range(rc.get("dateRangeType", "last_7_days"))
        report_id = sdb.create_saved_report({
            "userId": user_id,
            "name": f"{schedule.get('name', 'Report')} - {config_name} ({date_start} to {date_end})",
            "adAccountId": rc.get("adAccountId", ""),
            "dateStart": date_start,
            "dateEnd": date_end,
            "level": rc.get("level", "account"),
            "breakdown": rc.get("breakdown"),
            "minSpend": rc.get("minSpend"),
            "minCTR": rc.get("minCTR"),
            "status": "generating",
            "source": "scheduled",
            "scheduleId": schedule_id,
        })

        # Create batch job
        job_config = {**rc, "scheduleRunId": schedule_run_id, "configIndex": i, "configName": config_name}
        job_id = sdb.create_batch_job({
            "userId": user_id,
            "jobType": "report_generation",
            "config": job_config,
            "status": "queued",
            "reportId": report_id,
        })

        try:
            await execute_report_job(sdb, rc, schedule, schedule_run_id, job_id, report_id)
        except Exception as e:
            log.error(f"Schedule {schedule_id}, job {job_id} failed: {e}")
            sdb.db.update_job(
                job_id, status="failed",
                statusMessage=str(e)[:500],
                completedAt=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            )
            sdb.db.update_saved_report(report_id, status="failed", errorMessage=str(e)[:500])

            # Update schedule run with failure
            run = sdb.db.get_schedule_run(schedule_run_id)
            if run:
                new_failed = (run.get("failed_jobs") or 0) + 1
                total_done = (run.get("completed_jobs") or 0) + new_failed
                all_done = total_done >= (run.get("total_jobs") or 1)
                run_status = "running"
                if all_done:
                    run_status = "failed" if (run.get("completed_jobs") or 0) == 0 else "partial"

                update_kwargs = {"failedJobs": new_failed, "status": run_status,
                                 "errorMessage": str(e)[:500]}
                if all_done:
                    update_kwargs["completedAt"] = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

                # Set retry if transient
                classified = classify_error(e)
                if classified.retryable and (run.get("retryCount") or 0) < MAX_RETRIES:
                    retry_count = (run.get("retryCount") or 0) + 1
                    delay = calculate_retry_delay(retry_count, classified.type)
                    update_kwargs["retryCount"] = retry_count
                    update_kwargs["nextRetryAt"] = (
                        datetime.utcnow() + timedelta(seconds=delay)
                    ).strftime("%Y-%m-%d %H:%M:%S")
                    update_kwargs["lastErrorType"] = classified.type.value
                    log.info(f"Schedule {schedule_id}: Will retry in {delay:.0f}s (attempt {retry_count})")

                sdb.db.update_schedule_run(schedule_run_id, **update_kwargs)

    # Update schedule metadata
    next_run = parse_cron_next_run(schedule["cronExpression"], schedule.get("timezone", "Asia/Taipei"))
    sdb.update_schedule(
        schedule_id,
        lastRunAt=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        nextRunAt=next_run.strftime("%Y-%m-%d %H:%M:%S") if next_run else None,
        lastRunStatus="success",
        runCount=(schedule.get("runCount") or 0) + 1,
    )
    log.info(f"Schedule {schedule_id}: Next run at {next_run}")


# ─── Main Loop ───────────────────────────────────────────────────────────────

async def scheduler_tick(sdb: ScheduleDB):
    """One tick of the scheduler: process due jobs + retries."""
    try:
        due_schedules = sdb.get_due_schedules()
        if due_schedules:
            log.info(f"Found {len(due_schedules)} due schedule(s)")

        for schedule in due_schedules:
            try:
                await process_schedule(sdb, schedule)
            except Exception as e:
                log.error(f"Schedule {schedule['id']} failed: {e}")
                sdb.update_schedule(schedule["id"], lastRunStatus="failed")
    except Exception as e:
        if "no available peers" not in str(e).lower():
            log.error(f"Scheduler tick error: {e}")


async def run_scheduler():
    """Run the scheduler daemon."""
    cfg = get_config()
    if not cfg.database_url:
        log.error("DATABASE_URL not set")
        sys.exit(1)

    sdb = ScheduleDB(cfg.database_url)
    log.info("Scheduler started. Checking every %ds...", SCHEDULER_INTERVAL_SEC)

    running = True

    def handle_signal(sig, frame):
        nonlocal running
        log.info("Shutdown signal received")
        running = False

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    while running:
        await scheduler_tick(sdb)
        await asyncio.sleep(SCHEDULER_INTERVAL_SEC)

    sdb.close()
    log.info("Scheduler stopped")


async def run_now(schedule_id: int):
    """Run a specific schedule immediately."""
    cfg = get_config()
    sdb = ScheduleDB(cfg.database_url)

    schedule = sdb.get_schedule(schedule_id)
    if not schedule:
        log.error(f"Schedule {schedule_id} not found")
        return

    log.info(f"Manual run: {schedule.get('name', 'unnamed')} (ID: {schedule_id})")
    await process_schedule(sdb, schedule, trigger_type="manual")
    sdb.close()


def list_schedules():
    """List all schedules."""
    cfg = get_config()
    sdb = ScheduleDB(cfg.database_url)
    schedules = sdb.list_schedules()
    sdb.close()

    if not schedules:
        print("No schedules found.")
        return

    print(f"\n{'ID':<5} {'Name':<30} {'Type':<20} {'Enabled':<8} {'Cron':<20} {'Last Run':<20} {'Next Run':<20} {'Status':<10} {'Runs':<5}")
    print("-" * 138)
    for s in schedules:
        print(f"{s['id']:<5} {(s.get('name') or '-')[:29]:<30} {s['jobType']:<20} "
              f"{'Yes' if s['enabled'] else 'No':<8} {s['cronExpression']:<20} "
              f"{str(s.get('lastRunAt') or '-')[:19]:<20} "
              f"{str(s.get('nextRunAt') or '-')[:19]:<20} "
              f"{(s.get('lastRunStatus') or '-'):<10} {s.get('runCount', 0):<5}")
    print()


# ─── Entry Point ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Meta Product Insights Scheduler")
    parser.add_argument("--run-now", type=int, metavar="ID",
                        help="Run a specific schedule immediately")
    parser.add_argument("--list", action="store_true",
                        help="List all schedules")
    args = parser.parse_args()

    if args.list:
        list_schedules()
    elif args.run_now:
        asyncio.run(run_now(args.run_now))
    else:
        asyncio.run(run_scheduler())


if __name__ == "__main__":
    main()
