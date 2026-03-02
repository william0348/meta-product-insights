import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { agentRouter } from "./agent-api";

// Mock the db module
vi.mock("./db", () => ({
  getEnabledScheduledJobs: vi.fn(),
  getScheduledJob: vi.fn(),
  getScheduleRun: vi.fn(),
  getBatchJob: vi.fn(),
  getScheduleRunsByScheduleId: vi.fn(),
}));

// Mock the scheduler module
vi.mock("./scheduler", () => ({
  processScheduledJob: vi.fn(),
}));

import {
  getEnabledScheduledJobs,
  getScheduledJob,
  getScheduleRun,
  getBatchJob,
  getScheduleRunsByScheduleId,
} from "./db";
import { processScheduledJob } from "./scheduler";

const TEST_API_KEY = "test-agent-key-123";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter);
  return app;
}

describe("Agent API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.AGENT_API_KEY = TEST_API_KEY;
  });

  describe("Authentication", () => {
    it("rejects requests without Authorization header", async () => {
      const app = createApp();
      const res = await request(app).get("/api/agent/schedules");
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Missing or invalid Authorization");
    });

    it("rejects requests with wrong API key", async () => {
      const app = createApp();
      const res = await request(app)
        .get("/api/agent/schedules")
        .set("Authorization", "Bearer wrong-key");
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Invalid API key");
    });

    it("rejects requests when AGENT_API_KEY is not configured", async () => {
      delete process.env.AGENT_API_KEY;
      const app = createApp();
      const res = await request(app)
        .get("/api/agent/schedules")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);
      expect(res.status).toBe(503);
      expect(res.body.error).toContain("not configured");
    });

    it("accepts requests with correct API key", async () => {
      (getEnabledScheduledJobs as any).mockResolvedValue([]);
      const app = createApp();
      const res = await request(app)
        .get("/api/agent/schedules")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /api/agent/schedules", () => {
    it("returns list of enabled schedules", async () => {
      const mockSchedules = [
        {
          id: 1,
          name: "Weekly Report",
          cronExpression: "0 0 7 * * 1",
          timezone: "Asia/Taipei",
          enabled: true,
          jobType: "report_and_catalog",
          lastRunAt: new Date("2026-02-25T00:00:00Z"),
          lastRunStatus: "success",
          nextRunAt: new Date("2026-03-02T00:00:00Z"),
        },
      ];
      (getEnabledScheduledJobs as any).mockResolvedValue(mockSchedules);

      const app = createApp();
      const res = await request(app)
        .get("/api/agent/schedules")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.schedules).toHaveLength(1);
      expect(res.body.schedules[0].name).toBe("Weekly Report");
    });
  });

  describe("POST /api/agent/trigger/:scheduleId", () => {
    it("rejects invalid scheduleId", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/agent/trigger/abc")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent schedule", async () => {
      (getScheduledJob as any).mockResolvedValue(undefined);
      const app = createApp();
      const res = await request(app)
        .post("/api/agent/trigger/999")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);
      expect(res.status).toBe(404);
    });

    it("rejects disabled schedule", async () => {
      (getScheduledJob as any).mockResolvedValue({ id: 1, name: "Test", enabled: false });
      const app = createApp();
      const res = await request(app)
        .post("/api/agent/trigger/1")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("disabled");
    });

    it("triggers schedule and returns run info", async () => {
      const mockSchedule = { id: 1, name: "Weekly Report", enabled: true };
      (getScheduledJob as any).mockResolvedValue(mockSchedule);
      (processScheduledJob as any).mockResolvedValue(undefined);
      (getScheduleRunsByScheduleId as any).mockResolvedValue([
        { id: 210004, jobIds: [270004] },
      ]);

      const app = createApp();
      const res = await request(app)
        .post("/api/agent/trigger/1")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.runId).toBe(210004);
      expect(res.body.jobIds).toEqual([270004]);
      expect(processScheduledJob).toHaveBeenCalledWith(mockSchedule, "manual");
    });
  });

  describe("GET /api/agent/status/:runId", () => {
    it("returns run and job details", async () => {
      const mockRun = {
        id: 210004,
        scheduleId: 1,
        status: "running",
        triggerType: "manual",
        startedAt: new Date("2026-02-25T10:00:00Z"),
        completedAt: null,
        durationMs: null,
        totalItems: null,
        totalSpend: null,
        errorMessage: null,
        retryCount: 0,
        completedJobs: 0,
        failedJobs: 0,
        jobIds: [270004],
      };
      const mockJob = {
        id: 270004,
        status: "running",
        progress: 65,
        processedItems: 31000,
        successCount: null,
        errorCount: null,
        statusMessage: "Fetched 31,000 records…",
        startedAt: new Date("2026-02-25T10:00:00Z"),
        completedAt: null,
      };
      (getScheduleRun as any).mockResolvedValue(mockRun);
      (getBatchJob as any).mockResolvedValue(mockJob);

      const app = createApp();
      const res = await request(app)
        .get("/api/agent/status/210004")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.run.status).toBe("running");
      expect(res.body.jobs).toHaveLength(1);
      expect(res.body.jobs[0].progress).toBe(65);
      expect(res.body.jobs[0].processedItems).toBe(31000);
    });

    it("returns 404 for non-existent run", async () => {
      (getScheduleRun as any).mockResolvedValue(undefined);
      const app = createApp();
      const res = await request(app)
        .get("/api/agent/status/999999")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/agent/latest/:scheduleId", () => {
    it("returns latest run with job details", async () => {
      const mockSchedule = { id: 1, name: "Weekly Report" };
      const mockRun = {
        id: 210004,
        status: "completed",
        triggerType: "manual",
        startedAt: new Date("2026-02-25T10:00:00Z"),
        completedAt: new Date("2026-02-25T10:10:00Z"),
        durationMs: 600000,
        totalItems: 67476,
        errorMessage: null,
        jobIds: [270004],
      };
      const mockJob = {
        id: 270004,
        status: "completed",
        progress: 100,
        processedItems: 67476,
        successCount: 67476,
        errorCount: 0,
        statusMessage: "Report + Catalog update completed: 67476 products",
        startedAt: new Date("2026-02-25T10:00:00Z"),
        completedAt: new Date("2026-02-25T10:10:00Z"),
      };
      (getScheduledJob as any).mockResolvedValue(mockSchedule);
      (getScheduleRunsByScheduleId as any).mockResolvedValue([mockRun]);
      (getBatchJob as any).mockResolvedValue(mockJob);

      const app = createApp();
      const res = await request(app)
        .get("/api/agent/latest/1")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.schedule.name).toBe("Weekly Report");
      expect(res.body.latestRun.status).toBe("completed");
      expect(res.body.jobs).toHaveLength(1);
      expect(res.body.jobs[0].successCount).toBe(67476);
    });

    it("returns null when no runs exist", async () => {
      (getScheduledJob as any).mockResolvedValue({ id: 1, name: "Test" });
      (getScheduleRunsByScheduleId as any).mockResolvedValue([]);

      const app = createApp();
      const res = await request(app)
        .get("/api/agent/latest/1")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.latestRun).toBeNull();
    });
  });
});
