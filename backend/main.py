import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.agent import agent_router
from app.config import settings
from app.database import close_db, init_db
from app.services.job_processor import start_job_processor, stop_job_processor
from app.services.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.app_name}...")
    try:
        await init_db()
    except Exception as e:
        logger.warning(f"[Database] Connection failed (server will start without DB): {e}")
    import asyncio

    async def _delayed_start():
        await asyncio.sleep(10)
        await start_job_processor()
        await start_scheduler()

    asyncio.create_task(_delayed_start())
    yield
    await stop_scheduler()
    await stop_job_processor()
    await close_db()
    logger.info("Shutdown complete")


app = FastAPI(title=settings.app_name, lifespan=lifespan)

# CORS
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi import Request
from fastapi.responses import JSONResponse

from app.api.routes import router as api_router
from app.api.monitors import monitors_router

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"[API] {request.method} {request.url.path} -> {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"detail": str(exc)})

# API routes
app.include_router(api_router)
app.include_router(agent_router)
app.include_router(monitors_router)

# Serve frontend static files in production
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = static_dir / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(static_dir / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=settings.debug)
