"""
Scheduler for recurring jobs.

Ported from scheduler.ts. Periodically checks for due scheduled jobs and
retryable failed runs, creating batch jobs as needed. Supports cron-like
scheduling with weekly, monthly, and daily frequencies.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import BatchJob, ScheduledJob, ScheduleRun, UserToken
from ..database import get_session_factory
from ..services.error_classifier import classify_error, calculate_retry_delay

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCHEDULER_INTERVAL_S = 60

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_scheduler_task: Optional[asyncio.Task] = None


# ---------------------------------------------------------------------------
# Cron helpers
# ---------------------------------------------------------------------------


def calculate_next_run_time(schedule: ScheduledJob) -> datetime:
    """
    Calculate the next run time from a cron expression in the schedule's
    declared timezone, then convert to a naive UTC datetime for DB storage.

    Cron format: "second minute hour dayOfMonth month dayOfWeek"
    Supports weekly (dayOfWeek != *), monthly (dayOfMonth != *), and daily.
    """
    cron = schedule.cronExpression
    parts = cron.strip().split()

    # Pad to 6 fields if necessary (some expressions omit seconds)
    while len(parts) < 6:
        parts.insert(0, "0")

    _second, minute, hour, day_of_month, _month, day_of_week = parts

    # Resolve the schedule's timezone. Compute the next-run instant in local
    # time, then convert to UTC at the end. Treating cron hour/minute as UTC
    # caused schedules set to "8am Taipei" to fire at 4pm Taipei.
    tz_name = schedule.timezone or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        logger.warning("Unknown timezone %r on schedule %s, falling back to UTC",
                       tz_name, getattr(schedule, "id", "?"))
        tz = ZoneInfo("UTC")

    now_local = datetime.now(tz)
    target_hour = int(hour) if hour != "*" else now_local.hour
    target_minute = int(minute) if minute != "*" else now_local.minute
    target_second = int(_second) if _second != "*" else 0

    if day_of_week != "*":
        # Weekly schedule
        target_dow = int(day_of_week)  # 0=Sunday, 1=Monday, ..., 6=Saturday
        # Python weekday: 0=Monday, ..., 6=Sunday
        python_dow = (target_dow - 1) % 7 if target_dow > 0 else 6

        current_dow = now_local.weekday()
        days_ahead = python_dow - current_dow
        if days_ahead < 0:
            days_ahead += 7

        next_run_local = now_local.replace(
            hour=target_hour, minute=target_minute, second=target_second, microsecond=0
        ) + timedelta(days=days_ahead)

        if next_run_local <= now_local:
            next_run_local += timedelta(weeks=1)

    elif day_of_month != "*":
        # Monthly schedule
        import calendar
        target_day = int(day_of_month)

        next_run_local = now_local.replace(
            day=min(target_day, 28),
            hour=target_hour,
            minute=target_minute,
            second=target_second,
            microsecond=0,
        )
        max_day = calendar.monthrange(next_run_local.year, next_run_local.month)[1]
        next_run_local = next_run_local.replace(day=min(target_day, max_day))

        if next_run_local <= now_local:
            if next_run_local.month == 12:
                next_run_local = next_run_local.replace(year=next_run_local.year + 1, month=1)
            else:
                next_run_local = next_run_local.replace(month=next_run_local.month + 1)
            max_day = calendar.monthrange(next_run_local.year, next_run_local.month)[1]
            next_run_local = next_run_local.replace(day=min(target_day, max_day))

    else:
        # Daily schedule
        next_run_local = now_local.replace(
            hour=target_hour, minute=target_minute, second=target_second, microsecond=0
        )
        if next_run_local <= now_local:
            next_run_local += timedelta(days=1)

    # Convert local-tz aware datetime to a naive UTC datetime for DB storage
    return next_run_local.astimezone(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------


def get_report_configs(schedule: ScheduledJob) -> list[dict[str, Any]]:
    """
    Extract report configurations from a scheduled job.

    Checks reportConfigs array first (new multi-account format),
    then falls back to single config.adAccountId (legacy format).
    """
    # New multi-account format
    if schedule.reportConfigs and isinstance(schedule.reportConfigs, list) and len(schedule.reportConfigs) > 0:
        return schedule.reportConfigs

    # Legacy single-account format
    config = schedule.config or {}
    ad_account_id = config.get("adAccountId")
    if ad_account_id:
        return [config]

    return []


# ---------------------------------------------------------------------------
# Main scheduling logic
# ---------------------------------------------------------------------------


async def process_scheduled_job(
    schedule: ScheduledJob,
    trigger_type: str = "auto",
    retry_opts: Optional[dict[str, Any]] = None,
) -> Optional[int]:
    """
    Process a scheduled job: create a schedule run and enqueue batch jobs.

    Returns the schedule run ID on success, None on failure.
    """
    session_factory = get_session_factory()
    schedule_run_id: Optional[int] = None

    try:
        async with session_factory() as session:
            # Create schedule run record
            run = ScheduleRun(
                scheduleId=schedule.id,
                userId=schedule.userId,
                triggerType=trigger_type,
                status="running",
                retryCount=retry_opts.get("retryCount", 0) if retry_opts else 0,
                maxRetries=retry_opts.get("maxRetries", 3) if retry_opts else 3,
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)
            schedule_run_id = run.id

        logger.info(
            "[Scheduler] Processing schedule %d (%s), run %d, trigger=%s",
            schedule.id, schedule.name, schedule_run_id, trigger_type,
        )

        # Get user's ads_management token
        async with session_factory() as session:
            token_result = await session.execute(
                select(UserToken).where(
                    and_(
                        UserToken.userId == schedule.userId,
                        UserToken.tokenType == "ads_management",
                    )
                )
            )
            ads_token = token_result.scalars().first()

        if not ads_token:
            raise ValueError(f"No ads_management token found for user {schedule.userId}")

        # Get report configs
        report_configs = get_report_configs(schedule)
        config = schedule.config or {}

        job_ids: list[int] = []

        # ------------------------------------------------------------------
        # Create report generation jobs for each config
        # ------------------------------------------------------------------
        if schedule.jobType in ("report_generation", "report_and_catalog"):
            for i, rc in enumerate(report_configs):
                job_config: dict[str, Any] = {
                    "adAccountId": rc.get("adAccountId"),
                    "accessToken": ads_token.accessToken,
                    "dateStart": rc.get("dateStart") or config.get("dateStart"),
                    "dateEnd": rc.get("dateEnd") or config.get("dateEnd"),
                    "dateRangeType": rc.get("dateRangeType") or config.get("dateRangeType"),
                    # Default to product-level reporting (level=account +
                    # breakdown=product_id) to match the frontend manual flow.
                    # Ad-level reports without product breakdown can be too
                    # large for FB's lookaside CSV endpoint and return 500.
                    "level": rc.get("level") or config.get("level") or "account",
                    "breakdown": rc.get("breakdown") or config.get("breakdown") or "product_id",
                    "minSpend": rc.get("minSpend") or config.get("minSpend"),
                    "minCTR": rc.get("minCTR") or config.get("minCTR"),
                    "maxSpend": rc.get("maxSpend") or config.get("maxSpend"),
                    "maxCVR": rc.get("maxCVR") or config.get("maxCVR"),
                    "topConversionLimit": rc.get("topConversionLimit") or config.get("topConversionLimit"),
                    "updateToCatalog": config.get("updateToCatalog", False),
                    "catalogId": config.get("catalogId"),
                    "catalogAccessToken": config.get("catalogAccessToken"),
                    "enableCustomLabel4": config.get("enableCustomLabel4", True),
                    "customLabel4": config.get("customLabel4"),
                    "customNumbers": config.get("customNumbers", {}),
                    "scheduleId": schedule.id,
                    "scheduleRunId": schedule_run_id,
                    "reportName": rc.get("name") or f"{schedule.name} - Report {i + 1}",
                }

                async with session_factory() as session:
                    job = BatchJob(
                        userId=schedule.userId,
                        jobType="report_generation",
                        config=job_config,
                        status="queued",
                    )
                    session.add(job)
                    await session.commit()
                    await session.refresh(job)
                    job_ids.append(job.id)

                logger.info(
                    "[Scheduler] Created report job %d for ad account %s",
                    job.id, rc.get("adAccountId"),
                )

        # ------------------------------------------------------------------
        # Create standalone catalog_update job ONLY for pure catalog mode.
        # For "report_and_catalog", the catalog update happens inline inside
        # the report worker (using the products it just downloaded). Creating
        # a separate catalog_update job here would always produce a noisy
        # "No updates to process" entry because retailerIds isn't in the
        # schedule config.
        # ------------------------------------------------------------------
        if schedule.jobType == "catalog_update":
            # Get catalog_management token
            async with session_factory() as session:
                catalog_token_result = await session.execute(
                    select(UserToken).where(
                        and_(
                            UserToken.userId == schedule.userId,
                            UserToken.tokenType == "catalog_management",
                        )
                    )
                )
                catalog_token = catalog_token_result.scalars().first()

            if not catalog_token:
                raise ValueError(f"No catalog_management token found for user {schedule.userId}")

            catalog_config: dict[str, Any] = {
                "catalogId": config.get("catalogId") or catalog_token.catalogId,
                "accessToken": catalog_token.accessToken,
                "retailerIds": config.get("retailerIds", []),
                "updateData": config.get("updateData", {}),
                "customLabel4": config.get("customLabel4"),
                "criteria": config.get("criteria"),
                "scheduleId": schedule.id,
                "scheduleRunId": schedule_run_id,
            }

            async with session_factory() as session:
                job = BatchJob(
                    userId=schedule.userId,
                    jobType="catalog_update",
                    config=catalog_config,
                    status="queued",
                )
                session.add(job)
                await session.commit()
                await session.refresh(job)
                job_ids.append(job.id)

            logger.info(
                "[Scheduler] Created catalog job %d for catalog %s",
                job.id, catalog_config.get("catalogId"),
            )

        # ------------------------------------------------------------------
        # Update schedule run with job IDs and update schedule metadata
        # ------------------------------------------------------------------
        async with session_factory() as session:
            await session.execute(
                update(ScheduleRun)
                .where(ScheduleRun.id == schedule_run_id)
                .values(
                    jobIds=job_ids,
                    totalJobs=len(job_ids),
                )
            )
            await session.commit()

        # Update schedule with next run time and metadata
        next_run = calculate_next_run_time(schedule)
        async with session_factory() as session:
            await session.execute(
                update(ScheduledJob)
                .where(ScheduledJob.id == schedule.id)
                .values(
                    lastRunAt=datetime.utcnow(),
                    lastRunStatus="running",
                    lastRunJobId=job_ids[0] if job_ids else None,
                    nextRunAt=next_run,
                    runCount=(schedule.runCount or 0) + 1,
                )
            )
            await session.commit()

        logger.info(
            "[Scheduler] Schedule %d: created %d jobs, next run at %s",
            schedule.id, len(job_ids), next_run.isoformat(),
        )
        return schedule_run_id

    except Exception as exc:
        logger.error(
            "[Scheduler] Failed to process schedule %d: %s",
            schedule.id, exc, exc_info=True,
        )

        error_info = classify_error({"message": str(exc)})

        async with session_factory() as session:
            # Update schedule status
            await session.execute(
                update(ScheduledJob)
                .where(ScheduledJob.id == schedule.id)
                .values(
                    lastRunAt=datetime.utcnow(),
                    lastRunStatus="failed",
                    nextRunAt=calculate_next_run_time(schedule),
                )
            )
            await session.commit()

        # Update schedule run if created
        if schedule_run_id:
            async with session_factory() as session:
                retry_count = retry_opts.get("retryCount", 0) if retry_opts else 0
                update_fields: dict[str, Any] = {
                    "status": "failed",
                    "errorMessage": str(exc)[:1000],
                    "lastErrorType": error_info["type"],
                    "completedAt": datetime.utcnow(),
                }

                if error_info["retryable"] and retry_count < 3:
                    retry_delay_ms = calculate_retry_delay(retry_count, error_info["type"])
                    update_fields["nextRetryAt"] = datetime.utcnow() + timedelta(
                        milliseconds=retry_delay_ms
                    )
                    logger.info(
                        "[Scheduler] Run %d will retry in %d ms (attempt %d)",
                        schedule_run_id, retry_delay_ms, retry_count + 1,
                    )

                await session.execute(
                    update(ScheduleRun)
                    .where(ScheduleRun.id == schedule_run_id)
                    .values(**update_fields)
                )
                await session.commit()

        return None


# ---------------------------------------------------------------------------
# Retry logic
# ---------------------------------------------------------------------------


async def retry_failed_run(failed_run: ScheduleRun) -> Optional[int]:
    """Retry a failed schedule run by re-processing with incremented retry count."""
    session_factory = get_session_factory()

    async with session_factory() as session:
        # Get the schedule
        result = await session.execute(
            select(ScheduledJob).where(ScheduledJob.id == failed_run.scheduleId)
        )
        schedule = result.scalars().first()
        if not schedule:
            logger.error(
                "[Scheduler] Cannot retry run %d — schedule %d not found",
                failed_run.id, failed_run.scheduleId,
            )
            return None

        # Clear retry marker on the failed run
        await session.execute(
            update(ScheduleRun)
            .where(ScheduleRun.id == failed_run.id)
            .values(nextRetryAt=None)
        )
        await session.commit()

    logger.info(
        "[Scheduler] Retrying run %d for schedule %d (attempt %d/%d)",
        failed_run.id, failed_run.scheduleId,
        failed_run.retryCount + 1, failed_run.maxRetries,
    )

    return await process_scheduled_job(
        schedule,
        trigger_type="auto",
        retry_opts={
            "retryCount": failed_run.retryCount + 1,
            "maxRetries": failed_run.maxRetries,
        },
    )


# ---------------------------------------------------------------------------
# Scheduler check
# ---------------------------------------------------------------------------


async def _check_scheduled_jobs() -> None:
    """Check for due scheduled jobs and retryable failed runs."""
    session_factory = get_session_factory()
    now = datetime.utcnow()

    try:
        # ------------------------------------------------------------------
        # 1. Process due scheduled jobs
        # ------------------------------------------------------------------
        async with session_factory() as session:
            result = await session.execute(
                select(ScheduledJob).where(
                    and_(
                        ScheduledJob.enabled == True,  # noqa: E712
                        ScheduledJob.nextRunAt <= now,
                    )
                )
            )
            due_schedules = list(result.scalars().all())

        if due_schedules:
            logger.info("[Scheduler] Found %d due scheduled jobs", len(due_schedules))

        for schedule in due_schedules:
            try:
                await process_scheduled_job(schedule, trigger_type="auto")
            except Exception as exc:
                logger.error(
                    "[Scheduler] Error processing schedule %d: %s",
                    schedule.id, exc, exc_info=True,
                )

        # ------------------------------------------------------------------
        # 2. Process retryable failed runs
        # ------------------------------------------------------------------
        async with session_factory() as session:
            result = await session.execute(
                select(ScheduleRun).where(
                    and_(
                        ScheduleRun.status == "failed",
                        ScheduleRun.nextRetryAt != None,  # noqa: E711
                        ScheduleRun.nextRetryAt <= now,
                    )
                )
            )
            retryable_runs = list(result.scalars().all())

        if retryable_runs:
            logger.info("[Scheduler] Found %d retryable failed runs", len(retryable_runs))

        for run in retryable_runs:
            try:
                await retry_failed_run(run)
            except Exception as exc:
                logger.error(
                    "[Scheduler] Error retrying run %d: %s",
                    run.id, exc, exc_info=True,
                )

    except Exception as exc:
        logger.error("[Scheduler] Error in _check_scheduled_jobs: %s", exc, exc_info=True)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


async def _recompute_all_next_run_times() -> None:
    """One-shot at startup: recompute every enabled schedule's nextRunAt
    using the current calculate_next_run_time logic. Catches schedules whose
    nextRunAt was stored under a previous (buggy) timezone implementation.
    """
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            select(ScheduledJob).where(ScheduledJob.enabled == True)  # noqa: E712
        )
        schedules = list(result.scalars().all())
    if not schedules:
        return

    for sched in schedules:
        try:
            new_next = calculate_next_run_time(sched)
            if sched.nextRunAt != new_next:
                async with session_factory() as session:
                    await session.execute(
                        update(ScheduledJob)
                        .where(ScheduledJob.id == sched.id)
                        .values(nextRunAt=new_next)
                    )
                    await session.commit()
                logger.info(
                    "[Scheduler] Recomputed nextRunAt for schedule %d (%s): %s -> %s",
                    sched.id, sched.name, sched.nextRunAt, new_next,
                )
        except Exception as exc:
            logger.warning(
                "[Scheduler] Recompute failed for schedule %d: %s",
                sched.id, exc,
            )


async def start_scheduler() -> None:
    """Start the background scheduler loop."""
    global _scheduler_task
    if _scheduler_task is not None and not _scheduler_task.done():
        logger.warning("[Scheduler] Already running")
        return

    # Refresh nextRunAt for all enabled schedules so any rows written under
    # an older (buggy) timezone implementation get corrected immediately.
    try:
        await _recompute_all_next_run_times()
    except Exception as exc:
        logger.warning("[Scheduler] Startup nextRunAt refresh failed (non-fatal): %s", exc)

    _scheduler_task = asyncio.create_task(_scheduler_loop())
    logger.info("[Scheduler] Started (interval=%ds)", SCHEDULER_INTERVAL_S)


async def stop_scheduler() -> None:
    """Stop the background scheduler loop."""
    global _scheduler_task
    if _scheduler_task is not None:
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
        _scheduler_task = None
        logger.info("[Scheduler] Stopped")


async def _scheduler_loop() -> None:
    """Continuous loop that checks for due jobs and retryable runs."""
    while True:
        try:
            await _check_scheduled_jobs()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("[Scheduler] Unexpected error in scheduler loop: %s", exc, exc_info=True)
        try:
            from .monitor import tick_due_monitors
            ran = await tick_due_monitors()
            if ran:
                logger.info("[Scheduler] Ran %d due product set monitor(s)", ran)
        except Exception as exc:
            logger.error("[Scheduler] Monitor tick failed: %s", exc, exc_info=True)
        try:
            from .token_health import tick_token_health
            await tick_token_health()
        except Exception as exc:
            logger.error("[Scheduler] Token health tick failed: %s", exc, exc_info=True)
        await asyncio.sleep(SCHEDULER_INTERVAL_S)
