"""One-off: connect to the DATABASE_URL in backend/.env and create any missing
mpi_ prefixed tables (safe to re-run — create_all only creates missing tables).

Usage (from backend/):
    .venv/bin/python3 scripts/init_tidb.py
"""
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

from app.database import init_db  # noqa: E402


async def main():
    await init_db()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
