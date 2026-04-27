"""Database connection test. Run: python test_db.py"""
import asyncio
import ssl
import socket
import certifi
from urllib.parse import urlparse

async def test():
    from app.config import settings
    parsed = urlparse(settings.database_url)
    host = parsed.hostname
    port = parsed.port or 4000

    # Resolve IPv4
    try:
        ipv4 = socket.getaddrinfo(host, port, socket.AF_INET)[0][4][0]
    except Exception:
        ipv4 = host

    print(f"Host: {host} -> {ipv4}")
    print(f"Port: {port}")
    print(f"User: {parsed.username}")
    print(f"DB:   {parsed.path.lstrip('/')}")
    print(f"CA:   {certifi.where()}\n")

    # Test PyMySQL with certifi
    print("[1] PyMySQL sync + certifi CA...")
    try:
        import pymysql
        ctx = ssl.create_default_context(cafile=certifi.where())
        conn = pymysql.connect(
            host=host, port=port,
            user=parsed.username, password=parsed.password,
            database=parsed.path.lstrip("/"),
            ssl=ctx, connect_timeout=10,
        )
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            print(f"  OK: {cur.fetchone()}")
            cur.execute("SHOW TABLES")
            print(f"  Tables: {[t[0] for t in cur.fetchall()]}")
        conn.close()
    except Exception as e:
        print(f"  FAILED: {e}")

    # Test SQLAlchemy
    print("\n[2] SQLAlchemy async + certifi CA...")
    try:
        from app.database import init_db, close_db
        await init_db()
        print("  OK: Connection verified")
        await close_db()
    except Exception as e:
        print(f"  FAILED: {e}")

asyncio.run(test())
