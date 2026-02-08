/**
 * Error Classification Module
 * 
 * Classifies errors from Facebook API and other sources to determine
 * if they are retryable (transient) or permanent.
 */

export type ErrorType = 'transient' | 'permanent' | 'timeout' | 'rate_limit';

export interface ClassifiedError {
  type: ErrorType;
  retryable: boolean;
  message: string;
}

/**
 * Facebook API error codes that are known to be transient
 * Reference: https://developers.facebook.com/docs/marketing-api/error-reference
 */
const TRANSIENT_FB_ERROR_CODES = new Set([
  1, 2, 4, 17, 32, 341, 368, 2446,
  80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008,
]);

const PERMANENT_FB_ERROR_CODES = new Set([
  10, 100, 200, 294, 803, 2635,
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  /timeout/i, /timed?\s*out/i, /ETIMEDOUT/i, /ECONNRESET/i,
  /ECONNREFUSED/i, /ECONNABORTED/i, /ENETUNREACH/i, /EHOSTUNREACH/i,
  /socket hang up/i, /network error/i, /temporarily unavailable/i,
  /service unavailable/i, /503/, /502/, /429/, /too many requests/i,
  /rate limit/i, /throttl/i, /server error/i, /internal server error/i,
  /500 internal/i, /gateway timeout/i, /bad gateway/i,
  /request failed with status code 5\d\d/i,
  /request failed with status code 429/i,
  /an unknown error has occurred/i,
  /please retry your request later/i,
];

const PERMANENT_MESSAGE_PATTERNS = [
  /invalid oauth/i, /invalid access token/i, /permission denied/i,
  /not authorized/i, /does not exist/i, /invalid parameter/i,
  /invalid catalog/i, /malformed/i, /unsupported/i, /deprecated/i,
];

/**
 * Classify an error to determine if it's retryable
 */
export function classifyError(error: any): ClassifiedError {
  const message = error?.message || error?.toString() || 'Unknown error';
  
  // Check for Facebook API error codes
  const fbErrorCode = error?.response?.data?.error?.code 
    || error?.data?.error?.code
    || error?.error?.code;
  
  if (fbErrorCode) {
    if (fbErrorCode === 4 || fbErrorCode === 17 || (fbErrorCode >= 80000 && fbErrorCode <= 80008)) {
      return { type: 'rate_limit', retryable: true, message };
    }
    if (TRANSIENT_FB_ERROR_CODES.has(fbErrorCode)) {
      return { type: 'transient', retryable: true, message };
    }
    if (PERMANENT_FB_ERROR_CODES.has(fbErrorCode)) {
      return { type: 'permanent', retryable: false, message };
    }
  }
  
  // Check HTTP status codes
  const statusCode = error?.response?.status || error?.status;
  if (statusCode) {
    if (statusCode === 429) return { type: 'rate_limit', retryable: true, message };
    if (statusCode >= 500 && statusCode < 600) return { type: 'transient', retryable: true, message };
    if (statusCode === 408) return { type: 'timeout', retryable: true, message };
    if (statusCode >= 400 && statusCode < 500) return { type: 'permanent', retryable: false, message };
  }
  
  // Check Node.js system error codes
  const code = error?.code;
  if (code) {
    const transientCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'EAI_AGAIN'];
    if (transientCodes.includes(code)) {
      return { type: code === 'ETIMEDOUT' ? 'timeout' : 'transient', retryable: true, message };
    }
  }
  
  // Check message patterns - permanent first
  for (const pattern of PERMANENT_MESSAGE_PATTERNS) {
    if (pattern.test(message)) return { type: 'permanent', retryable: false, message };
  }
  
  for (const pattern of TRANSIENT_MESSAGE_PATTERNS) {
    if (pattern.test(message)) {
      if (/timeout|timed?\s*out|ETIMEDOUT|408|gateway timeout/i.test(message)) {
        return { type: 'timeout', retryable: true, message };
      }
      if (/rate limit|429|too many|throttl/i.test(message)) {
        return { type: 'rate_limit', retryable: true, message };
      }
      return { type: 'transient', retryable: true, message };
    }
  }
  
  // Default: treat unknown errors as transient (give them a chance to retry)
  return { type: 'transient', retryable: true, message };
}

/**
 * Calculate retry delay with exponential backoff
 * 
 * @param retryCount - Current retry attempt (0-based)
 * @param errorType - The type of error
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(retryCount: number, errorType: ErrorType): number {
  const baseDelays: Record<ErrorType, number> = {
    rate_limit: 60_000,   // 1 minute for rate limits
    timeout: 30_000,      // 30 seconds for timeouts
    transient: 30_000,    // 30 seconds for transient errors
    permanent: 0,         // Should not be called for permanent errors
  };
  
  const base = baseDelays[errorType] ?? 30_000;
  const exponentialDelay = base * Math.pow(2, retryCount);
  const jitter = exponentialDelay * 0.2 * Math.random();
  const maxDelay = 10 * 60 * 1000; // Cap at 10 minutes
  
  return Math.min(exponentialDelay + jitter, maxDelay);
}
