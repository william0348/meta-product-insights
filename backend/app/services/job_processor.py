"""
Background job queue processor using asyncio.

Ported from job-processor.ts. Polls for queued batch jobs and processes them
sequentially, handling catalog updates and report generation with progress
tracking, timeout detection, and error classification with retry support.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select, update, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import BatchJob, CatalogBatchHistory, ScheduleRun, UserToken
from ..database import get_session_factory
from ..facebook.catalog import (
    fetch_products_by_retailer_ids,
    batch_update_products,
    check_batch_request_status,
    create_update_request,
)
from ..services.error_classifier import classify_error, calculate_retry_delay

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PROCESSOR_INTERVAL_S = 5
MAX_CONCURRENT_JOBS = 1
BATCH_SIZE = 3000
CONCURRENT_BATCHES = 5
JOB_TIMEOUT_S = 240 * 60  # 240 minutes
STALE_PROGRESS_TIMEOUT_S = 90 * 60  # 90 minutes

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_is_processing = False
_processor_task: Optional[asyncio.Task] = None
_job_progress_cache: dict[int, dict] = {}  # jobId -> {progress, processedItems, statusMessage, updatedAt}


# ---------------------------------------------------------------------------
# DB helper functions
# ---------------------------------------------------------------------------


async def get_batch_job(session: AsyncSession, job_id: int) -> Optional[BatchJob]:
    """Fetch a single batch job by ID."""
    result = await session.execute(select(BatchJob).where(BatchJob.id == job_id))
    return result.scalars().first()


async def update_batch_job(session: AsyncSession, job_id: int, **updates: Any) -> None:
    """Update a batch job with the given fields."""
    await session.execute(
        update(BatchJob).where(BatchJob.id == job_id).values(**updates)
    )
    await session.commit()


async def get_queued_jobs(session: AsyncSession, limit: int = 10) -> list[BatchJob]:
    """Fetch queued jobs ordered by creation time."""
    result = await session.execute(
        select(BatchJob)
        .where(BatchJob.status == "queued")
        .order_by(BatchJob.createdAt.asc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_running_jobs(session: AsyncSession) -> list[BatchJob]:
    """Fetch all currently running jobs."""
    result = await session.execute(
        select(BatchJob).where(BatchJob.status == "running")
    )
    return list(result.scalars().all())


async def get_schedule_run(session: AsyncSession, run_id: int) -> Optional[ScheduleRun]:
    """Fetch a schedule run by ID."""
    result = await session.execute(select(ScheduleRun).where(ScheduleRun.id == run_id))
    return result.scalars().first()


async def update_schedule_run(session: AsyncSession, run_id: int, **updates: Any) -> None:
    """Update a schedule run with the given fields."""
    await session.execute(
        update(ScheduleRun).where(ScheduleRun.id == run_id).values(**updates)
    )
    await session.commit()


async def create_batch_history_record(session: AsyncSession, **fields: Any) -> Optional[int]:
    """Create a catalog batch history record and return its ID."""
    try:
        record = CatalogBatchHistory(**fields)
        session.add(record)
        await session.commit()
        await session.refresh(record)
        return record.id
    except Exception as exc:
        logger.error("Failed to create batch history record: %s", exc)
        await session.rollback()
        return None


async def update_batch_history_record(session: AsyncSession, history_id: int, **updates: Any) -> None:
    """Update a catalog batch history record."""
    await session.execute(
        update(CatalogBatchHistory)
        .where(CatalogBatchHistory.id == history_id)
        .values(**updates)
    )
    await session.commit()


# ---------------------------------------------------------------------------
# DB-op wrappers for report_generator (each creates its own session)
# ---------------------------------------------------------------------------


async def _db_op_update_batch_job(job_id: int, data: dict) -> None:
    async with get_session_factory()() as s:
        await update_batch_job(s, job_id, **data)


async def _db_op_create_saved_report(data: dict):
    from ..models import SavedReport
    async with get_session_factory()() as s:
        report = SavedReport(**data)
        s.add(report)
        await s.commit()
        await s.refresh(report)
        return report.id


async def _db_op_update_saved_report(report_id: int, data: dict) -> None:
    from ..models import SavedReport
    async with get_session_factory()() as s:
        await s.execute(
            update(SavedReport).where(SavedReport.id == report_id).values(**data)
        )
        await s.commit()


async def _db_op_create_batch_history(data: dict):
    async with get_session_factory()() as s:
        return await create_batch_history_record(s, **data)


async def _db_op_update_batch_history(history_id: int, data: dict) -> None:
    async with get_session_factory()() as s:
        await update_batch_history_record(s, history_id, **data)


async def _db_op_get_schedule_run(run_id: int):
    async with get_session_factory()() as s:
        return await get_schedule_run(s, run_id)


async def _db_op_update_schedule_run(run_id: int, data: dict) -> None:
    async with get_session_factory()() as s:
        await update_schedule_run(s, run_id, **data)


async def _db_op_get_batch_job(job_id: int):
    async with get_session_factory()() as s:
        return await get_batch_job(s, job_id)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


async def start_job_processor() -> None:
    """Start the background job processor loop."""
    global _processor_task
    if _processor_task is not None and not _processor_task.done():
        logger.warning("[JobProcessor] Already running")
        return
    _processor_task = asyncio.create_task(_process_loop())
    logger.info("[JobProcessor] Started")


async def stop_job_processor() -> None:
    """Stop the background job processor loop."""
    global _processor_task
    if _processor_task is not None:
        _processor_task.cancel()
        try:
            await _processor_task
        except asyncio.CancelledError:
            pass
        _processor_task = None
        logger.info("[JobProcessor] Stopped")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


async def _process_loop() -> None:
    """Continuous loop that polls for and processes jobs."""
    while True:
        try:
            await _process_jobs()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("[JobProcessor] Unexpected error in process loop: %s", exc, exc_info=True)
        await asyncio.sleep(PROCESSOR_INTERVAL_S)


async def _process_jobs() -> None:
    """Check for timed-out running jobs and pick up queued jobs."""
    global _is_processing
    if _is_processing:
        return
    _is_processing = True

    try:
        session_factory = get_session_factory()

        # ------------------------------------------------------------------
        # 1. Check running jobs for timeouts
        # ------------------------------------------------------------------
        async with session_factory() as session:
            running_jobs = await get_running_jobs(session)

        now = time.time()
        for job in running_jobs:
            started_ts = job.startedAt.timestamp() if job.startedAt else job.createdAt.timestamp()
            elapsed = now - started_ts

            # Skip jobs that just started (< 60 seconds)
            if elapsed < 60:
                continue

            # Absolute timeout
            if elapsed > JOB_TIMEOUT_S:
                logger.warning(
                    "[JobProcessor] Job %d exceeded absolute timeout (%d min), marking failed",
                    job.id, JOB_TIMEOUT_S // 60,
                )
                async with session_factory() as session:
                    await update_batch_job(
                        session, job.id,
                        status="failed",
                        statusMessage=f"Job timed out after {JOB_TIMEOUT_S // 60} minutes",
                        completedAt=datetime.utcnow(),
                    )
                    if job.config and job.config.get("scheduleRunId"):
                        await _mark_schedule_run_failed(
                            session, job.config["scheduleRunId"],
                            f"Job {job.id} timed out",
                        )
                _job_progress_cache.pop(job.id, None)
                continue

            # Stale progress detection
            cached = _job_progress_cache.get(job.id)
            if cached is None:
                # First time seeing this running job — snapshot its state
                _job_progress_cache[job.id] = {
                    "progress": job.progress,
                    "processedItems": job.processedItems,
                    "statusMessage": job.statusMessage,
                    "updatedAt": now,
                }
                continue

            # Check if progress, processedItems, or statusMessage changed
            progress_changed = (
                cached["progress"] != job.progress
                or cached["processedItems"] != job.processedItems
                or cached["statusMessage"] != job.statusMessage
            )
            if progress_changed:
                _job_progress_cache[job.id] = {
                    "progress": job.progress,
                    "processedItems": job.processedItems,
                    "statusMessage": job.statusMessage,
                    "updatedAt": now,
                }
                continue

            # Check in-memory heartbeat from report worker
            try:
                from ..services.report_worker import worker_heartbeats
                last_heartbeat = worker_heartbeats.get(job.id)
                if last_heartbeat and (now - last_heartbeat) < 300:
                    # Worker is alive within last 5 minutes, don't kill
                    continue
            except ImportError:
                pass

            stale_duration = now - cached["updatedAt"]
            if stale_duration > STALE_PROGRESS_TIMEOUT_S:
                logger.warning(
                    "[JobProcessor] Job %d has stale progress for %d min, marking failed",
                    job.id, int(stale_duration / 60),
                )
                async with session_factory() as session:
                    await update_batch_job(
                        session, job.id,
                        status="failed",
                        statusMessage=f"Job stalled — no progress for {int(stale_duration / 60)} minutes",
                        completedAt=datetime.utcnow(),
                    )
                    if job.config and job.config.get("scheduleRunId"):
                        await _mark_schedule_run_failed(
                            session, job.config["scheduleRunId"],
                            f"Job {job.id} stalled",
                        )
                _job_progress_cache.pop(job.id, None)

        # ------------------------------------------------------------------
        # 2. Pick up queued jobs (one at a time)
        # ------------------------------------------------------------------
        async with session_factory() as session:
            running_jobs = await get_running_jobs(session)

        if len(running_jobs) >= MAX_CONCURRENT_JOBS:
            return

        async with session_factory() as session:
            queued_jobs = await get_queued_jobs(session, limit=1)

        for job in queued_jobs:
            await _process_job(job)

    finally:
        _is_processing = False


# ---------------------------------------------------------------------------
# Job dispatcher
# ---------------------------------------------------------------------------


async def _process_job(job: BatchJob) -> None:
    """Route a job to the appropriate handler based on jobType."""
    session_factory = get_session_factory()
    start_time = time.time()
    logger.info("[JobProcessor] Processing job %d (type=%s)", job.id, job.jobType)

    try:
        # Mark as running
        async with session_factory() as session:
            await update_batch_job(
                session, job.id,
                status="running",
                startedAt=datetime.utcnow(),
                statusMessage="Job started",
            )

        if job.jobType in ("catalog_update", "catalog_delete"):
            await _process_catalog_update_job(job, start_time)
        elif job.jobType == "report_generation":
            from ..services.report_generator import process_report_generation_job
            db_ops = {
                "update_batch_job": _db_op_update_batch_job,
                "create_saved_report": _db_op_create_saved_report,
                "update_saved_report": _db_op_update_saved_report,
                "create_batch_history_record": _db_op_create_batch_history,
                "update_batch_history_record": _db_op_update_batch_history,
                "get_schedule_run": _db_op_get_schedule_run,
                "update_schedule_run": _db_op_update_schedule_run,
                "get_batch_job": _db_op_get_batch_job,
            }
            await process_report_generation_job(job, start_time, db_ops)
        else:
            raise ValueError(f"Unknown job type: {job.jobType}")

    except Exception as exc:
        duration_ms = int((time.time() - start_time) * 1000)
        logger.error("[JobProcessor] Job %d failed: %s", job.id, exc, exc_info=True)

        error_info = classify_error({"message": str(exc)})

        async with session_factory() as session:
            await update_batch_job(
                session, job.id,
                status="failed",
                statusMessage=f"Error: {str(exc)[:500]}",
                completedAt=datetime.utcnow(),
            )

            # Update schedule run with retry info if applicable
            schedule_run_id = job.config.get("scheduleRunId") if job.config else None
            if schedule_run_id:
                run = await get_schedule_run(session, schedule_run_id)
                if run:
                    update_fields: dict[str, Any] = {
                        "failedJobs": (run.failedJobs or 0) + 1,
                        "lastErrorType": error_info["type"],
                        "errorMessage": str(exc)[:1000],
                    }

                    all_done = await _check_all_jobs_done(session, schedule_run_id)
                    if all_done:
                        if error_info["retryable"] and run.retryCount < run.maxRetries:
                            retry_delay_ms = calculate_retry_delay(run.retryCount, error_info["type"])
                            from datetime import timedelta
                            update_fields["status"] = "failed"
                            update_fields["nextRetryAt"] = datetime.utcnow() + timedelta(
                                milliseconds=retry_delay_ms
                            )
                            update_fields["completedAt"] = datetime.utcnow()
                            update_fields["durationMs"] = duration_ms
                            logger.info(
                                "[JobProcessor] Schedule run %d will retry in %d ms (attempt %d/%d)",
                                schedule_run_id, retry_delay_ms, run.retryCount + 1, run.maxRetries,
                            )
                        else:
                            update_fields["status"] = "failed"
                            update_fields["completedAt"] = datetime.utcnow()
                            update_fields["durationMs"] = duration_ms

                    await update_schedule_run(session, schedule_run_id, **update_fields)

        _job_progress_cache.pop(job.id, None)


# ---------------------------------------------------------------------------
# Catalog update job
# ---------------------------------------------------------------------------


async def _process_catalog_update_job(job: BatchJob, start_time: float) -> None:
    """Process a catalog update/delete job."""
    session_factory = get_session_factory()
    config = job.config or {}

    catalog_id = config.get("catalogId", "")
    access_token = config.get("accessToken", "")
    retailer_ids: list[str] = config.get("retailerIds", [])
    update_data: dict[str, Any] = config.get("updateData", {})
    custom_label_4_value: Optional[str] = config.get("customLabel4")
    operation_type = "DELETE" if job.jobType == "catalog_delete" else "UPDATE"

    if not catalog_id or not access_token:
        raise ValueError("Missing catalogId or accessToken in job config")

    total_items = len(retailer_ids)

    # Create batch history record
    history_id: Optional[int] = None
    async with session_factory() as session:
        history_id = await create_batch_history_record(
            session,
            userId=job.userId,
            catalogId=catalog_id,
            operationType=operation_type,
            totalItems=total_items,
            batchCount=max(1, (total_items + BATCH_SIZE - 1) // BATCH_SIZE),
            updatedFields=list(update_data.keys()) if update_data else None,
            updateCriteria=config.get("criteria"),
            status="processing",
        )
        if history_id:
            await update_batch_job(session, job.id, historyId=history_id)

    async with session_factory() as session:
        await update_batch_job(
            session, job.id,
            totalItems=total_items,
            statusMessage=f"Fetching {total_items} products from catalog",
            progress=5,
        )

    # ------------------------------------------------------------------
    # Step 1: Fetch existing products to preserve custom_label_4
    # ------------------------------------------------------------------
    existing_products: list[dict[str, Any]] = []
    if custom_label_4_value and retailer_ids:
        existing_products = await fetch_products_by_retailer_ids(
            catalog_id, retailer_ids, access_token
        )

    # Build a lookup map by retailer_id
    product_map: dict[str, dict[str, Any]] = {}
    for product in existing_products:
        rid = product.get("retailer_id")
        if rid:
            product_map[rid] = product

    async with session_factory() as session:
        await update_batch_job(
            session, job.id,
            statusMessage=f"Fetched {len(existing_products)} products, preparing updates",
            progress=20,
        )

    # ------------------------------------------------------------------
    # Step 2: Build batch requests — merge custom_label_4 (append, not overwrite)
    # ------------------------------------------------------------------
    batch_requests = []
    for rid in retailer_ids:
        item_data = dict(update_data) if update_data else {}

        if custom_label_4_value:
            existing = product_map.get(rid, {})
            existing_label = existing.get("custom_label_4", "")

            if existing_label:
                # Append the new value if not already present
                existing_parts = [p.strip() for p in existing_label.split(",") if p.strip()]
                if custom_label_4_value not in existing_parts:
                    existing_parts.append(custom_label_4_value)
                item_data["custom_label_4"] = ", ".join(existing_parts)
            else:
                item_data["custom_label_4"] = custom_label_4_value

        if item_data:
            batch_requests.append(create_update_request(rid, item_data))

    if not batch_requests:
        async with session_factory() as session:
            await update_batch_job(
                session, job.id,
                status="completed",
                progress=100,
                processedItems=0,
                statusMessage="No updates to process",
                completedAt=datetime.utcnow(),
            )
        return

    async with session_factory() as session:
        await update_batch_job(
            session, job.id,
            statusMessage=f"Sending {len(batch_requests)} updates to Facebook",
            progress=40,
            totalBatches=max(1, (len(batch_requests) + BATCH_SIZE - 1) // BATCH_SIZE),
        )

    # ------------------------------------------------------------------
    # Step 3: Send batch updates
    # ------------------------------------------------------------------
    result = await batch_update_products(
        catalog_id, batch_requests, access_token
    )

    async with session_factory() as session:
        await update_batch_job(
            session, job.id,
            statusMessage=f"Batch sent — {result['batchCount']} batches, verifying handles",
            progress=70,
            handles=result["handles"],
        )

    # ------------------------------------------------------------------
    # Step 4: Verify handles
    # ------------------------------------------------------------------
    success_count = 0
    error_count = 0
    warning_count = 0
    all_errors: list[str] = list(result.get("errors", []))

    for handle in result["handles"]:
        try:
            await asyncio.sleep(2)  # Small delay before checking status
            status_resp = await check_batch_request_status(
                catalog_id, handle, access_token
            )
            status_data = status_resp.get("data", [])
            for entry in status_data:
                entry_status = entry.get("status", "")
                errors_total = entry.get("errors_total_count", 0)
                if entry_status == "finished" and errors_total == 0:
                    success_count += 1
                elif errors_total > 0:
                    error_count += errors_total
                    entry_errors = entry.get("errors", [])
                    for err in entry_errors[:5]:
                        all_errors.append(str(err))
        except Exception as exc:
            logger.warning("[JobProcessor] Failed to check handle %s: %s", handle, exc)
            warning_count += 1

    duration_ms = int((time.time() - start_time) * 1000)
    final_status = "completed" if not all_errors else "completed"

    results = {
        "handles": result["handles"],
        "totalProcessed": result["totalProcessed"],
        "batchCount": result["batchCount"],
        "successCount": success_count,
        "errorCount": error_count,
        "warningCount": warning_count,
        "errors": all_errors[:20],  # Cap stored errors
    }

    async with session_factory() as session:
        await update_batch_job(
            session, job.id,
            status=final_status,
            progress=100,
            processedItems=result["totalProcessed"],
            successCount=success_count,
            errorCount=error_count,
            warningCount=warning_count,
            handles=result["handles"],
            errors=all_errors[:20] if all_errors else None,
            statusMessage=f"Completed: {success_count} success, {error_count} errors, {warning_count} warnings",
            completedAt=datetime.utcnow(),
        )

    # Update batch history record
    if history_id:
        async with session_factory() as session:
            await update_batch_history_record(
                session, history_id,
                status="completed",
                successCount=success_count,
                errorCount=error_count,
                warningCount=warning_count,
                handles=result["handles"],
                errors=all_errors[:20] if all_errors else None,
                completedAt=datetime.utcnow(),
                durationMs=duration_ms,
            )

    # Update schedule run if linked
    schedule_run_id = config.get("scheduleRunId")
    if schedule_run_id:
        await _update_schedule_run_from_job(job, results)

    _job_progress_cache.pop(job.id, None)
    logger.info(
        "[JobProcessor] Catalog job %d completed in %d ms — %d processed, %d success, %d errors",
        job.id, duration_ms, result["totalProcessed"], success_count, error_count,
    )


# ---------------------------------------------------------------------------
# Schedule run helpers
# ---------------------------------------------------------------------------


async def _update_schedule_run_from_job(job: BatchJob, results: dict[str, Any]) -> None:
    """Aggregate results from all linked jobs in a schedule run."""
    session_factory = get_session_factory()
    schedule_run_id = job.config.get("scheduleRunId") if job.config else None
    if not schedule_run_id:
        return

    async with session_factory() as session:
        run = await get_schedule_run(session, schedule_run_id)
        if not run:
            return

        job_ids = run.jobIds or []

        # Fetch all jobs in this run to aggregate
        all_jobs_result = await session.execute(
            select(BatchJob).where(BatchJob.id.in_(job_ids))
        )
        all_jobs = list(all_jobs_result.scalars().all())

        completed_jobs = sum(1 for j in all_jobs if j.status == "completed")
        failed_jobs = sum(1 for j in all_jobs if j.status == "failed")
        total_items = sum(j.processedItems or 0 for j in all_jobs)
        catalog_items_updated = sum(
            j.successCount or 0 for j in all_jobs
            if j.jobType in ("catalog_update", "catalog_delete")
        )
        catalog_errors = sum(
            j.errorCount or 0 for j in all_jobs
            if j.jobType in ("catalog_update", "catalog_delete")
        )
        total_spend = sum(
            j.config.get("totalSpend", 0) or 0 for j in all_jobs
            if j.config and j.jobType == "report_generation"
        )
        total_impressions = sum(
            j.config.get("totalImpressions", 0) or 0 for j in all_jobs
            if j.config and j.jobType == "report_generation"
        )

        all_done = all(j.status in ("completed", "failed", "cancelled") for j in all_jobs)

        update_fields: dict[str, Any] = {
            "completedJobs": completed_jobs,
            "failedJobs": failed_jobs,
            "totalItems": total_items,
            "catalogItemsUpdated": catalog_items_updated,
            "catalogErrors": catalog_errors,
        }

        if total_spend:
            update_fields["totalSpend"] = total_spend
        if total_impressions:
            update_fields["totalImpressions"] = total_impressions

        if all_done:
            duration_ms = int(
                (datetime.utcnow().timestamp() - run.startedAt.timestamp()) * 1000
            )
            if failed_jobs == 0:
                update_fields["status"] = "completed"
            elif completed_jobs > 0:
                update_fields["status"] = "partial"
            else:
                update_fields["status"] = "failed"
            update_fields["completedAt"] = datetime.utcnow()
            update_fields["durationMs"] = duration_ms

        await update_schedule_run(session, schedule_run_id, **update_fields)


async def _mark_schedule_run_failed(
    session: AsyncSession, run_id: int, error_message: str
) -> None:
    """Mark a schedule run as failed with an error message."""
    run = await get_schedule_run(session, run_id)
    if not run:
        return
    await update_schedule_run(
        session, run_id,
        status="failed",
        errorMessage=error_message,
        completedAt=datetime.utcnow(),
        durationMs=int((datetime.utcnow().timestamp() - run.startedAt.timestamp()) * 1000),
    )


async def _check_all_jobs_done(session: AsyncSession, schedule_run_id: int) -> bool:
    """Check if all jobs in a schedule run have finished."""
    run = await get_schedule_run(session, schedule_run_id)
    if not run or not run.jobIds:
        return True

    result = await session.execute(
        select(func.count())
        .select_from(BatchJob)
        .where(
            and_(
                BatchJob.id.in_(run.jobIds),
                BatchJob.status.in_(["queued", "running"]),
            )
        )
    )
    active_count = result.scalar() or 0
    return active_count == 0
