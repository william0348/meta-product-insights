"""One-off migration: copy data from the local meta_insights.db (SQLite) into the
shared claude-multi TiDB Cloud database, under the mpi_ prefixed tables.

Run this AFTER the app has started at least once against the new TiDB
DATABASE_URL (so init_db()'s create_all() has created the mpi_* tables).

Usage (from backend/):
    python3 scripts/migrate_sqlite_to_tidb.py
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import pymysql

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings  # noqa: E402
from urllib.parse import urlparse  # noqa: E402

SQLITE_PATH = Path(__file__).resolve().parent.parent / "meta_insights.db"

# sqlite table name -> TiDB table name (mpi_ prefixed)
TABLES = [
    "users",
    "user_tokens",
    "catalog_batch_history",
    "batch_jobs",
    "saved_reports",
    "scheduled_jobs",
    "schedule_runs",
    "product_set_monitors",
    "product_set_snapshots",
]


def truncate_datetime(value):
    """MySQL DATETIME columns here have no fractional-seconds precision;
    SQLite stores e.g. '2026-08-13 00:34:11.091917' which MySQL would reject."""
    if not isinstance(value, str):
        return value
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
    return value


def connect_tidb():
    parsed = urlparse(settings.database_url)
    return pymysql.connect(
        host=parsed.hostname,
        port=parsed.port or 4000,
        user=parsed.username,
        password=parsed.password,
        database=parsed.path.lstrip("/"),
        ssl={"ssl": {}},
        autocommit=False,
    )


def migrate_table(sqlite_conn, mysql_conn, table: str) -> int:
    target = f"mpi_{table}"
    cur = sqlite_conn.execute(f"SELECT * FROM {table}")
    rows = cur.fetchall()
    if not rows:
        print(f"  {table}: 0 rows, skipping")
        return 0

    columns = [d[0] for d in cur.description]
    placeholders = ", ".join(["%s"] * len(columns))
    col_list = ", ".join(f"`{c}`" for c in columns)
    sql = f"INSERT INTO `{target}` ({col_list}) VALUES ({placeholders})"

    with mysql_conn.cursor() as mcur:
        for row in rows:
            values = [truncate_datetime(v) for v in row]
            mcur.execute(sql, values)
    mysql_conn.commit()
    print(f"  {table} -> {target}: {len(rows)} rows migrated")
    return len(rows)


def main():
    if not SQLITE_PATH.exists():
        print(f"SQLite file not found: {SQLITE_PATH}")
        sys.exit(1)
    if settings.database_url.startswith("sqlite"):
        print("settings.database_url is still SQLite — update backend/.env to the TiDB URL first.")
        sys.exit(1)

    sqlite_conn = sqlite3.connect(str(SQLITE_PATH))
    mysql_conn = connect_tidb()

    print(f"Migrating from {SQLITE_PATH} to TiDB (claude-multi, mpi_ prefix)...")
    total = 0
    try:
        for table in TABLES:
            total += migrate_table(sqlite_conn, mysql_conn, table)
    except Exception:
        mysql_conn.rollback()
        raise
    finally:
        sqlite_conn.close()
        mysql_conn.close()

    print(f"Done. {total} rows migrated in total.")


if __name__ == "__main__":
    main()
