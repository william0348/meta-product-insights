import logging
import ssl
from urllib.parse import urlparse, quote_plus

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text

from .config import settings

logger = logging.getLogger(__name__)

_engine = None
_session_factory = None


def _is_sqlite(raw_url: str) -> bool:
    return raw_url.startswith("sqlite")


def _build_async_url(raw_url: str) -> str:
    if _is_sqlite(raw_url):
        # Accept either "sqlite:///path" or "sqlite+aiosqlite:///path"
        if raw_url.startswith("sqlite+aiosqlite"):
            return raw_url
        return raw_url.replace("sqlite://", "sqlite+aiosqlite://", 1)
    parsed = urlparse(raw_url)
    scheme = "mysql+aiomysql"
    username = parsed.username or ""
    password = parsed.password or ""
    host = parsed.hostname or "localhost"
    port = parsed.port or 4000
    database = parsed.path.lstrip("/")
    encoded_password = quote_plus(password)
    return f"{scheme}://{username}:{encoded_password}@{host}:{port}/{database}"


def get_engine():
    global _engine
    if _engine is None:
        url = _build_async_url(settings.database_url)
        if _is_sqlite(settings.database_url):
            _engine = create_async_engine(url, echo=settings.debug)
        else:
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
            _engine = create_async_engine(
                url,
                pool_size=10,
                max_overflow=20,
                pool_recycle=1800,
                pool_pre_ping=True,
                connect_args={"ssl": ctx},
                echo=settings.debug,
            )
    return _engine


def get_session_factory():
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(get_engine(), class_=AsyncSession, expire_on_commit=False)
    return _session_factory


async def get_db():
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def init_db():
    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    from .models import Base
    async with engine.begin() as conn:
        # create_all only creates missing tables — it never ALTERs existing ones,
        # hence the manual column-add patch below (runs against both sqlite and
        # the shared TiDB/MySQL database; table names differ by dialect since the
        # local sqlite file predates the mpi_ table-name prefix used on TiDB).
        await conn.run_sync(Base.metadata.create_all)
        await _add_missing_columns(conn)
    logger.info("[Database] Schema ensured (%s)", "sqlite" if _is_sqlite(settings.database_url) else "mysql")
    logger.info("[Database] Connection verified")


async def _add_missing_columns(conn) -> None:
    """Migration for columns added after first deploy.
    create_all() only creates missing tables — it never ALTERs existing ones."""
    is_sqlite = _is_sqlite(settings.database_url)
    prefix = "" if is_sqlite else "mpi_"
    desired = [
        ("batch_jobs", "catalogVerification", "TEXT"),
        ("user_tokens", "minCVR", "VARCHAR(32)"),
        ("user_tokens", "minROAS", "VARCHAR(32)"),
    ]
    for table, column, coltype in desired:
        table = f"{prefix}{table}"
        if is_sqlite:
            existing = (await conn.exec_driver_sql(f"PRAGMA table_info({table})")).fetchall()
            has_column = any(row[1] == column for row in existing)
        else:
            existing = (await conn.exec_driver_sql(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = %s",
                (table,),
            )).fetchall()
            has_column = any(row[0] == column for row in existing)
        if not has_column:
            await conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")
            logger.info("[Database] Added column %s.%s", table, column)


async def close_db():
    global _engine, _session_factory
    if _engine:
        await _engine.dispose()
        _engine = None
        _session_factory = None
        logger.info("[Database] Connection closed")
