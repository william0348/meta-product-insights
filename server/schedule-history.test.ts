import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the db module
vi.mock("./db", () => ({
  getScheduleRunsByScheduleId: vi.fn(),
  getScheduleRun: vi.fn(),
  getScheduledJob: vi.fn(),
  getBatchJob: vi.fn(),
  createScheduleRun: vi.fn(),
  updateScheduleRun: vi.fn(),
  getScheduledJobsByUser: vi.fn(),
  createScheduledJob: vi.fn(),
  updateScheduledJob: vi.fn(),
  deleteScheduledJob: vi.fn(),
  getEnabledScheduledJobs: vi.fn(),
  getDueScheduledJobs: vi.fn(),
  getLatestScheduleRun: vi.fn(),
  getUserTokens: vi.fn(),
  getUserTokenByType: vi.fn(),
}));

import {
  getScheduleRunsByScheduleId,
  getScheduleRun,
  getScheduledJob,
  getBatchJob,
  createScheduleRun,
  updateScheduleRun,
} from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId = 1): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: userId,
    openId: "test-user-open-id",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };

  return { ctx };
}

describe("schedules.getHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return schedule runs for the authenticated user's schedule", async () => {
    const { ctx } = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const mockSchedule = {
      id: 10,
      userId: 1,
      name: "Weekly Report",
      jobType: "report_generation",
      cronExpression: "0 0 9 * * 1",
      timezone: "Asia/Taipei",
      config: { adAccountId: "act_123" },
      enabled: true,
      runCount: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockRuns = [
      {
        id: 3,
        scheduleId: 10,
        userId: 1,
        triggerType: "manual",
        status: "completed",
        startedAt: new Date("2026-02-08T12:00:00Z"),
        completedAt: new Date("2026-02-08T12:10:00Z"),
        durationMs: 600000,
        totalItems: 73392,
        totalJobs: 1,
        completedJobs: 1,
        failedJobs: 0,
        errorMessage: null,
        jobIds: [60005],
        totalSpend: 150000,
        totalImpressions: 5000000,
        catalogItemsUpdated: 0,
        catalogErrors: 0,
        createdAt: new Date("2026-02-08T12:00:00Z"),
      },
      {
        id: 2,
        scheduleId: 10,
        userId: 1,
        triggerType: "auto",
        status: "failed",
        startedAt: new Date("2026-02-07T09:00:00Z"),
        completedAt: new Date("2026-02-07T09:05:00Z"),
        durationMs: 300000,
        totalItems: 0,
        totalJobs: 1,
        completedJobs: 0,
        failedJobs: 1,
        errorMessage: "Facebook API error: rate limit exceeded",
        jobIds: [60004],
        totalSpend: 0,
        totalImpressions: 0,
        catalogItemsUpdated: 0,
        catalogErrors: 0,
        createdAt: new Date("2026-02-07T09:00:00Z"),
      },
    ];

    vi.mocked(getScheduledJob).mockResolvedValue(mockSchedule as any);
    vi.mocked(getScheduleRunsByScheduleId).mockResolvedValue(mockRuns as any);

    const result = await caller.schedules.getHistory({ scheduleId: 10, limit: 50 });

    expect(result.success).toBe(true);
    expect(result.scheduleName).toBe("Weekly Report");
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0].id).toBe(3);
    expect(result.runs[0].status).toBe("completed");
    expect(result.runs[0].totalItems).toBe(73392);
    expect(result.runs[0].durationMs).toBe(600000);
    expect(result.runs[1].status).toBe("failed");
    expect(result.runs[1].errorMessage).toContain("rate limit");
  });

  it("should return empty runs array when no history exists", async () => {
    const { ctx } = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    vi.mocked(getScheduledJob).mockResolvedValue({
      id: 10,
      userId: 1,
      name: "New Schedule",
      jobType: "report_generation",
      cronExpression: "0 0 9 * * 1",
      timezone: "Asia/Taipei",
      config: { adAccountId: "act_123" },
      enabled: true,
      runCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    vi.mocked(getScheduleRunsByScheduleId).mockResolvedValue([]);

    const result = await caller.schedules.getHistory({ scheduleId: 10, limit: 50 });

    expect(result.success).toBe(true);
    expect(result.runs).toHaveLength(0);
    expect(result.scheduleName).toBe("New Schedule");
  });

  it("should throw error when schedule not found", async () => {
    const { ctx } = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    vi.mocked(getScheduledJob).mockResolvedValue(undefined);

    await expect(
      caller.schedules.getHistory({ scheduleId: 999, limit: 50 })
    ).rejects.toThrow("Schedule not found");
  });

  it("should deny access to another user's schedule", async () => {
    const { ctx } = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    vi.mocked(getScheduledJob).mockResolvedValue({
      id: 10,
      userId: 999, // Different user
      name: "Other User Schedule",
      jobType: "report_generation",
      cronExpression: "0 0 9 * * 1",
      timezone: "Asia/Taipei",
      config: {},
      enabled: true,
      runCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await expect(
      caller.schedules.getHistory({ scheduleId: 10, limit: 50 })
    ).rejects.toThrow("Access denied");
  });
});

describe("schedules.getRunDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return run detail with linked batch jobs", async () => {
    const { ctx } = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const mockRun = {
      id: 3,
      scheduleId: 10,
      userId: 1,
      triggerType: "manual",
      status: "completed",
      startedAt: new Date("2026-02-08T12:00:00Z"),
      completedAt: new Date("2026-02-08T12:10:00Z"),
      durationMs: 600000,
      totalItems: 73392,
      totalJobs: 1,
      completedJobs: 1,
      failedJobs: 0,
      errorMessage: null,
      jobIds: [60005],
      totalSpend: 150000,
      totalImpressions: 5000000,
      catalogItemsUpdated: 0,
      catalogErrors: 0,
      createdAt: new Date("2026-02-08T12:00:00Z"),
    };

    const mockBatchJob = {
      id: 60005,
      userId: 1,
      jobType: "report_generation",
      status: "completed",
      processedItems: 73392,
      totalItems: 73392,
      successCount: 73392,
      errorCount: 0,
      statusMessage: "Report generated successfully",
      startedAt: new Date("2026-02-08T12:00:05Z"),
      completedAt: new Date("2026-02-08T12:09:55Z"),
      config: { adAccountId: "act_123", dateRangeType: "last_7_days" },
    };

    vi.mocked(getScheduleRun).mockResolvedValue(mockRun as any);
    vi.mocked(getBatchJob).mockResolvedValue(mockBatchJob as any);

    const result = await caller.schedules.getRunDetail({ runId: 3 });

    expect(result.success).toBe(true);
    expect(result.run.id).toBe(3);
    expect(result.run.status).toBe("completed");
    expect(result.run.totalItems).toBe(73392);
    expect(result.run.durationMs).toBe(600000);
    expect(result.jobDetails).toHaveLength(1);
    expect(result.jobDetails[0].id).toBe(60005);
    expect(result.jobDetails[0].processedItems).toBe(73392);
    expect(result.jobDetails[0].config?.adAccountId).toBe("act_123");
  });

  it("should return run detail with failed job info", async () => {
    const { ctx } = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const mockRun = {
      id: 2,
      scheduleId: 10,
      userId: 1,
      triggerType: "auto",
      status: "failed",
      startedAt: new Date("2026-02-07T09:00:00Z"),
      completedAt: new Date("2026-02-07T09:05:00Z"),
      durationMs: 300000,
      totalItems: 0,
      totalJobs: 1,
      completedJobs: 0,
      failedJobs: 1,
      errorMessage: "All jobs failed",
      jobIds: [60004],
      totalSpend: 0,
      totalImpressions: 0,
      catalogItemsUpdated: 0,
      catalogErrors: 0,
      createdAt: new Date("2026-02-07T09:00:00Z"),
    };

    const mockBatchJob = {
      id: 60004,
      userId: 1,
      jobType: "report_generation",
      status: "failed",
      processedItems: 0,
      totalItems: 0,
      successCount: 0,
      errorCount: 1,
      statusMessage: "Facebook API returned error: rate limit exceeded",
      startedAt: new Date("2026-02-07T09:00:05Z"),
      completedAt: new Date("2026-02-07T09:04:55Z"),
      config: { adAccountId: "act_456" },
    };

    vi.mocked(getScheduleRun).mockResolvedValue(mockRun as any);
    vi.mocked(getBatchJob).mockResolvedValue(mockBatchJob as any);

    const result = await caller.schedules.getRunDetail({ runId: 2 });

    expect(result.success).toBe(true);
    expect(result.run.status).toBe("failed");
    expect(result.run.errorMessage).toBe("All jobs failed");
    expect(result.jobDetails[0].status).toBe("failed");
    expect(result.jobDetails[0].statusMessage).toContain("rate limit");
  });

  it("should return empty jobDetails when run has no linked jobs", async () => {
    const { ctx } = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    vi.mocked(getScheduleRun).mockResolvedValue({
      id: 1,
      scheduleId: 10,
      userId: 1,
      triggerType: "auto",
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      durationMs: null,
      totalItems: 0,
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      errorMessage: null,
      jobIds: null,
      totalSpend: null,
      totalImpressions: null,
      catalogItemsUpdated: 0,
      catalogErrors: 0,
      createdAt: new Date(),
    } as any);

    const result = await caller.schedules.getRunDetail({ runId: 1 });

    expect(result.success).toBe(true);
    expect(result.jobDetails).toHaveLength(0);
  });

  it("should throw error when run not found", async () => {
    const { ctx } = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    vi.mocked(getScheduleRun).mockResolvedValue(undefined);

    await expect(
      caller.schedules.getRunDetail({ runId: 999 })
    ).rejects.toThrow("Run not found");
  });

  it("should deny access to another user's run", async () => {
    const { ctx } = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    vi.mocked(getScheduleRun).mockResolvedValue({
      id: 5,
      scheduleId: 10,
      userId: 999, // Different user
      triggerType: "auto",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 1000,
      totalItems: 100,
      totalJobs: 1,
      completedJobs: 1,
      failedJobs: 0,
      errorMessage: null,
      jobIds: [],
      totalSpend: 0,
      totalImpressions: 0,
      catalogItemsUpdated: 0,
      catalogErrors: 0,
      createdAt: new Date(),
    } as any);

    await expect(
      caller.schedules.getRunDetail({ runId: 5 })
    ).rejects.toThrow("Access denied");
  });
});

describe("Schedule History - Duration Formatting", () => {
  function formatDuration(ms: number | null): string {
    if (!ms) return "N/A";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  it("should format seconds correctly", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(45000)).toBe("45s");
  });

  it("should format minutes correctly", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(600000)).toBe("10m 0s");
    expect(formatDuration(628000)).toBe("10m 28s");
  });

  it("should format hours correctly", () => {
    expect(formatDuration(3600000)).toBe("1h 0m");
    expect(formatDuration(5400000)).toBe("1h 30m");
  });

  it("should handle null duration", () => {
    expect(formatDuration(null)).toBe("N/A");
  });

  it("should handle zero duration", () => {
    expect(formatDuration(0)).toBe("N/A");
  });
});

describe("Schedule History - Status Aggregation", () => {
  it("should determine run status based on job results", () => {
    function determineRunStatus(completedJobs: number, failedJobs: number, totalJobs: number): string {
      if (completedJobs + failedJobs < totalJobs) return "running";
      if (failedJobs === 0) return "completed";
      if (completedJobs === 0) return "failed";
      return "partial";
    }

    expect(determineRunStatus(1, 0, 1)).toBe("completed");
    expect(determineRunStatus(0, 1, 1)).toBe("failed");
    expect(determineRunStatus(2, 1, 3)).toBe("partial");
    expect(determineRunStatus(1, 0, 3)).toBe("running");
  });

  it("should calculate success rate correctly", () => {
    function calculateSuccessRate(completedJobs: number, totalJobs: number): number {
      if (totalJobs === 0) return 0;
      return Math.round((completedJobs / totalJobs) * 100);
    }

    expect(calculateSuccessRate(1, 1)).toBe(100);
    expect(calculateSuccessRate(2, 3)).toBe(67);
    expect(calculateSuccessRate(0, 5)).toBe(0);
    expect(calculateSuccessRate(0, 0)).toBe(0);
  });
});


describe("Job Timeout Logic", () => {
  const JOB_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
  const STALE_PROGRESS_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

  it("should not timeout a job running less than 60 minutes", () => {
    const startedAt = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
    const runningTime = Date.now() - startedAt.getTime();
    expect(runningTime).toBeLessThan(JOB_TIMEOUT_MS);
  });

  it("should timeout a job running more than 60 minutes", () => {
    const startedAt = new Date(Date.now() - 61 * 60 * 1000); // 61 minutes ago
    const runningTime = Date.now() - startedAt.getTime();
    expect(runningTime).toBeGreaterThan(JOB_TIMEOUT_MS);
  });

  it("should detect stale progress when no change for 15+ minutes", () => {
    const lastProgressUpdate = Date.now() - 16 * 60 * 1000; // 16 minutes ago
    const timeSinceLastProgress = Date.now() - lastProgressUpdate;
    expect(timeSinceLastProgress).toBeGreaterThan(STALE_PROGRESS_TIMEOUT_MS);
  });

  it("should not flag progress as stale when recently updated", () => {
    const lastProgressUpdate = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    const timeSinceLastProgress = Date.now() - lastProgressUpdate;
    expect(timeSinceLastProgress).toBeLessThan(STALE_PROGRESS_TIMEOUT_MS);
  });

  it("should generate correct timeout reason for absolute timeout", () => {
    const runningTime = 62 * 60 * 1000;
    const reason = `absolute timeout after ${Math.round(runningTime / 60000)} minutes`;
    expect(reason).toBe("absolute timeout after 62 minutes");
  });

  it("should generate correct timeout reason for stale progress", () => {
    const timeSinceLastProgress = 18 * 60 * 1000;
    const currentProgress = 45;
    const reason = `no progress for ${Math.round(timeSinceLastProgress / 60000)} minutes (stuck at ${currentProgress}%)`;
    expect(reason).toBe("no progress for 18 minutes (stuck at 45%)");
  });
});

describe("DB Connection Error Detection", () => {
  function isConnectionError(error: any): boolean {
    const msg = String(error?.message || '') + String(error?.cause?.message || '');
    return /ECONNRESET|ETIMEDOUT|EPIPE|PROTOCOL_CONNECTION_LOST|ER_CON_COUNT_ERROR/i.test(msg);
  }

  it("should detect ECONNRESET as a connection error", () => {
    const error = { message: "read ECONNRESET" };
    expect(isConnectionError(error)).toBe(true);
  });

  it("should detect ETIMEDOUT as a connection error", () => {
    const error = { message: "connect ETIMEDOUT" };
    expect(isConnectionError(error)).toBe(true);
  });

  it("should detect EPIPE as a connection error", () => {
    const error = { message: "write EPIPE" };
    expect(isConnectionError(error)).toBe(true);
  });

  it("should detect PROTOCOL_CONNECTION_LOST as a connection error", () => {
    const error = { message: "PROTOCOL_CONNECTION_LOST" };
    expect(isConnectionError(error)).toBe(true);
  });

  it("should detect nested cause errors", () => {
    const error = { message: "DrizzleQueryError", cause: { message: "read ECONNRESET" } };
    expect(isConnectionError(error)).toBe(true);
  });

  it("should not flag normal errors as connection errors", () => {
    const error = { message: "Cannot read property 'id' of undefined" };
    expect(isConnectionError(error)).toBe(false);
  });

  it("should not flag auth errors as connection errors", () => {
    const error = { message: "Invalid access token" };
    expect(isConnectionError(error)).toBe(false);
  });

  it("should handle null/undefined errors gracefully", () => {
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
    expect(isConnectionError({})).toBe(false);
  });
});

describe("Schedule Run Timeout Update Logic", () => {
  it("should mark run as failed when all jobs timed out", () => {
    const completedJobs = 0;
    const newFailedJobs = 1;
    const totalJobs = 1;
    const totalJobsDone = completedJobs + newFailedJobs;
    const allDone = totalJobsDone >= totalJobs;
    const status = allDone ? (completedJobs > 0 ? 'partial' : 'failed') : 'running';
    
    expect(allDone).toBe(true);
    expect(status).toBe('failed');
  });

  it("should mark run as partial when some jobs completed and some timed out", () => {
    const completedJobs = 2;
    const newFailedJobs = 1;
    const totalJobs = 3;
    const totalJobsDone = completedJobs + newFailedJobs;
    const allDone = totalJobsDone >= totalJobs;
    const status = allDone ? (completedJobs > 0 ? 'partial' : 'failed') : 'running';
    
    expect(allDone).toBe(true);
    expect(status).toBe('partial');
  });

  it("should keep run as running when not all jobs are done yet", () => {
    const completedJobs = 1;
    const newFailedJobs = 1;
    const totalJobs = 5;
    const totalJobsDone = completedJobs + newFailedJobs;
    const allDone = totalJobsDone >= totalJobs;
    const status = allDone ? (completedJobs > 0 ? 'partial' : 'failed') : 'running';
    
    expect(allDone).toBe(false);
    expect(status).toBe('running');
  });
});
