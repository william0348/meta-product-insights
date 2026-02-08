import { describe, it, expect } from "vitest";
import { classifyError, calculateRetryDelay } from "./error-classifier";

describe("classifyError", () => {
  describe("Facebook API error codes", () => {
    it("classifies rate limit error code 4 as rate_limit", () => {
      const error = { response: { data: { error: { code: 4 } } }, message: "Too many calls" };
      const result = classifyError(error);
      expect(result.type).toBe("rate_limit");
      expect(result.retryable).toBe(true);
    });

    it("classifies rate limit error code 17 as rate_limit", () => {
      const error = { response: { data: { error: { code: 17 } } }, message: "Rate limit reached" };
      const result = classifyError(error);
      expect(result.type).toBe("rate_limit");
      expect(result.retryable).toBe(true);
    });

    it("classifies error code 80000 as rate_limit", () => {
      const error = { response: { data: { error: { code: 80000 } } }, message: "API rate limit" };
      const result = classifyError(error);
      expect(result.type).toBe("rate_limit");
      expect(result.retryable).toBe(true);
    });

    it("classifies transient error code 1 as transient", () => {
      const error = { response: { data: { error: { code: 1 } } }, message: "Unknown error" };
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies transient error code 2 as transient", () => {
      const error = { response: { data: { error: { code: 2 } } }, message: "Temporary issue" };
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies permanent error code 100 as permanent", () => {
      const error = { response: { data: { error: { code: 100 } } }, message: "Invalid parameter" };
      const result = classifyError(error);
      expect(result.type).toBe("permanent");
      expect(result.retryable).toBe(false);
    });

    it("classifies permanent error code 200 as permanent", () => {
      const error = { response: { data: { error: { code: 200 } } }, message: "Permission error" };
      const result = classifyError(error);
      expect(result.type).toBe("permanent");
      expect(result.retryable).toBe(false);
    });

    it("classifies permanent error code 10 as permanent", () => {
      const error = { response: { data: { error: { code: 10 } } }, message: "Permission denied" };
      const result = classifyError(error);
      expect(result.type).toBe("permanent");
      expect(result.retryable).toBe(false);
    });
  });

  describe("HTTP status codes", () => {
    it("classifies 429 as rate_limit", () => {
      const error = { response: { status: 429 }, message: "Too Many Requests" };
      const result = classifyError(error);
      expect(result.type).toBe("rate_limit");
      expect(result.retryable).toBe(true);
    });

    it("classifies 500 as transient", () => {
      const error = { response: { status: 500 }, message: "Internal Server Error" };
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies 502 as transient", () => {
      const error = { response: { status: 502 }, message: "Bad Gateway" };
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies 503 as transient", () => {
      const error = { response: { status: 503 }, message: "Service Unavailable" };
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies 408 as timeout", () => {
      const error = { response: { status: 408 }, message: "Request Timeout" };
      const result = classifyError(error);
      expect(result.type).toBe("timeout");
      expect(result.retryable).toBe(true);
    });

    it("classifies 400 as permanent", () => {
      const error = { response: { status: 400 }, message: "Bad Request" };
      const result = classifyError(error);
      expect(result.type).toBe("permanent");
      expect(result.retryable).toBe(false);
    });

    it("classifies 403 as permanent", () => {
      const error = { response: { status: 403 }, message: "Forbidden" };
      const result = classifyError(error);
      expect(result.type).toBe("permanent");
      expect(result.retryable).toBe(false);
    });
  });

  describe("Node.js system error codes", () => {
    it("classifies ETIMEDOUT as timeout", () => {
      const error = { code: "ETIMEDOUT", message: "Connection timed out" };
      const result = classifyError(error);
      expect(result.type).toBe("timeout");
      expect(result.retryable).toBe(true);
    });

    it("classifies ECONNRESET as transient", () => {
      const error = { code: "ECONNRESET", message: "Connection reset" };
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies ECONNREFUSED as transient", () => {
      const error = { code: "ECONNREFUSED", message: "Connection refused" };
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies ECONNABORTED as transient", () => {
      const error = { code: "ECONNABORTED", message: "Connection aborted" };
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });
  });

  describe("Error message patterns", () => {
    it("classifies timeout message as timeout", () => {
      const error = new Error("Request timeout after 30000ms");
      const result = classifyError(error);
      expect(result.type).toBe("timeout");
      expect(result.retryable).toBe(true);
    });

    it("classifies network error as transient", () => {
      const error = new Error("Network Error");
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies rate limit message as rate_limit", () => {
      const error = new Error("Rate limit exceeded, please try again later");
      const result = classifyError(error);
      expect(result.type).toBe("rate_limit");
      expect(result.retryable).toBe(true);
    });

    it("classifies 'too many requests' as rate_limit", () => {
      const error = new Error("Too many requests");
      const result = classifyError(error);
      expect(result.type).toBe("rate_limit");
      expect(result.retryable).toBe(true);
    });

    it("classifies 'socket hang up' as transient", () => {
      const error = new Error("socket hang up");
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies 'gateway timeout' as timeout", () => {
      const error = new Error("504 Gateway Timeout");
      const result = classifyError(error);
      expect(result.type).toBe("timeout");
      expect(result.retryable).toBe(true);
    });

    it("classifies 'invalid access token' as permanent", () => {
      const error = new Error("Invalid access token");
      const result = classifyError(error);
      expect(result.type).toBe("permanent");
      expect(result.retryable).toBe(false);
    });

    it("classifies 'permission denied' as permanent", () => {
      const error = new Error("Permission denied for this resource");
      const result = classifyError(error);
      expect(result.type).toBe("permanent");
      expect(result.retryable).toBe(false);
    });

    it("classifies 'does not exist' as permanent", () => {
      const error = new Error("The ad account does not exist");
      const result = classifyError(error);
      expect(result.type).toBe("permanent");
      expect(result.retryable).toBe(false);
    });

    it("classifies 'please retry your request later' as transient", () => {
      const error = new Error("Please retry your request later");
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies 'Request failed with status code 500' as transient", () => {
      const error = new Error("Request failed with status code 500");
      const result = classifyError(error);
      expect(result.type).toBe("transient");
      expect(result.retryable).toBe(true);
    });

    it("classifies 'Request failed with status code 429' as rate_limit", () => {
      const error = new Error("Request failed with status code 429");
      const result = classifyError(error);
      expect(result.type).toBe("rate_limit");
      expect(result.retryable).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("handles null error", () => {
      const result = classifyError(null);
      expect(result.retryable).toBe(true);
      expect(result.type).toBe("transient");
    });

    it("handles undefined error", () => {
      const result = classifyError(undefined);
      expect(result.retryable).toBe(true);
      expect(result.type).toBe("transient");
    });

    it("handles string error", () => {
      const result = classifyError("Something went wrong");
      expect(result.retryable).toBe(true);
    });

    it("handles error with nested data.error.code", () => {
      const error = { data: { error: { code: 4 } }, message: "Rate limited" };
      const result = classifyError(error);
      expect(result.type).toBe("rate_limit");
      expect(result.retryable).toBe(true);
    });

    it("handles error with error.code directly", () => {
      const error = { error: { code: 100 }, message: "Invalid parameter" };
      const result = classifyError(error);
      expect(result.type).toBe("permanent");
      expect(result.retryable).toBe(false);
    });
  });
});

describe("calculateRetryDelay", () => {
  it("returns base delay for first retry of transient error", () => {
    const delay = calculateRetryDelay(0, "transient");
    // Base is 30s, with up to 20% jitter: 30000 to 36000
    expect(delay).toBeGreaterThanOrEqual(30000);
    expect(delay).toBeLessThanOrEqual(36000);
  });

  it("returns higher delay for rate_limit errors", () => {
    const delay = calculateRetryDelay(0, "rate_limit");
    // Base is 60s, with up to 20% jitter: 60000 to 72000
    expect(delay).toBeGreaterThanOrEqual(60000);
    expect(delay).toBeLessThanOrEqual(72000);
  });

  it("applies exponential backoff", () => {
    const delay0 = calculateRetryDelay(0, "transient");
    const delay1 = calculateRetryDelay(1, "transient");
    const delay2 = calculateRetryDelay(2, "transient");
    
    // Each retry should roughly double (accounting for jitter)
    expect(delay1).toBeGreaterThan(delay0 * 1.5);
    expect(delay2).toBeGreaterThan(delay1 * 1.5);
  });

  it("caps delay at 10 minutes", () => {
    const delay = calculateRetryDelay(10, "rate_limit");
    expect(delay).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("returns 0 for permanent errors", () => {
    // Permanent errors have base delay of 0
    // 0 * 2^0 = 0, jitter = 0 * 0.2 * random = 0
    const delay = calculateRetryDelay(0, "permanent");
    expect(delay).toBe(0);
  });

  it("returns base delay for timeout errors", () => {
    const delay = calculateRetryDelay(0, "timeout");
    // Base is 30s
    expect(delay).toBeGreaterThanOrEqual(30000);
    expect(delay).toBeLessThanOrEqual(36000);
  });
});
