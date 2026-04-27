"""
Error classification and retry delay calculation.
Port of server/error-classifier.ts.
"""

import random
import re
from enum import Enum
from typing import NamedTuple


class ErrorType(Enum):
    TRANSIENT = "transient"
    PERMANENT = "permanent"
    TIMEOUT = "timeout"
    RATE_LIMIT = "rate_limit"


class ClassifiedError(NamedTuple):
    type: ErrorType
    retryable: bool
    message: str


# Facebook API error codes
TRANSIENT_FB_CODES = {1, 2, 4, 17, 32, 341, 368, 2446,
                      80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008}
PERMANENT_FB_CODES = {10, 100, 200, 294, 803, 2635}

TRANSIENT_PATTERNS = [
    r"econnreset", r"econnrefused", r"econnaborted", r"epipe",
    r"enetunreach", r"ehostunreach", r"enotfound",
    r"socket hang up", r"network error", r"fetch failed",
    r"connection.*reset", r"connection.*refused", r"connection.*closed",
    r"aborted", r"temporarily unavailable", r"service unavailable",
    r"internal server error", r"bad gateway", r"gateway timeout",
    r"unknown error", r"no available peers",
]

PERMANENT_PATTERNS = [
    r"invalid.*token", r"token.*expired", r"token.*invalid",
    r"permission.*denied", r"not.*authorized", r"access.*denied",
    r"invalid.*parameter", r"invalid.*field", r"invalid.*request",
    r"does not exist",
]


def classify_error(error) -> ClassifiedError:
    """Classify an error and determine if it's retryable."""
    message = str(error).lower() if error else "unknown error"

    # Check for Facebook API error code
    fb_code = getattr(error, "fb_error_code", None)
    if fb_code is not None:
        if fb_code in {4, 17} or 80000 <= fb_code <= 80008:
            return ClassifiedError(ErrorType.RATE_LIMIT, True, str(error))
        if fb_code in TRANSIENT_FB_CODES:
            return ClassifiedError(ErrorType.TRANSIENT, True, str(error))
        if fb_code in PERMANENT_FB_CODES:
            return ClassifiedError(ErrorType.PERMANENT, False, str(error))

    # Check HTTP status patterns
    if "429" in message or "too many" in message or "throttl" in message:
        return ClassifiedError(ErrorType.RATE_LIMIT, True, str(error))
    if "408" in message:
        return ClassifiedError(ErrorType.TIMEOUT, True, str(error))

    # Timeout patterns
    if any(kw in message for kw in ["timeout", "timed out", "etimedout"]):
        return ClassifiedError(ErrorType.TIMEOUT, True, str(error))

    # Permanent patterns (check before transient)
    for pattern in PERMANENT_PATTERNS:
        if re.search(pattern, message):
            return ClassifiedError(ErrorType.PERMANENT, False, str(error))

    # Transient patterns
    for pattern in TRANSIENT_PATTERNS:
        if re.search(pattern, message):
            return ClassifiedError(ErrorType.TRANSIENT, True, str(error))

    # Default: treat unknown errors as transient
    return ClassifiedError(ErrorType.TRANSIENT, True, str(error))


def calculate_retry_delay(retry_count: int, error_type: ErrorType) -> float:
    """Calculate retry delay in seconds using exponential backoff + jitter."""
    base_delays = {
        ErrorType.RATE_LIMIT: 60,
        ErrorType.TIMEOUT: 30,
        ErrorType.TRANSIENT: 30,
        ErrorType.PERMANENT: 0,
    }
    base = base_delays.get(error_type, 30)
    delay = base * (2 ** retry_count)
    jitter = delay * 0.2 * random.random()
    return min(delay + jitter, 600)  # Max 10 minutes
