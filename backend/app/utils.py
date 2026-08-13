"""Shared utilities."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


def dt_iso(d: Optional[datetime]) -> Optional[str]:
    """Serialize a datetime as an ISO string tagged with UTC.

    All datetimes in our DB are naive UTC (datetime.utcnow() or SQLite's
    CURRENT_TIMESTAMP). We tag them as UTC on the wire so JS `new Date()`
    parses them as UTC instead of misinterpreting them as the browser's
    local time.
    """
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.isoformat()
