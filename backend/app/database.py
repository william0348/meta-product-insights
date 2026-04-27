import logging
import ssl
from urllib.parse import urlparse, urlunparse, quote_plus

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text

from .config import settings

logger = logging.getLogger(__name__)

_engine = None
_session_factory = None


def _build_async_url(raw_url: str) -> str:
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
    logger.info("[Database] Connection verified")


async def close_db():
    global _engine, _session_factory
    if _engine:
        await _engine.dispose()
        _engine = None
        _session_factory = None
        logger.info("[Database] Connection closed")
