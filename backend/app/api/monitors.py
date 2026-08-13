"""Product Set Monitor API."""

import asyncio
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete

from ..database import get_db
from ..models import ProductSetMonitor, ProductSetSnapshot, User
from ..services.monitor import compute_next_run, run_monitor
from ..utils import dt_iso
from .auth import get_current_user

logger = logging.getLogger(__name__)

monitors_router = APIRouter(prefix="/api/monitors", tags=["monitors"])


class CreateMonitorBody(BaseModel):
    name: str
    productSetId: str
    runHour: int = 8
    runMinute: int = 0
    timezone: str = "Asia/Taipei"
    enabled: bool = True


class UpdateMonitorBody(BaseModel):
    name: Optional[str] = None
    productSetId: Optional[str] = None
    runHour: Optional[int] = None
    runMinute: Optional[int] = None
    timezone: Optional[str] = None
    enabled: Optional[bool] = None


def _monitor_to_dict(m: ProductSetMonitor) -> dict[str, Any]:
    return {
        "id": m.id,
        "userId": m.userId,
        "name": m.name,
        "productSetId": m.productSetId,
        "enabled": m.enabled,
        "runHour": m.runHour,
        "runMinute": m.runMinute,
        "timezone": m.timezone,
        "lastRunAt": dt_iso(m.lastRunAt),
        "lastRunStatus": m.lastRunStatus,
        "lastProductCount": m.lastProductCount,
        "lastErrorMessage": m.lastErrorMessage,
        "nextRunAt": dt_iso(m.nextRunAt),
        "createdAt": dt_iso(m.createdAt),
    }


def _snapshot_to_dict(s: ProductSetSnapshot, include_products: bool = False) -> dict[str, Any]:
    # include_products kept for API back-compat; product list is no longer collected.
    return {
        "id": s.id,
        "monitorId": s.monitorId,
        "takenAt": dt_iso(s.takenAt),
        "triggerType": s.triggerType,
        "status": s.status,
        "productCount": s.productCount,
        "errorMessage": s.errorMessage,
        "durationMs": s.durationMs,
    }


@monitors_router.get("")
async def list_monitors(
    user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    rows = (await db.execute(
        select(ProductSetMonitor).where(ProductSetMonitor.userId == user.id).order_by(ProductSetMonitor.id.desc())
    )).scalars().all()
    return {"monitors": [_monitor_to_dict(m) for m in rows]}


@monitors_router.post("")
async def create_monitor(
    body: CreateMonitorBody,
    user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    m = ProductSetMonitor(
        userId=user.id,
        name=body.name.strip(),
        productSetId=body.productSetId.strip(),
        runHour=max(0, min(23, body.runHour)),
        runMinute=max(0, min(59, body.runMinute)),
        timezone=body.timezone,
        enabled=body.enabled,
    )
    m.nextRunAt = compute_next_run(m)
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"monitor": _monitor_to_dict(m)}


@monitors_router.get("/{monitor_id}")
async def get_monitor(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    m = (await db.execute(
        select(ProductSetMonitor).where(ProductSetMonitor.id == monitor_id)
    )).scalar_one_or_none()
    if not m or m.userId != user.id:
        raise HTTPException(404, "Monitor not found")
    return {"monitor": _monitor_to_dict(m)}


@monitors_router.patch("/{monitor_id}")
async def update_monitor(
    monitor_id: int,
    body: UpdateMonitorBody,
    user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    m = (await db.execute(
        select(ProductSetMonitor).where(ProductSetMonitor.id == monitor_id)
    )).scalar_one_or_none()
    if not m or m.userId != user.id:
        raise HTTPException(404, "Monitor not found")
    schedule_changed = False
    for field, value in body.model_dump(exclude_none=True).items():
        if field in ("runHour", "runMinute", "timezone"):
            schedule_changed = True
        setattr(m, field, value)
    if schedule_changed:
        m.nextRunAt = compute_next_run(m)
    await db.commit()
    await db.refresh(m)
    return {"monitor": _monitor_to_dict(m)}


@monitors_router.delete("/{monitor_id}")
async def delete_monitor(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    m = (await db.execute(
        select(ProductSetMonitor).where(ProductSetMonitor.id == monitor_id)
    )).scalar_one_or_none()
    if not m or m.userId != user.id:
        raise HTTPException(404, "Monitor not found")
    await db.execute(delete(ProductSetSnapshot).where(ProductSetSnapshot.monitorId == monitor_id))
    await db.execute(delete(ProductSetMonitor).where(ProductSetMonitor.id == monitor_id))
    await db.commit()
    return {"ok": True}


async def _safe_run_monitor(monitor_id: int) -> None:
    """Wrapper so background-task exceptions are logged instead of swallowed."""
    try:
        logger.info("[Monitor %d] manual run starting", monitor_id)
        snap_id = await run_monitor(monitor_id, trigger_type="manual")
        logger.info("[Monitor %d] manual run completed, snapshot=%d", monitor_id, snap_id)
    except Exception as exc:
        logger.error("[Monitor %d] manual run failed: %s", monitor_id, exc, exc_info=True)


@monitors_router.post("/{monitor_id}/run")
async def run_monitor_now(
    monitor_id: int,
    user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    m = (await db.execute(
        select(ProductSetMonitor).where(ProductSetMonitor.id == monitor_id)
    )).scalar_one_or_none()
    if not m or m.userId != user.id:
        raise HTTPException(404, "Monitor not found")
    asyncio.create_task(_safe_run_monitor(monitor_id))
    return {"ok": True, "message": "Triggered; check snapshots in a moment"}


@monitors_router.get("/{monitor_id}/snapshots")
async def list_snapshots(
    monitor_id: int,
    limit: int = 50,
    user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    m = (await db.execute(
        select(ProductSetMonitor).where(ProductSetMonitor.id == monitor_id)
    )).scalar_one_or_none()
    if not m or m.userId != user.id:
        raise HTTPException(404, "Monitor not found")
    rows = (await db.execute(
        select(ProductSetSnapshot)
        .where(ProductSetSnapshot.monitorId == monitor_id)
        .order_by(ProductSetSnapshot.takenAt.desc())
        .limit(limit)
    )).scalars().all()
    return {"snapshots": [_snapshot_to_dict(s, include_products=False) for s in rows]}


@monitors_router.get("/{monitor_id}/snapshots/{snapshot_id}")
async def get_snapshot(
    monitor_id: int,
    snapshot_id: int,
    user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    m = (await db.execute(
        select(ProductSetMonitor).where(ProductSetMonitor.id == monitor_id)
    )).scalar_one_or_none()
    if not m or m.userId != user.id:
        raise HTTPException(404, "Monitor not found")
    s = (await db.execute(
        select(ProductSetSnapshot).where(
            ProductSetSnapshot.id == snapshot_id,
            ProductSetSnapshot.monitorId == monitor_id,
        )
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Snapshot not found")
    return {"snapshot": _snapshot_to_dict(s, include_products=True)}
