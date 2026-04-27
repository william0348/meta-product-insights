"""
Report Generator - orchestrates report generation from batch jobs.

Python port of report-generator.ts. Validates job configuration,
calculates date ranges, builds API filters, creates saved report
records, and delegates to the report worker.
"""

import logging
from datetime import datetime, timedelta

from ..services.report_worker import run_report_worker

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Date range calculation
# ---------------------------------------------------------------------------

def calculate_date_range(date_range_type: str) -> dict:
    """Return ``{"date_start": "YYYY-MM-DD", "date_end": "YYYY-MM-DD"}``
    for the given *date_range_type*.

    Supported types:
    - ``last_7_days`` : 7 days ago to yesterday
    - ``last_14_days``: 14 days ago to yesterday
    - ``last_30_days``: 30 days ago to yesterday
    - ``last_week``   : last complete Monday-Sunday
    - ``last_month``  : last complete calendar month
    - default         : falls back to last 7 days
    """
    today = datetime.utcnow().date()
    yesterday = today - timedelta(days=1)

    if date_range_type == "last_7_days":
        date_start = today - timedelta(days=7)
        date_end = yesterday

    elif date_range_type == "last_14_days":
        date_start = today - timedelta(days=14)
        date_end = yesterday

    elif date_range_type == "last_30_days":
        date_start = today - timedelta(days=30)
        date_end = yesterday

    elif date_range_type == "last_week":
        # Last complete Mon-Sun week
        # weekday(): Monday=0 ... Sunday=6
        days_since_monday = today.weekday()  # how far today is from Monday
        last_monday = today - timedelta(days=days_since_monday + 7)
        last_sunday = last_monday + timedelta(days=6)
        date_start = last_monday
        date_end = last_sunday

    elif date_range_type == "last_month":
        # Last complete calendar month
        first_of_this_month = today.replace(day=1)
        last_day_prev_month = first_of_this_month - timedelta(days=1)
        first_of_prev_month = last_day_prev_month.replace(day=1)
        date_start = first_of_prev_month
        date_end = last_day_prev_month

    else:
        # Default: last 7 days
        date_start = today - timedelta(days=7)
        date_end = yesterday

    return {
        "date_start": date_start.isoformat(),
        "date_end": date_end.isoformat(),
    }


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

async def process_report_generation_job(
    job,
    start_time: float,
    db_ops: dict,
) -> None:
    """Process a single report-generation batch job.

    Parameters
    ----------
    job
        A ``BatchJob`` model instance.  Expected attributes:
        ``id``, ``userId``, ``config`` (dict with job parameters).
    start_time : float
        Epoch timestamp when processing started (used for duration tracking).
    db_ops : dict
        A mapping of async database helper functions::

            {
                "update_batch_job": async (job_id, data) -> ...,
                "create_saved_report": async (data) -> saved_report,
                "update_saved_report": async (report_id, data) -> ...,
                "create_batch_history_record": async (data) -> ...,
                "update_batch_history_record": async (record_id, data) -> ...,
                "get_schedule_run": async (run_id) -> ...,
                "update_schedule_run": async (run_id, data) -> ...,
                "get_batch_job": async (job_id) -> ...,
            }
    """

    job_id = job.id
    user_id = job.userId
    config: dict = job.config or {}

    # Unpack db_ops
    update_batch_job = db_ops["update_batch_job"]
    create_saved_report = db_ops["create_saved_report"]
    update_saved_report = db_ops["update_saved_report"]
    create_batch_history_record = db_ops["create_batch_history_record"]
    update_batch_history_record = db_ops["update_batch_history_record"]
    get_schedule_run = db_ops["get_schedule_run"]
    update_schedule_run = db_ops["update_schedule_run"]
    get_batch_job = db_ops["get_batch_job"]

    # ------------------------------------------------------------------
    # Validate required fields
    # ------------------------------------------------------------------
    ad_account_id: str | None = config.get("adAccountId")
    access_token: str | None = config.get("accessToken")

    if not ad_account_id or not access_token:
        error_msg = "Missing required config: adAccountId and accessToken are required"
        logger.error("Job %d validation failed: %s", job_id, error_msg)
        await update_batch_job(
            job_id,
            {"status": "failed", "progress": 0, "error": error_msg},
        )
        return

    # ------------------------------------------------------------------
    # Calculate date range
    # ------------------------------------------------------------------
    date_start: str | None = config.get("dateStart")
    date_end: str | None = config.get("dateEnd")

    if not date_start:
        date_range_type: str = config.get("dateRangeType", "last_7_days")
        date_range = calculate_date_range(date_range_type)
        date_start = date_range["date_start"]
        date_end = date_range["date_end"]
        logger.info(
            "Job %d: calculated date range '%s' -> %s to %s",
            job_id,
            date_range_type,
            date_start,
            date_end,
        )

    level: str = config.get("level") or "account"
    breakdown: str = config.get("breakdown") or "product_id"

    # ------------------------------------------------------------------
    # Filters are applied in Python after CSV download (not at API level)
    # This avoids Facebook API filter issues and allows full data download
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Create saved_reports record
    # ------------------------------------------------------------------
    report_id = await create_saved_report({
        "userId": user_id,
        "name": f"Report {date_start} to {date_end}",
        "adAccountId": ad_account_id,
        "dateStart": date_start,
        "dateEnd": date_end,
        "level": level,
        "breakdown": breakdown,
        "minSpend": config.get("minSpend"),
        "minCTR": config.get("minCTR"),
        "status": "generating",
        "source": "manual",
    })

    if not report_id:
        raise RuntimeError("Failed to create saved report record")
    logger.info(
        "Job %d: created saved report %d (%s to %s)",
        job_id,
        report_id,
        date_start,
        date_end,
    )

    # ------------------------------------------------------------------
    # Build WorkerConfig
    # ------------------------------------------------------------------
    worker_config: dict = {
        "jobId": job_id,
        "reportId": report_id,
        "userId": user_id,
        "adAccountId": ad_account_id,
        "accessToken": access_token,
        "dateStart": date_start,
        "dateEnd": date_end,
        "level": config.get("level", "account"),
        "breakdown": config.get("breakdown", "product_id"),
        "filters": None,
        "minSpend": float(config["minSpend"]) if config.get("minSpend") else None,
        "minCTR": float(config["minCTR"]) if config.get("minCTR") else None,
        "maxSpend": float(config["maxSpend"]) if config.get("maxSpend") else None,
        "maxCVR": float(config["maxCVR"]) if config.get("maxCVR") else None,
        "topConversionLimit": config.get("topConversionLimit"),
        "updateToCatalog": config.get("updateToCatalog", False),
        "catalogId": config.get("catalogId"),
        "catalogAccessToken": config.get("catalogAccessToken"),
        "customLabel4": config.get("customLabel4"),
        "enableCustomLabel4": config.get("enableCustomLabel4", False),
        "customNumbers": config.get("customNumbers"),
        "customLabels": config.get("customLabels"),
        "scheduleRunId": config.get("scheduleRunId"),
    }

    # ------------------------------------------------------------------
    # Run the worker
    # ------------------------------------------------------------------
    try:
        result = await run_report_worker(
            config=worker_config,
            db_update_job=update_batch_job,
            db_update_report=update_saved_report,
            db_create_history=create_batch_history_record,
            db_update_history=update_batch_history_record,
            db_get_schedule_run=get_schedule_run,
            db_update_schedule_run=update_schedule_run,
            db_get_job=get_batch_job,
        )

        if result.get("success"):
            logger.info(
                "Job %d completed: %d items, $%.2f spend, %dms",
                job_id,
                result.get("totalItems", 0),
                result.get("totalSpend", 0),
                result.get("durationMs", 0),
            )
        else:
            logger.error(
                "Job %d failed: %s (%dms)",
                job_id,
                result.get("error", "unknown error"),
                result.get("durationMs", 0),
            )

    except Exception as exc:
        logger.exception("Job %d raised an unhandled exception: %s", job_id, exc)
        await update_batch_job(
            job_id,
            {"status": "failed", "progress": 0, "error": str(exc)},
        )
        await update_saved_report(
            report_id,
            {"status": "failed", "error": str(exc)},
        )
