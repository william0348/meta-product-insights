import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, update, delete, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    User,
    UserToken,
    CatalogBatchHistory,
    BatchJob,
    SavedReport,
    ScheduledJob,
    ScheduleRun,
)
from .auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Pydantic request / response models
# ---------------------------------------------------------------------------


class TokenSaveRequest(BaseModel):
    tokenType: str
    accessToken: str
    catalogId: Optional[str] = None
    adAccountId: Optional[str] = None
    minSpend: Optional[str] = None
    minCTR: Optional[str] = None
    maxSpend: Optional[str] = None
    maxCVR: Optional[str] = None
    batchSize: Optional[int] = None


class CatalogFetchRequest(BaseModel):
    catalogId: str
    retailerIds: list[str]
    accessToken: str


class CatalogBatchUpdateRequest(BaseModel):
    catalogId: str
    requests: list[dict]
    accessToken: str
    updateCriteria: Optional[dict] = None


class BatchStatusRequest(BaseModel):
    catalogId: str
    handle: str
    accessToken: str
    loadInvalidIds: bool = False


class JobSubmitRequest(BaseModel):
    jobType: str
    config: dict


class ReportGenerateRequest(BaseModel):
    adAccountId: str
    accessToken: str
    dateStart: str
    dateEnd: str
    level: Optional[str] = None
    breakdown: Optional[str] = None
    minSpend: Optional[str] = None
    minCTR: Optional[str] = None
    maxSpend: Optional[str] = None
    maxCVR: Optional[str] = None


class ScheduleCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    jobType: str
    cronExpression: str
    timezone: str = "Asia/Taipei"
    config: dict
    reportConfigs: list[dict]


class ScheduleUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    jobType: Optional[str] = None
    cronExpression: Optional[str] = None
    timezone: Optional[str] = None
    config: Optional[dict] = None
    reportConfigs: Optional[list[dict]] = None
    enabled: Optional[bool] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _row_to_dict(obj: Any) -> dict:
    """Convert a SQLAlchemy model instance to a plain dict."""
    d: dict[str, Any] = {}
    for c in obj.__table__.columns:
        val = getattr(obj, c.name)
        if isinstance(val, datetime):
            val = val.isoformat()
        d[c.name] = val
    return d


# ===================================================================
# SYSTEM
# ===================================================================


@router.get("/health")
async def health():
    return {"ok": True}


@router.post("/cleanup-jobs")
async def cleanup_jobs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Clean up stuck running/queued jobs by marking them as failed."""
    from sqlalchemy import text
    r1 = await db.execute(text("UPDATE batch_jobs SET status='failed', statusMessage='Cleaned up' WHERE status IN ('running', 'queued')"))
    await db.commit()
    return {"success": True, "cleaned": r1.rowcount}


@router.post("/migrate-user")
async def migrate_user(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """One-time migration: update all old user data to the new default user."""
    from sqlalchemy import text
    new_id = user.id
    tables = ["user_tokens", "batch_jobs", "saved_reports", "scheduled_jobs", "schedule_runs", "catalog_batch_history"]
    results = {}
    for table in tables:
        r = await db.execute(text(f"UPDATE {table} SET userId = :new_id WHERE userId != :new_id"), {"new_id": new_id})
        await db.commit()
        results[table] = r.rowcount
    return {"success": True, "migrated": results, "newUserId": new_id}


# ===================================================================
# AUTH
# ===================================================================


@router.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    return _row_to_dict(user)


@router.post("/auth/logout")
async def auth_logout(user: User = Depends(get_current_user)):
    return {"success": True}


# ===================================================================
# TOKENS
# ===================================================================


@router.post("/tokens")
async def save_token(
    body: TokenSaveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserToken).where(
            UserToken.userId == user.id,
            UserToken.tokenType == body.tokenType,
        ).limit(1)
    )
    existing = result.scalars().first()

    if existing:
        existing.accessToken = body.accessToken
        existing.catalogId = body.catalogId
        existing.adAccountId = body.adAccountId
        existing.minSpend = body.minSpend
        existing.minCTR = body.minCTR
        existing.maxSpend = body.maxSpend
        existing.maxCVR = body.maxCVR
        existing.batchSize = body.batchSize
        await db.commit()
    else:
        token = UserToken(
            userId=user.id,
            tokenType=body.tokenType,
            accessToken=body.accessToken,
            catalogId=body.catalogId,
            adAccountId=body.adAccountId,
            minSpend=body.minSpend,
            minCTR=body.minCTR,
            maxSpend=body.maxSpend,
            maxCVR=body.maxCVR,
            batchSize=body.batchSize,
        )
        db.add(token)
        await db.commit()
    return {"success": True}


@router.get("/tokens/{token_type}")
async def get_token(
    token_type: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserToken).where(
            UserToken.userId == user.id,
            UserToken.tokenType == token_type,
        ).limit(1)
    )
    token = result.scalars().first()
    if not token:
        return {
            "found": False,
            "accessToken": None,
            "catalogId": None,
            "adAccountId": None,
            "minSpend": None,
            "minCTR": None,
            "maxSpend": None,
            "maxCVR": None,
            "batchSize": None,
        }
    d = _row_to_dict(token)
    d["found"] = True
    return d


@router.delete("/tokens/{token_type}")
async def delete_token(
    token_type: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserToken).where(
            UserToken.userId == user.id,
            UserToken.tokenType == token_type,
        ).limit(1)
    )
    token = result.scalars().first()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    await db.delete(token)
    await db.commit()
    return {"success": True}


# ===================================================================
# CATALOG
# ===================================================================


@router.post("/catalog/fetch")
async def catalog_fetch(
    body: CatalogFetchRequest,
    user: User = Depends(get_current_user),
):
    from ..facebook.catalog import fetch_products_by_retailer_ids

    try:
        products = await fetch_products_by_retailer_ids(
            catalog_id=body.catalogId,
            retailer_ids=body.retailerIds,
            access_token=body.accessToken,
        )
        return {"products": products, "total": len(products)}
    except Exception as e:
        logger.exception("[catalog/fetch] Error")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/catalog/batch-update")
async def catalog_batch_update(
    body: CatalogBatchUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from ..facebook.catalog import batch_update_products

    # Create history record
    history = CatalogBatchHistory(
        userId=user.id,
        catalogId=body.catalogId,
        operationType="UPDATE",
        totalItems=len(body.requests),
        batchCount=0,
        updateCriteria=body.updateCriteria,
        status="processing",
        startedAt=datetime.utcnow(),
    )
    db.add(history)
    await db.commit()
    await db.refresh(history)

    start_time = datetime.utcnow()
    try:
        result = await batch_update_products(
            catalog_id=body.catalogId,
            requests=body.requests,
            access_token=body.accessToken,
        )

        error_count = len(result.errors) if result.errors else 0
        warning_count = 0
        # Count warnings from validation_status if available
        if hasattr(result, "validation_status") and result.validation_status:
            for vs in result.validation_status:
                if isinstance(vs, dict) and vs.get("status") == "warning":
                    warning_count += 1

        elapsed = (datetime.utcnow() - start_time).total_seconds() * 1000

        history.status = "completed" if result.success else "failed"
        history.batchCount = result.batchCount
        history.successCount = result.totalProcessed - error_count
        history.errorCount = error_count
        history.warningCount = warning_count
        history.handles = result.handles
        history.errors = result.errors if result.errors else None
        history.completedAt = datetime.utcnow()
        history.durationMs = int(elapsed)
        await db.commit()
        await db.refresh(history)

        return _row_to_dict(history)
    except Exception as e:
        logger.exception("[catalog/batch-update] Error")
        history.status = "failed"
        history.errors = [{"message": str(e)}]
        history.completedAt = datetime.utcnow()
        elapsed = (datetime.utcnow() - start_time).total_seconds() * 1000
        history.durationMs = int(elapsed)
        await db.commit()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/catalog/batch-status")
async def catalog_batch_status(
    catalogId: str = Query(...),
    handle: str = Query(...),
    accessToken: str = Query(...),
    loadInvalidIds: bool = Query(False),
):
    """Check the status of a batch request using the Graph API."""
    url = f"https://graph.facebook.com/v25.0/{catalogId}/check_batch_request_status"
    params: dict[str, Any] = {
        "handle": handle,
        "load_ids_of_invalid_requests": str(loadInvalidIds).lower(),
        "access_token": accessToken,
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        logger.error("[catalog/batch-status] HTTP %s: %s", e.response.status_code, e.response.text)
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        logger.exception("[catalog/batch-status] Error")
        raise HTTPException(status_code=500, detail=str(e))


# ===================================================================
# BATCH HISTORY
# ===================================================================


@router.get("/batch-history")
async def get_batch_history(
    limit: int = Query(50),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CatalogBatchHistory)
        .where(CatalogBatchHistory.userId == user.id)
        .order_by(desc(CatalogBatchHistory.createdAt))
        .limit(limit)
    )
    rows = result.scalars().all()
    return {"success": True, "history": [_row_to_dict(r) for r in rows]}


@router.get("/batch-history/all")
async def get_all_batch_history(
    limit: int = Query(100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CatalogBatchHistory)
        .order_by(desc(CatalogBatchHistory.createdAt))
        .limit(limit)
    )
    rows = result.scalars().all()
    return [_row_to_dict(r) for r in rows]


@router.get("/batch-history/catalog/{catalog_id}")
async def get_batch_history_by_catalog(
    catalog_id: str,
    limit: int = Query(50),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CatalogBatchHistory)
        .where(CatalogBatchHistory.catalogId == catalog_id)
        .order_by(desc(CatalogBatchHistory.createdAt))
        .limit(limit)
    )
    rows = result.scalars().all()
    return [_row_to_dict(r) for r in rows]


# ===================================================================
# JOBS
# ===================================================================


@router.post("/jobs")
async def submit_job(
    body: JobSubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = BatchJob(
        userId=user.id,
        jobType=body.jobType,
        config=body.config,
        status="queued",
        queuedAt=datetime.utcnow(),
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return {"success": True, "jobId": job.id, "message": f"Job queued with ID {job.id}"}


@router.get("/jobs")
async def get_jobs(
    limit: int = Query(20),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(BatchJob)
        .where(BatchJob.userId == user.id)
        .order_by(desc(BatchJob.createdAt))
        .limit(limit)
    )
    rows = result.scalars().all()
    # Summary view: exclude large fields
    summaries = []
    for r in rows:
        d = _row_to_dict(r)
        d.pop("errors", None)
        d.pop("config", None)
        summaries.append(d)
    return summaries


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(BatchJob).where(BatchJob.id == job_id))
    job = result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    d = _row_to_dict(job)
    if d.get("errors") and isinstance(d["errors"], list):
        d["errors"] = d["errors"][-10:]
    return {"found": True, "job": d}


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(BatchJob).where(BatchJob.id == job_id))
    job = result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if job.status not in ("queued", "running"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel job with status '{job.status}'")

    job.status = "cancelled"
    job.completedAt = datetime.utcnow()
    job.statusMessage = "Cancelled by user"
    await db.commit()
    await db.refresh(job)
    return _row_to_dict(job)


# ===================================================================
# FACEBOOK INSIGHTS (direct proxy)
# ===================================================================


# In-memory cache for downloaded report data (avoids re-downloading CSV)
_report_cache: dict[str, list[dict]] = {}  # reportRunId -> raw rows


@router.get("/facebook/insights/refilter")
async def refilter_insights(
    reportRunId: str = Query(...),
    minSpend: Optional[float] = Query(None),
    minCTR: Optional[float] = Query(None),
    maxSpend: Optional[float] = Query(None),
    maxCVR: Optional[float] = Query(None),
    maxResults: int = Query(50000),
):
    """Re-filter cached report data without re-downloading from Facebook."""
    if reportRunId not in _report_cache:
        raise HTTPException(status_code=404, detail="Report not cached. Fetch it first with fetchAll=true.")

    all_data = _report_cache[reportRunId]
    raw_count = len(all_data)

    def _pf(val):
        if val is None or val == "" or val == "-":
            return 0.0
        try:
            return float(str(val).replace("$", "").replace(",", ""))
        except (ValueError, TypeError):
            return 0.0

    def _get(row, *keys):
        for k in keys:
            v = row.get(k)
            if v is not None:
                return v
        return 0

    filtered = []
    for row in all_data:
        spend = _pf(_get(row, "spend", "Product amount spent", "Spend"))
        ctr = _pf(_get(row, "inline_link_click_ctr", "CTR (link click-through rate)"))
        link_clicks = _pf(_get(row, "inline_link_clicks", "Product link clicks", "Link clicks"))
        cat_purch = _pf(_get(row, "converted_product_omni_purchase", "Product purchases"))
        cvr = (cat_purch / link_clicks * 100) if link_clicks > 0 else 0

        if minSpend is not None and spend < minSpend:
            continue
        if minCTR is not None and ctr < minCTR:
            continue
        if maxSpend is not None and spend > maxSpend:
            continue
        if maxCVR is not None and cvr > maxCVR:
            continue
        filtered.append(row)

    total_filtered = len(filtered)
    if total_filtered > maxResults:
        filtered = filtered[:maxResults]

    logger.info("[facebook/insights/refilter] %s: %d -> %d rows (cap=%d)", reportRunId, raw_count, total_filtered, maxResults)
    return {"data": filtered, "totalRecords": len(filtered), "rawRecords": raw_count, "totalFiltered": total_filtered}


@router.get("/facebook/insights")
async def facebook_insights(
    reportRunId: str = Query(...),
    accessToken: str = Query(...),
    limit: int = Query(5000),
    after: Optional[str] = Query(None),
    fetchAll: bool = Query(False),
    minSpend: Optional[float] = Query(None),
    minCTR: Optional[float] = Query(None),
    maxSpend: Optional[float] = Query(None),
    maxCVR: Optional[float] = Query(None),
):
    """Fetch insights data. If fetchAll=true, fetches ALL pages server-side, filters in Python, and returns combined result."""
    base_url = f"https://graph.facebook.com/v25.0/{reportRunId}/insights"

    if not fetchAll:
        params: dict[str, Any] = {"access_token": accessToken, "limit": limit}
        if after:
            params["after"] = after
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(base_url, params=params)
            resp.raise_for_status()
            return resp.json()

    # fetchAll mode: download CSV directly from Facebook (much faster than paginated JSON)
    import csv
    import io

    # FB's documented CSV download endpoint per
    # https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/products
    # The www.facebook.com/.../export_report path requires browser cookies and
    # returns an HTML login page with just an OAuth token, so it's omitted.
    download_url = (
        f"https://lookaside.facebook.com/ads/ads_insights/download_report/business/"
        f"?report_run_id={reportRunId}&access_token={accessToken}"
    )

    all_data: list = []
    raw_count = 0

    async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
        csv_text = None
        for url in [download_url]:
            for attempt in range(4):
                try:
                    logger.info("[facebook/insights] Downloading CSV from %s (attempt %d/4)...", url[:80], attempt + 1)
                    resp = await client.get(url)
                    if resp.status_code == 200 and len(resp.text) > 100:
                        # FB returns an HTML login/error page when access_token is
                        # rejected by the export_report endpoint. Detect and treat
                        # as failure so the JSON fallback can run.
                        content_type = resp.headers.get("content-type", "").lower()
                        text_head = resp.text.lstrip()[:200].lower()
                        if "text/html" in content_type or text_head.startswith("<"):
                            logger.warning(
                                "[facebook/insights] CSV endpoint returned HTML (likely auth error). "
                                "First 200 chars: %s",
                                resp.text[:200],
                            )
                            continue
                        csv_text = resp.text
                        logger.info("[facebook/insights] CSV downloaded: %d bytes", len(csv_text))
                        break
                    if resp.status_code == 500:
                        wait = 30 * (attempt + 1)
                        logger.warning(
                            "[facebook/insights] CSV download 500, waiting %ds (attempt %d/4)",
                            wait, attempt + 1,
                        )
                        await asyncio.sleep(wait)
                    else:
                        logger.warning("[facebook/insights] CSV download returned status %d, size %d", resp.status_code, len(resp.text))
                        await asyncio.sleep(5)
                except Exception as e:
                    logger.warning("[facebook/insights] CSV download error: %s", e)
                    if attempt < 3:
                        await asyncio.sleep(2 ** attempt)
            if csv_text:
                break

        if not csv_text:
            # Fallback to paginated JSON if CSV download fails
            logger.warning("[facebook/insights] CSV download failed, falling back to paginated JSON")
            cursor = after
            page = 0
            page_limit = min(limit, 500)
            async with httpx.AsyncClient(timeout=120) as json_client:
                while True:
                    p = {"access_token": accessToken, "limit": page_limit}
                    if cursor:
                        p["after"] = cursor
                    for attempt in range(4):
                        try:
                            resp = await json_client.get(base_url, params=p)
                            resp.raise_for_status()
                            break
                        except Exception:
                            if attempt < 3:
                                await asyncio.sleep(2 ** attempt)
                                continue
                            raise
                    body = resp.json()
                    rows = body.get("data", [])
                    all_data.extend(rows)
                    page += 1
                    logger.info("[facebook/insights] Fallback page %d: %d rows (total: %d)", page, len(rows), len(all_data))
                    paging = body.get("paging", {})
                    if not paging.get("next") or not paging.get("cursors", {}).get("after"):
                        break
                    cursor = paging["cursors"]["after"]
        else:
            # Parse CSV
            reader = csv.DictReader(io.StringIO(csv_text))
            all_data = list(reader)
            if all_data:
                logger.info("[facebook/insights] CSV columns: %s", list(all_data[0].keys())[:15])
            logger.info("[facebook/insights] CSV parsed: %d rows", len(all_data))

    raw_count = len(all_data)

    # Cache raw data for instant re-filtering
    _report_cache[reportRunId] = all_data
    logger.info("[facebook/insights] Cached %d rows for report %s", raw_count, reportRunId)

    if all_data:
        first = all_data[0]
        logger.info("[facebook/insights] First row keys: %s", list(first.keys()) if isinstance(first, dict) else type(first))
        logger.info("[facebook/insights] First row sample: %s", {k: first.get(k) for k in list(first.keys())[:10]} if isinstance(first, dict) else str(first)[:200])

    def _pf(val):
        if val is None or val == "":
            return 0.0
        try:
            return float(str(val).replace("$", "").replace(",", ""))
        except (ValueError, TypeError):
            return 0.0

    def _get(row, *keys):
        for k in keys:
            v = row.get(k)
            if v is not None:
                return v
        return 0

    if minSpend is not None or minCTR is not None or maxSpend is not None or maxCVR is not None:
        filtered = []
        for row in all_data:
            spend = _pf(_get(row, "spend", "Product amount spent", "Spend", "Amount Spent"))
            ctr = _pf(_get(row, "inline_link_click_ctr", "CTR (link click-through rate)", "CTR (Link Click-Through Rate)"))
            link_clicks = _pf(_get(row, "inline_link_clicks", "Product link clicks", "Link Clicks"))
            cat_purch = _pf(_get(row, "converted_product_omni_purchase", "Product purchases", "Catalog Purchases"))
            cvr = (cat_purch / link_clicks * 100) if link_clicks > 0 else 0

            if minSpend is not None and spend < minSpend:
                continue
            if minCTR is not None and ctr < minCTR:
                continue
            if maxSpend is not None and spend > maxSpend:
                continue
            if maxCVR is not None and cvr > maxCVR:
                continue
            filtered.append(row)

        logger.info("[facebook/insights] Filtered: %d -> %d rows", raw_count, len(filtered))
        all_data = filtered

    # Cap at 50000 rows to prevent browser crash
    total_filtered = len(all_data)
    if total_filtered > 50000:
        logger.warning("[facebook/insights] Capping results from %d to 50000", total_filtered)
        all_data = all_data[:50000]

    return {"data": all_data, "totalRecords": len(all_data), "rawRecords": raw_count, "totalFiltered": total_filtered, "method": "csv" if csv_text else "json_fallback"}


# ===================================================================
# REPORTS
# ===================================================================


@router.post("/reports/generate")
async def generate_report(
    body: ReportGenerateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Create saved report record
    report = SavedReport(
        userId=user.id,
        name=f"Report {body.adAccountId} {body.dateStart}-{body.dateEnd}",
        adAccountId=body.adAccountId,
        dateStart=body.dateStart,
        dateEnd=body.dateEnd,
        level=body.level or "ad",
        breakdown=body.breakdown,
        minSpend=body.minSpend,
        minCTR=body.minCTR,
        status="generating",
        source="manual",
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    # Create batch job for report generation
    job = BatchJob(
        userId=user.id,
        jobType="report_generation",
        config={
            "adAccountId": body.adAccountId,
            "accessToken": body.accessToken,
            "dateStart": body.dateStart,
            "dateEnd": body.dateEnd,
            "level": body.level or "ad",
            "breakdown": body.breakdown,
            "minSpend": body.minSpend,
            "minCTR": body.minCTR,
            "maxSpend": body.maxSpend,
            "maxCVR": body.maxCVR,
        },
        status="queued",
        queuedAt=datetime.utcnow(),
        reportId=report.id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    return {"report": _row_to_dict(report), "job": _row_to_dict(job)}


@router.get("/reports")
async def get_reports(
    limit: int = Query(50),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SavedReport)
        .where(SavedReport.userId == user.id)
        .order_by(desc(SavedReport.createdAt))
        .limit(limit)
    )
    rows = result.scalars().all()
    reports = []
    for r in rows:
        d = _row_to_dict(r)
        d.pop("data", None)
        reports.append(d)
    return {"success": True, "reports": reports}


@router.get("/reports/{report_id}")
async def get_report(
    report_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(SavedReport).where(SavedReport.id == report_id))
    report = result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    d = _row_to_dict(report)

    # Load report data: file:// path → read from disk; otherwise treat as
    # inline JSON.
    raw = d.get("data")
    if raw and isinstance(raw, str):
        if raw.startswith("file://"):
            try:
                from pathlib import Path
                local_path = Path(raw[len("file://"):])
                d["data"] = json.loads(local_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning("[reports/%s] Failed to load local file: %s", report_id, e)
                d["dataError"] = str(e)
        else:
            try:
                d["data"] = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                pass

    return {"success": True, "report": d}


@router.delete("/reports/{report_id}")
async def delete_report(
    report_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(SavedReport).where(SavedReport.id == report_id))
    report = result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    await db.delete(report)
    await db.commit()
    return {"success": True}


# ===================================================================
# SCHEDULES
# ===================================================================


@router.post("/schedules")
async def create_schedule(
    body: ScheduleCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    schedule = ScheduledJob(
        userId=user.id,
        name=body.name,
        description=body.description,
        jobType=body.jobType,
        cronExpression=body.cronExpression,
        timezone=body.timezone,
        config=body.config,
        reportConfigs=body.reportConfigs,
        enabled=True,
    )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return _row_to_dict(schedule)


@router.get("/schedules")
async def get_schedules(
    limit: int = Query(50),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ScheduledJob)
        .where(ScheduledJob.userId == user.id)
        .order_by(desc(ScheduledJob.createdAt))
        .limit(limit)
    )
    rows = result.scalars().all()
    return {"success": True, "schedules": [_row_to_dict(r) for r in rows]}


@router.get("/schedules/history/all")
async def get_all_schedule_history(
    limit: int = Query(50),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # LEFT JOIN to get scheduleName
    from sqlalchemy import outerjoin, text

    result = await db.execute(
        select(ScheduleRun, ScheduledJob.name.label("scheduleName"))
        .outerjoin(ScheduledJob, ScheduleRun.scheduleId == ScheduledJob.id)
        .where(ScheduleRun.userId == user.id)
        .order_by(desc(ScheduleRun.createdAt))
        .limit(limit)
    )
    rows = result.all()
    history = []
    for run, schedule_name in rows:
        d = _row_to_dict(run)
        d["scheduleName"] = schedule_name
        history.append(d)
    return {"success": True, "runs": history}


@router.get("/schedules/runs/{run_id}")
async def get_schedule_run(
    run_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScheduleRun).where(ScheduleRun.id == run_id))
    run = result.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Schedule run not found")
    if run.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    d = _row_to_dict(run)

    job_details = []
    if run.jobIds:
        job_results = await db.execute(
            select(BatchJob).where(BatchJob.id.in_(run.jobIds))
        )
        jobs = job_results.scalars().all()
        job_details = [_row_to_dict(j) for j in jobs]

    return {"success": True, "run": d, "jobDetails": job_details}


@router.get("/schedules/{schedule_id}")
async def get_schedule(
    schedule_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScheduledJob).where(ScheduledJob.id == schedule_id))
    schedule = result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    if schedule.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    return _row_to_dict(schedule)


@router.put("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: int,
    body: ScheduleUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScheduledJob).where(ScheduledJob.id == schedule_id))
    schedule = result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    if schedule.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(schedule, field, value)

    await db.commit()
    await db.refresh(schedule)
    return _row_to_dict(schedule)


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScheduledJob).where(ScheduledJob.id == schedule_id))
    schedule = result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    if schedule.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    await db.delete(schedule)
    await db.commit()
    return {"success": True}


@router.post("/schedules/{schedule_id}/run")
async def run_schedule_now(
    schedule_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScheduledJob).where(ScheduledJob.id == schedule_id))
    schedule = result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    if schedule.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    from ..services.scheduler import process_scheduled_job

    try:
        run_result = await process_scheduled_job(schedule, "manual")
        return run_result
    except Exception as e:
        logger.exception("[schedules/%s/run] Error", schedule_id)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/schedules/jobs/{job_id}/cancel")
async def cancel_schedule_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(BatchJob).where(BatchJob.id == job_id))
    job = result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if job.status not in ("queued", "running"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel job with status '{job.status}'")

    job.status = "cancelled"
    job.completedAt = datetime.utcnow()
    job.statusMessage = "Cancelled by user"

    # Update associated schedule_run if exists
    run_result = await db.execute(
        select(ScheduleRun).where(
            ScheduleRun.jobIds.isnot(None),
            ScheduleRun.status == "running",
            ScheduleRun.userId == user.id,
        )
    )
    runs = run_result.scalars().all()
    for run in runs:
        if run.jobIds and job_id in run.jobIds:
            run.status = "failed"
            run.errorMessage = f"Job {job_id} cancelled by user"
            run.completedAt = datetime.utcnow()
            break

    await db.commit()
    await db.refresh(job)
    return _row_to_dict(job)


@router.get("/schedules/{schedule_id}/history")
async def get_schedule_history(
    schedule_id: int,
    limit: int = Query(50),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify ownership
    sched_result = await db.execute(select(ScheduledJob).where(ScheduledJob.id == schedule_id))
    schedule = sched_result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    if schedule.userId != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    result = await db.execute(
        select(ScheduleRun)
        .where(ScheduleRun.scheduleId == schedule_id)
        .order_by(desc(ScheduleRun.createdAt))
        .limit(limit)
    )
    rows = result.scalars().all()
    return {"success": True, "runs": [_row_to_dict(r) for r in rows], "scheduleName": schedule.name}
