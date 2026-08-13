import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_session_factory
from ..models import BatchJob, ScheduledJob, ScheduleRun
from ..utils import dt_iso

logger = logging.getLogger(__name__)
agent_router = APIRouter(prefix="/api/agent")


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

async def verify_agent_token(request: Request) -> None:
    """Validate Bearer token against settings.agent_api_key."""
    if not settings.agent_api_key:
        raise HTTPException(status_code=503, detail="Agent API key not configured")

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    token = auth[len("Bearer "):]
    if token != settings.agent_api_key:
        raise HTTPException(status_code=403, detail="Invalid API key")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_schedule_dict(s: ScheduledJob) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "cronExpression": s.cronExpression,
        "timezone": s.timezone,
        "enabled": s.enabled,
        "jobType": s.jobType,
        "lastRunAt": dt_iso(s.lastRunAt),
        "lastRunStatus": s.lastRunStatus,
        "nextRunAt": dt_iso(s.nextRunAt),
    }


def _row_to_job_dict(j: BatchJob) -> dict:
    return {
        "id": j.id,
        "jobType": j.jobType,
        "status": j.status,
        "progress": j.progress,
        "processedItems": j.processedItems,
        "totalItems": j.totalItems,
        "successCount": j.successCount,
        "errorCount": j.errorCount,
        "statusMessage": j.statusMessage,
        "queuedAt": dt_iso(j.queuedAt),
        "startedAt": dt_iso(j.startedAt),
        "completedAt": dt_iso(j.completedAt),
    }


def _row_to_run_dict(r: ScheduleRun) -> dict:
    return {
        "id": r.id,
        "scheduleId": r.scheduleId,
        "triggerType": r.triggerType,
        "status": r.status,
        "totalJobs": r.totalJobs,
        "completedJobs": r.completedJobs,
        "failedJobs": r.failedJobs,
        "jobIds": r.jobIds,
        "errorMessage": r.errorMessage,
        "startedAt": dt_iso(r.startedAt),
        "completedAt": dt_iso(r.completedAt),
        "durationMs": r.durationMs,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@agent_router.get("/schedules", dependencies=[Depends(verify_agent_token)])
async def list_schedules():
    """List all enabled schedules."""
    factory = get_session_factory()
    async with factory() as session:
        result = await session.execute(
            select(ScheduledJob).where(ScheduledJob.enabled == True)  # noqa: E712
        )
        schedules = result.scalars().all()
        return {"schedules": [_row_to_schedule_dict(s) for s in schedules]}


@agent_router.post("/trigger/{schedule_id}", dependencies=[Depends(verify_agent_token)])
async def trigger_schedule(schedule_id: int):
    """Manually trigger a scheduled job run."""
    factory = get_session_factory()
    async with factory() as session:
        result = await session.execute(
            select(ScheduledJob).where(ScheduledJob.id == schedule_id)
        )
        schedule = result.scalars().first()
        if not schedule:
            raise HTTPException(status_code=404, detail="Schedule not found")
        if not schedule.enabled:
            raise HTTPException(status_code=400, detail="Schedule is disabled")

    # Import here to avoid circular imports
    from ..services.scheduler import process_scheduled_job

    await process_scheduled_job(schedule, "manual")

    # Fetch the latest run created by the trigger
    async with factory() as session:
        result = await session.execute(
            select(ScheduleRun)
            .where(ScheduleRun.scheduleId == schedule_id)
            .order_by(ScheduleRun.id.desc())
            .limit(1)
        )
        run = result.scalars().first()
        if not run:
            return {"ok": True, "message": "Triggered but no run found yet"}

        return {
            "ok": True,
            "runId": run.id,
            "jobIds": run.jobIds or [],
        }


@agent_router.get("/status/{run_id}", dependencies=[Depends(verify_agent_token)])
async def get_run_status(run_id: int):
    """Get run status with batch job details."""
    factory = get_session_factory()
    async with factory() as session:
        result = await session.execute(
            select(ScheduleRun).where(ScheduleRun.id == run_id)
        )
        run = result.scalars().first()
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")

        jobs = []
        for job_id in (run.jobIds or []):
            job_result = await session.execute(
                select(BatchJob).where(BatchJob.id == job_id)
            )
            job = job_result.scalars().first()
            if job:
                jobs.append(_row_to_job_dict(job))

        return {
            "run": _row_to_run_dict(run),
            "jobs": jobs,
        }


@agent_router.get("/latest/{schedule_id}", dependencies=[Depends(verify_agent_token)])
async def get_latest_run(schedule_id: int):
    """Get the latest run for a schedule."""
    factory = get_session_factory()
    async with factory() as session:
        result = await session.execute(
            select(ScheduleRun)
            .where(ScheduleRun.scheduleId == schedule_id)
            .order_by(ScheduleRun.id.desc())
            .limit(1)
        )
        run = result.scalars().first()
        if not run:
            raise HTTPException(status_code=404, detail="No runs found for this schedule")

        jobs = []
        for job_id in (run.jobIds or []):
            job_result = await session.execute(
                select(BatchJob).where(BatchJob.id == job_id)
            )
            job = job_result.scalars().first()
            if job:
                jobs.append(_row_to_job_dict(job))

        return {
            "run": _row_to_run_dict(run),
            "jobs": jobs,
        }


@agent_router.post("/cancel/{job_id}", dependencies=[Depends(verify_agent_token)])
async def cancel_job(job_id: int):
    """Cancel a running or queued batch job."""
    factory = get_session_factory()
    async with factory() as session:
        result = await session.execute(
            select(BatchJob).where(BatchJob.id == job_id)
        )
        job = result.scalars().first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if job.status not in ("queued", "running"):
            raise HTTPException(
                status_code=400,
                detail=f"Job is already {job.status}, cannot cancel",
            )

        await session.execute(
            update(BatchJob)
            .where(BatchJob.id == job_id)
            .values(
                status="failed",
                statusMessage="Cancelled via Agent API",
                completedAt=datetime.now(timezone.utc),
            )
        )

        # Update associated schedule_run if exists
        run_result = await session.execute(
            select(ScheduleRun).where(ScheduleRun.jobIds.contains(str(job_id)))
        )
        # Fallback: search all runs that reference this job
        all_runs_result = await session.execute(select(ScheduleRun))
        for run in all_runs_result.scalars().all():
            if run.jobIds and job_id in run.jobIds:
                await session.execute(
                    update(ScheduleRun)
                    .where(ScheduleRun.id == run.id)
                    .values(
                        status="failed",
                        errorMessage=f"Job {job_id} cancelled via Agent API",
                        completedAt=datetime.now(timezone.utc),
                    )
                )
                break

        await session.commit()
        return {"ok": True, "message": f"Job {job_id} cancelled"}


@agent_router.get("/keepalive", dependencies=[Depends(verify_agent_token)])
async def keepalive():
    """Lightweight ping that returns running job summary."""
    factory = get_session_factory()
    async with factory() as session:
        result = await session.execute(
            select(BatchJob).where(BatchJob.status.in_(["queued", "running"]))
        )
        jobs = result.scalars().all()
        return {
            "ok": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "runningJobs": len([j for j in jobs if j.status == "running"]),
            "queuedJobs": len([j for j in jobs if j.status == "queued"]),
            "jobs": [
                {
                    "id": j.id,
                    "jobType": j.jobType,
                    "status": j.status,
                    "progress": j.progress,
                    "updatedAt": dt_iso(j.updatedAt),
                }
                for j in jobs
            ],
        }


@agent_router.post("/recover", dependencies=[Depends(verify_agent_token)])
async def recover_stale_jobs():
    """Clean up stale jobs that have been running/queued too long."""
    STALE_THRESHOLD_S = 10 * 60  # 10 minutes
    now = time.time()
    recovered = []

    factory = get_session_factory()
    async with factory() as session:
        result = await session.execute(
            select(BatchJob).where(BatchJob.status.in_(["queued", "running"]))
        )
        jobs = result.scalars().all()

        for job in jobs:
            updated_ts = job.updatedAt.replace(tzinfo=timezone.utc).timestamp() if job.updatedAt else 0
            if now - updated_ts > STALE_THRESHOLD_S:
                await session.execute(
                    update(BatchJob)
                    .where(BatchJob.id == job.id)
                    .values(
                        status="failed",
                        statusMessage=f"Recovered: stale after {STALE_THRESHOLD_S}s (was {job.status})",
                        completedAt=datetime.now(timezone.utc),
                    )
                )
                recovered.append(job.id)
                logger.warning(f"[Agent] Recovered stale job {job.id} (was {job.status})")

                # Update associated schedule runs
                all_runs_result = await session.execute(select(ScheduleRun).where(ScheduleRun.status == "running"))
                for run in all_runs_result.scalars().all():
                    if run.jobIds and job.id in run.jobIds:
                        await session.execute(
                            update(ScheduleRun)
                            .where(ScheduleRun.id == run.id)
                            .values(
                                status="failed",
                                errorMessage=f"Job {job.id} recovered as stale",
                                completedAt=datetime.now(timezone.utc),
                            )
                        )

        await session.commit()

    return {
        "ok": True,
        "recoveredCount": len(recovered),
        "recoveredJobIds": recovered,
    }
