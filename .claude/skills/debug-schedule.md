---
name: debug-schedule
description: Diagnose and fix common schedule worker problems — stuck "Running" status, CSV download failures, catalog batch silent failures, missing data in Run Detail. Use when a schedule run produces unexpected results (0 items, stale status, no catalog updates) or when investigating why an item ratio looks off.
---

# Debugging Schedule Runs — meta-product-insights

A field guide assembled from real bugs found in this codebase. Symptoms first, then the actual root cause and fix location.

## Symptom: Schedule shows "Running" forever after job is done

**Cause**: `scheduled_jobs.lastRunStatus` only ever gets set to "running" when the schedule triggers; nobody flips it to "success"/"failed" when the underlying job finishes.

**Fix location**: `backend/app/services/report_worker.py` step 10 (success path) + corresponding failure handler — must execute a SQLAlchemy `update(ScheduledJob).values(lastRunStatus=...)` after the run finishes. `_reconcile_stale_schedule_runs` in `job_processor.py` also sweeps any stragglers at backend startup.

## Symptom: Schedule run shows totals as $0.00 / 0 impressions / "—" duration

**Cause**: Worker only writes `totalItems` to `schedule_runs` and forgets `totalSpend` (cents), `totalImpressions`, `durationMs`, `completedJobs`, `catalogItemsUpdated`.

**Fix location**: `report_worker.py` step 10 — include all those columns in the `db_update_schedule_run` call. `totalSpend` is stored in cents (frontend `formatSpend` divides by 100).

## Symptom: CSV download returns 22 rows of "<!DOCTYPE html>"

**Cause**: `https://www.facebook.com/ads/ads_insights/export_report?...&access_token=...` requires browser session cookies. Called with just an OAuth token, FB returns its login HTML page — and a naive CSV parser treats each HTML line as a "row".

**Fix**: Use the documented `https://lookaside.facebook.com/ads/ads_insights/download_report/business/?report_run_id=...&access_token=...` endpoint instead. Always check `Content-Type` and the first 200 chars of the body; reject if it starts with `<` or is `text/html`.

## Symptom: lookaside CSV returns HTTP 400 with curl-like browser headers

**Cause**: Adding `User-Agent: Mozilla/...` or `Accept-Encoding: br` to the httpx request makes FB reject. Bare httpx (no custom headers) works.

**Fix**: Don't override headers when calling lookaside.

## Symptom: lookaside CSV returns HTTP 500 a few times then succeeds

**Cause**: FB items_batch is async — after the report run completes, the lookaside file may take 30-120 seconds to be ready. Retrying too fast (10/20/30s) gives up before FB packages the file.

**Fix**: 4 attempts with 30/60/90/120s backoff on 500. See `backend/app/services/report_worker.py` CSV download block.

## Symptom: catalog batch returns "57554 success" but FB catalog shows 0 products updated

Two separate root causes both produce this — check which one applies:

### 1. Missing `item_type` in items_batch payload

FB returns HTTP 400 for the entire batch but the worker counted `len(batch_requests)` as success without checking the response. Look in log for `HTTP/1.1 400 Bad Request` from `https://graph.facebook.com/v25.0/{catalog_id}/items_batch`.

**Fix**: `backend/app/facebook/catalog.py` `send_batch_request` must include `"item_type": "PRODUCT_ITEM"` in the POST payload.

### 2. `custom_number_*` sent as string instead of float

FB Catalog `custom_number_0..4` fields are typed FLOAT. Sending `"6666"` (string) gets silently ignored at the field level; the request envelope returns 200 with valid handles but the field update is dropped.

**Fix**: `backend/app/services/report_worker.py` catalog step — convert via `float(value)` before adding to `update_data`.

## Symptom: Catalog "verify" always says 0 matched

### 1. Wrong filter syntax

The FB Catalog products `filter` param uses `{<field>: {<operator>: <value>}}`, NOT `{field, operator, values}`. The IN-equivalent operator is `is_any`.

**Fix**: `verify_catalog_update` in `report_worker.py` should build:
```python
{field_name: {"is_any": expected_values}}      # multi-value
{field_name: {"eq": expected_values[0]}}       # single-value
```

### 2. Verify ran before FB processed the batch

Items_batch is async. Don't verify immediately — sleep ~15s after `batch_update_products` returns, then verify.

### 3. Verify code accidentally inside the `else` branch

Easy regression — the verify block must be at the same indentation as the `if batch_requests:` it follows, NOT nested in the else.

## Symptom: Schedule run uses dateRangeType "last_7_days" even though UI shows "last_30_days"

**Cause**: `backend/app/services/scheduler.py` doesn't propagate `dateRangeType` (or `maxSpend`/`maxCVR`/`topConversionLimit`/catalog fields) from `schedule.config` into `batch_job.config`. The report worker sees no `dateRangeType` and falls back to its `"last_7_days"` default.

**Fix**: scheduler.py `process_schedule` job_config dict — explicitly include every field the worker reads.

## Symptom: lookaside returns 500 + worker config has `level=ad`, `breakdown=null`

**Cause**: schedule was created without explicit level/breakdown, scheduler defaulted to ad-level / no breakdown. FB lookaside CSV doesn't support large ad-level reports the same way.

**Fix**: scheduler.py defaults — `level = ... or "account"`, `breakdown = ... or "product_id"`. Aligns with the working frontend manual flow.

## Symptom: Job marked "completed" with `Items: 0/0` but log shows it actually processed thousands

**Cause**: report_worker only writes `status=completed` and `progress=100` at the end, never updates `totalItems` / `processedItems` / `successCount` on the batch_job row.

**Fix**: include those columns in the final `db_update_job` call alongside a descriptive `statusMessage`.

## Symptom: `fetch_insights_data() got an unexpected keyword argument 'heartbeat_callback'`

**Cause**: kwarg drift — the function was renamed `on_heartbeat` / `check_cancelled` but a caller still uses the old names.

**Fix**: caller in `report_worker.py` JSON fallback must use `on_heartbeat=...` / `check_cancelled=...`.

## Useful queries while debugging

```bash
# Latest jobs
curl -s "http://localhost:8001/api/jobs?limit=5" | python3 -m json.tool

# Specific job state
curl -s "http://localhost:8001/api/jobs/<JOB_ID>" | python3 -m json.tool

# Schedule run detail (linked jobs + totals)
curl -s "http://localhost:8001/api/schedules/runs/<RUN_ID>" | python3 -m json.tool

# Cancel a stuck running job
curl -X POST "http://localhost:8001/api/jobs/<JOB_ID>/cancel"
```

For backend log, either tail the terminal where you ran `python main.py`, or restart with `python main.py 2>&1 | tee /tmp/meta-backend.log` so it's grep-able.
