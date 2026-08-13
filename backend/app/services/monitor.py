"""Product Set Monitor service — fetch FB product set, persist snapshot with diff."""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select, update

from ..database import get_session_factory
from ..facebook.product_set import fetch_product_set_count
from ..models import ProductSetMonitor, ProductSetSnapshot, UserToken

logger = logging.getLogger(__name__)


async def _get_access_token(user_id: int) -> Optional[str]:
    factory = get_session_factory()
    async with factory() as s:
        for token_type in ("catalog_management", "ads_management"):
            row = (await s.execute(
                select(UserToken).where(
                    UserToken.userId == user_id,
                    UserToken.tokenType == token_type,
                )
            )).scalar_one_or_none()
            if row and row.accessToken:
                return row.accessToken
    return None


async def run_monitor(monitor_id: int, *, trigger_type: str = "auto") -> int:
    """Run a monitor: fetch products, diff vs last snapshot, persist."""
    start = time.time()
    factory = get_session_factory()
    async with factory() as s:
        m = (await s.execute(
            select(ProductSetMonitor).where(ProductSetMonitor.id == monitor_id)
        )).scalar_one_or_none()
        if not m:
            raise ValueError(f"Monitor {monitor_id} not found")
        user_id = m.userId
        product_set_id = m.productSetId

    access_token = await _get_access_token(user_id)
    if not access_token:
        await _finalize(monitor_id, "failed", "No access token configured", start)
        raise RuntimeError("No access token for user")

    try:
        count = await fetch_product_set_count(product_set_id, access_token)
    except Exception as e:
        logger.warning("Monitor %d count failed: %s", monitor_id, e)
        await _finalize(monitor_id, "failed", str(e), start)
        async with factory() as s:
            snap = ProductSetSnapshot(
                monitorId=monitor_id,
                triggerType=trigger_type,
                status="failed",
                errorMessage=str(e),
                durationMs=int((time.time() - start) * 1000),
            )
            s.add(snap)
            await s.commit()
            await s.refresh(snap)
            return snap.id

    # Delta vs previous snapshot (count only)
    async with factory() as s:
        prev = (await s.execute(
            select(ProductSetSnapshot)
            .where(
                ProductSetSnapshot.monitorId == monitor_id,
                ProductSetSnapshot.status == "completed",
            )
            .order_by(ProductSetSnapshot.takenAt.desc())
            .limit(1)
        )).scalar_one_or_none()
    prev_count = prev.productCount if prev and prev.productCount is not None else None

    duration_ms = int((time.time() - start) * 1000)
    async with factory() as s:
        snap = ProductSetSnapshot(
            monitorId=monitor_id,
            triggerType=trigger_type,
            status="completed",
            productCount=count,
            durationMs=duration_ms,
        )
        s.add(snap)
        await s.commit()
        await s.refresh(snap)
        snap_id = snap.id

    await _finalize(monitor_id, "completed", None, start, product_count=count)
    delta_str = "" if prev_count is None else f" (delta {count - prev_count:+d})"
    logger.info(
        "Monitor %d snapshot %d: %d products%s in %dms",
        monitor_id, snap_id, count, delta_str, duration_ms,
    )
    return snap_id


async def _finalize(
    monitor_id: int, status: str, error: Optional[str], start: float,
    product_count: Optional[int] = None,
) -> None:
    factory = get_session_factory()
    async with factory() as s:
        values: dict = {
            "lastRunAt": datetime.utcnow(),
            "lastRunStatus": status,
            "lastErrorMessage": error,
        }
        if product_count is not None:
            values["lastProductCount"] = product_count
        # Compute next run
        m = (await s.execute(
            select(ProductSetMonitor).where(ProductSetMonitor.id == monitor_id)
        )).scalar_one_or_none()
        if m:
            values["nextRunAt"] = compute_next_run(m)
        await s.execute(
            update(ProductSetMonitor)
            .where(ProductSetMonitor.id == monitor_id)
            .values(**values)
        )
        await s.commit()


def compute_next_run(m: ProductSetMonitor) -> datetime:
    """Next daily run in UTC-naive datetime."""
    try:
        tz = ZoneInfo(m.timezone or "UTC")
    except Exception:
        tz = ZoneInfo("UTC")
    now_local = datetime.now(tz)
    candidate = now_local.replace(hour=m.runHour, minute=m.runMinute, second=0, microsecond=0)
    if candidate <= now_local:
        candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Scheduler tick — called by scheduler.py daily loop
# ---------------------------------------------------------------------------


async def tick_due_monitors() -> int:
    """Check enabled monitors with nextRunAt <= now, run each. Returns count run."""
    factory = get_session_factory()
    now = datetime.utcnow()
    async with factory() as s:
        rows = (await s.execute(
            select(ProductSetMonitor).where(
                ProductSetMonitor.enabled.is_(True),
            )
        )).scalars().all()
    due = [r for r in rows if r.nextRunAt is None or r.nextRunAt <= now]
    for r in due:
        try:
            await run_monitor(r.id, trigger_type="auto")
        except Exception as e:
            logger.warning("Monitor %d auto-run failed: %s", r.id, e)
    return len(due)
