---
name: dev-startup
description: How to start, restart, and stop the frontend (Vite) and backend (FastAPI/Python) for local development of meta-product-insights. Use when the user wants to run the project, restart the backend after code changes, or troubleshoot port conflicts.
---

# Local Dev Startup — meta-product-insights

## Architecture quick recap

- **Frontend**: Vite + React, port **5173**, source under `client/`.
- **Backend**: FastAPI (Python) + SQLAlchemy async, port **8001**, source under `backend/`.
- **DB**: TiDB Cloud (remote), URL in `backend/.env` as `DATABASE_URL`. Local dev shares the same DB as production.
- **File storage**: writes report data to `backend/reports/{userId}/{reportId}-{nanoid}.json` (no GCS / S3).
- **Schedule worker**: runs INSIDE the FastAPI process (`app/services/scheduler.py` daemon + `app/services/job_processor.py` queue), no separate worker process.

## Start backend

```bash
cd backend
source venv/bin/activate
python main.py
```

- Listens on `http://0.0.0.0:8001`
- Logs go to stdout. To persist logs:
  `python main.py 2>&1 | tee /tmp/meta-backend.log`
- On startup it runs `_reconcile_stale_schedule_runs` once to clean up any schedule_runs left in 'running' state from the previous lifecycle.

## Start frontend

```bash
# from project root
pnpm install   # only if node_modules missing
pnpm exec vite --port 5173
```

Frontend talks to backend via relative `/api/...` paths — Vite proxy is configured in `vite.config.ts`.

> Note: the `pnpm dev` script in `package.json` still points at the legacy TS server (`server/_core/index.ts`). Don't use it. Use the backend Python command above plus `vite` directly.

## Restart backend (the most common task)

After editing any file under `backend/app/`, you MUST restart — `python main.py` does NOT auto-reload.

```bash
# Find pid
lsof -i :8001 -t
# Kill
kill <PID>
# Re-run from backend/
cd backend && source venv/bin/activate && python main.py
```

If port 8001 is "address already in use" when starting, an old backend is still running — kill it first.

## Quick health checks

```bash
# Is backend up?
curl -s http://localhost:8001/api/jobs?limit=1 | head -c 200

# Latest job state
curl -s "http://localhost:8001/api/jobs?limit=3" | python3 -m json.tool | head -40

# Specific job
curl -s "http://localhost:8001/api/jobs/<JOB_ID>" | python3 -m json.tool

# Schedule run detail
curl -s "http://localhost:8001/api/schedules/runs/<RUN_ID>" | python3 -m json.tool
```

## Trigger a schedule manually

UI: http://localhost:5173 → ScheduledJobs → ▶ Run Now button on the schedule card.

Or via API:
```bash
curl -X POST http://localhost:8001/api/schedules/<SCHEDULE_ID>/run
```

## Cancel a stuck job

```bash
curl -X POST http://localhost:8001/api/jobs/<JOB_ID>/cancel
```

The `_reconcile_stale_schedule_runs` startup hook will also force-fail any job that's been "running" for >60 minutes when the backend restarts.

## Common pitfalls

- **DB connection failed warning at startup** — backend continues but schedule daemon won't be able to read jobs. Check `backend/.env` `DATABASE_URL` and TiDB Cloud IP whitelist.
- **CSV download returns HTML** — the `https://www.facebook.com/ads/ads_insights/export_report` endpoint requires browser cookies; use `https://lookaside.facebook.com/ads/ads_insights/download_report/business/?...&access_token=...` instead. The current code already does this.
- **catalog batch API 400 Bad Request** — make sure `item_type=PRODUCT_ITEM` is in the items_batch payload (already fixed in `backend/app/facebook/catalog.py`).
- **`custom_number_*` updates silently fail** — values must be float, not string. Backend converts in `report_worker.py` before sending.
