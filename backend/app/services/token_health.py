"""
Token health check + LINE push notification.

Runs once per day from inside the scheduler loop. Validates every stored
Facebook token against the Graph API and pushes a LINE message when a token
goes dead (e.g. OAuthException 190 / subcode 458 — user deauthorized the app,
or a long-lived token hit its 60-day expiry).

Notification policy: notify on the transition healthy -> dead, and re-notify
at most once every RENOTIFY_HOURS while a token stays dead, so a broken token
keeps nagging without spamming every scheduler tick.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from sqlalchemy import select

from ..config import settings
from ..database import get_session_factory
from ..models import UserToken

logger = logging.getLogger(__name__)

GRAPH_VERSION = "v25.0"
CHECK_INTERVAL_HOURS = 24
RENOTIFY_HOURS = 24
HTTP_TIMEOUT_S = 15.0

# Module-level state. Keyed by token id.
_last_check_at: Optional[datetime] = None
_dead_since: dict[int, datetime] = {}
_last_notified_at: dict[int, datetime] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _validate_token(access_token: str) -> tuple[bool, Optional[str]]:
    """Return (is_valid, error_message). Network errors count as valid to
    avoid false alarms on transient connectivity issues."""
    url = f"https://graph.facebook.com/{GRAPH_VERSION}/me"
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as client:
            resp = await client.get(url, params={"access_token": access_token, "fields": "id,name"})
        data = resp.json()
    except Exception as exc:
        logger.warning("[TokenHealth] Network error validating token, skipping: %s", exc)
        return True, None

    if "error" in data:
        err = data["error"]
        msg = f"{err.get('message', 'unknown error')} (code {err.get('code')}, subcode {err.get('error_subcode')})"
        return False, msg
    return True, None


async def _send_line_push(text: str) -> bool:
    """Push a text message to the configured LINE user. Returns True on success."""
    token = settings.line_channel_access_token
    user_id = settings.line_user_id
    if not token or not user_id:
        logger.warning("[TokenHealth] LINE credentials not configured; skipping push. Message was:\n%s", text)
        return False

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as client:
            resp = await client.post(
                "https://api.line.me/v2/bot/message/push",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"to": user_id, "messages": [{"type": "text", "text": text[:4900]}]},
            )
        if resp.status_code == 200:
            logger.info("[TokenHealth] LINE push sent")
            return True
        logger.error("[TokenHealth] LINE push failed: %s %s", resp.status_code, resp.text[:300])
        return False
    except Exception as exc:
        logger.error("[TokenHealth] LINE push error: %s", exc)
        return False


async def _check_once() -> list[dict[str, Any]]:
    """Validate all tokens, update state, and push notifications as needed.
    Returns the list of dead tokens found this run."""
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(select(UserToken))
        tokens = list(result.scalars().all())

    dead: list[dict[str, Any]] = []

    for tok in tokens:
        is_valid, err = await _validate_token(tok.accessToken)
        if is_valid:
            if tok.id in _dead_since:
                logger.info("[TokenHealth] Token %s (%s) recovered", tok.id, tok.tokenType)
                _dead_since.pop(tok.id, None)
                _last_notified_at.pop(tok.id, None)
                await _send_line_push(
                    f"✅ Meta Product Insights\n{tok.tokenType} token 已恢復正常。"
                )
            continue

        # Token is dead.
        dead.append({"id": tok.id, "type": tok.tokenType, "adAccountId": tok.adAccountId, "error": err})
        first_seen = tok.id not in _dead_since
        if first_seen:
            _dead_since[tok.id] = _now()

        last_notified = _last_notified_at.get(tok.id)
        due_renotify = (
            last_notified is None
            or (_now() - last_notified) >= timedelta(hours=RENOTIFY_HOURS)
        )
        if first_seen or due_renotify:
            acct = f"\nAd account: {tok.adAccountId}" if tok.adAccountId else ""
            sent = await _send_line_push(
                f"⚠️ Meta Product Insights\n"
                f"{tok.tokenType} token 失效，報表 job 會失敗。{acct}\n"
                f"錯誤：{err}\n"
                f"請到設定頁重新產生並更新 token。"
            )
            if sent:
                _last_notified_at[tok.id] = _now()

    if dead:
        logger.warning("[TokenHealth] %d dead token(s): %s", len(dead), [d["type"] for d in dead])
    else:
        logger.info("[TokenHealth] All %d token(s) healthy", len(tokens))
    return dead


async def tick_token_health(force: bool = False) -> Optional[list[dict[str, Any]]]:
    """Called every scheduler tick. Runs the actual check at most once per
    CHECK_INTERVAL_HOURS. Pass force=True to run immediately (used for testing).
    Returns the dead-token list when a check ran, else None."""
    global _last_check_at
    if not force and _last_check_at is not None:
        if (_now() - _last_check_at) < timedelta(hours=CHECK_INTERVAL_HOURS):
            return None
    _last_check_at = _now()
    return await _check_once()
