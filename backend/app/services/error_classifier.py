from typing import Literal
import re
import random

ErrorType = Literal["transient", "permanent", "timeout", "rate_limit"]

TRANSIENT_FB_ERROR_CODES = {1, 2, 4, 17, 32, 341, 368, 2446, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008}
PERMANENT_FB_ERROR_CODES = {10, 100, 200, 294, 803, 2635}

TRANSIENT_MESSAGE_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"timeout", r"timed?\s*out", r"ETIMEDOUT", r"ECONNRESET",
        r"ECONNREFUSED", r"ECONNABORTED", r"ENETUNREACH", r"EHOSTUNREACH",
        r"socket hang up", r"network error", r"temporarily unavailable",
        r"service unavailable", r"503", r"502", r"429", r"too many requests",
        r"rate limit", r"throttl", r"server error", r"internal server error",
        r"500 internal", r"gateway timeout", r"bad gateway",
        r"request failed with status code 5\d\d",
        r"request failed with status code 429",
        r"an unknown error has occurred",
        r"please retry your request later",
    ]
]

PERMANENT_MESSAGE_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"invalid oauth", r"invalid access token", r"permission denied",
        r"not authorized", r"does not exist", r"invalid parameter",
        r"invalid catalog", r"malformed", r"unsupported", r"deprecated",
    ]
]

BASE_DELAYS: dict[ErrorType, int] = {
    "rate_limit": 60000,
    "timeout": 30000,
    "transient": 30000,
    "permanent": 0,
}

MAX_DELAY = 10 * 60 * 1000  # 10 minutes in milliseconds


def classify_error(error: dict) -> dict:
    """Classify an error and return type, retryable flag, and message."""
    message = str(error.get("message", ""))

    # Check for FB API error codes
    fb_error_code = (
        error
        .get("response", {})
        .get("data", {})
        .get("error", {})
        .get("code")
    )

    if fb_error_code is not None:
        if fb_error_code in TRANSIENT_FB_ERROR_CODES:
            return {"type": "transient", "retryable": True, "message": message}
        if fb_error_code in PERMANENT_FB_ERROR_CODES:
            return {"type": "permanent", "retryable": False, "message": message}

    # Check HTTP status codes
    status = error.get("status") or error.get("response", {}).get("status")
    if status is not None:
        status = int(status)
        if status == 429:
            return {"type": "rate_limit", "retryable": True, "message": message}
        if status == 408 or status == 504:
            return {"type": "timeout", "retryable": True, "message": message}
        if 500 <= status < 600:
            return {"type": "transient", "retryable": True, "message": message}
        if 400 <= status < 500:
            return {"type": "permanent", "retryable": False, "message": message}

    # Check message patterns (permanent first, then transient)
    for pattern in PERMANENT_MESSAGE_PATTERNS:
        if pattern.search(message):
            return {"type": "permanent", "retryable": False, "message": message}

    for pattern in TRANSIENT_MESSAGE_PATTERNS:
        if pattern.search(message):
            return {"type": "transient", "retryable": True, "message": message}

    # Default: transient, retryable
    return {"type": "transient", "retryable": True, "message": message}


def calculate_retry_delay(retry_count: int, error_type: ErrorType) -> int:
    """Calculate retry delay in milliseconds with exponential backoff and jitter."""
    base = BASE_DELAYS.get(error_type, 0)
    if base == 0:
        return 0

    exponential_delay = base * (2 ** retry_count)
    jitter = exponential_delay * 0.2 * random.random()
    delay = int(exponential_delay + jitter)

    return min(delay, MAX_DELAY)
