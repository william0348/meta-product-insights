/**
 * Agent API
 * 
 * Public REST API endpoints for Manus Agent to trigger and monitor scheduled jobs.
 * Secured with a simple Bearer token (AGENT_API_KEY environment variable).
 * 
 * Endpoints:
 *   GET  /api/agent/schedules           - List all enabled schedules
 *   POST /api/agent/trigger/:scheduleId - Trigger a schedule Run Now
 *   GET  /api/agent/status/:runId       - Check schedule run status and job progress
 *   GET  /api/agent/latest/:scheduleId  - Get the latest run for a schedule
 */

import { Router, Request, Response, NextFunction } from "express";
import { 
  getEnabledScheduledJobs, 
  getScheduledJob, 
  getScheduleRun, 
  getBatchJob,
  getScheduleRunsByScheduleId,
  updateBatchJob,
  updateScheduleRun,
} from "./db";
import { processScheduledJob } from "./scheduler";

const agentRouter = Router();

// --- Auth Middleware ---
function agentAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.AGENT_API_KEY;
  
  if (!apiKey) {
    console.warn("[AgentAPI] AGENT_API_KEY not configured — all requests rejected");
    res.status(503).json({ error: "Agent API not configured" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer <AGENT_API_KEY>" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== apiKey) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  next();
}

agentRouter.use(agentAuth);

// --- GET /api/agent/schedules ---
// List all enabled schedules with basic info
agentRouter.get("/schedules", async (_req: Request, res: Response) => {
  try {
    const schedules = await getEnabledScheduledJobs();
    
    const result = schedules.map(s => ({
      id: s.id,
      name: s.name,
      cronExpression: s.cronExpression,
      timezone: s.timezone,
      enabled: s.enabled,
      jobType: s.jobType,
      lastRunAt: s.lastRunAt,
      lastRunStatus: s.lastRunStatus,
      nextRunAt: s.nextRunAt,
    }));

    res.json({ success: true, schedules: result });
  } catch (error: any) {
    console.error("[AgentAPI] Error listing schedules:", error.message);
    res.status(500).json({ error: "Failed to list schedules", details: error.message });
  }
});

// --- POST /api/agent/trigger/:scheduleId ---
// Trigger a schedule to run immediately. Returns the schedule run ID for monitoring.
agentRouter.post("/trigger/:scheduleId", async (req: Request, res: Response) => {
  try {
    const scheduleId = parseInt(req.params.scheduleId, 10);
    if (isNaN(scheduleId)) {
      res.status(400).json({ error: "Invalid scheduleId" });
      return;
    }

    const schedule = await getScheduledJob(scheduleId);
    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    if (!schedule.enabled) {
      res.status(400).json({ error: "Schedule is disabled" });
      return;
    }

    console.log(`[AgentAPI] Triggering schedule ${scheduleId}: ${schedule.name}`);

    // Trigger the job (this creates a schedule_run and batch_job)
    await processScheduledJob(schedule, "manual");

    // Get the latest run to return its ID
    const runs = await getScheduleRunsByScheduleId(scheduleId, 1);
    const latestRun = runs[0];

    res.json({
      success: true,
      message: `Schedule "${schedule.name}" triggered successfully`,
      scheduleId,
      runId: latestRun?.id ?? null,
      jobIds: latestRun?.jobIds ?? null,
    });
  } catch (error: any) {
    console.error("[AgentAPI] Error triggering schedule:", error.message);
    res.status(500).json({ error: "Failed to trigger schedule", details: error.message });
  }
});

// --- GET /api/agent/status/:runId ---
// Check the status of a specific schedule run and its associated batch job
agentRouter.get("/status/:runId", async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.runId, 10);
    if (isNaN(runId)) {
      res.status(400).json({ error: "Invalid runId" });
      return;
    }

    const run = await getScheduleRun(runId);
    if (!run) {
      res.status(404).json({ error: "Schedule run not found" });
      return;
    }

    // Get the associated batch jobs for detailed progress
    let jobDetails: Array<Record<string, any>> = [];
    if (run.jobIds && run.jobIds.length > 0) {
      for (const jobId of run.jobIds) {
        const job = await getBatchJob(jobId);
        if (job) {
          jobDetails.push({
            id: job.id,
            status: job.status,
            progress: job.progress,
            processedItems: job.processedItems,
            successCount: job.successCount,
            errorCount: job.errorCount,
            statusMessage: job.statusMessage,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
          });
        }
      }
    }

    res.json({
      success: true,
      run: {
        id: run.id,
        scheduleId: run.scheduleId,
        status: run.status,
        triggerType: run.triggerType,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        totalItems: run.totalItems,
        totalSpend: run.totalSpend,
        errorMessage: run.errorMessage,
        retryCount: run.retryCount,
        completedJobs: run.completedJobs,
        failedJobs: run.failedJobs,
      },
      jobs: jobDetails,
    });
  } catch (error: any) {
    console.error("[AgentAPI] Error getting status:", error.message);
    res.status(500).json({ error: "Failed to get status", details: error.message });
  }
});

// --- GET /api/agent/latest/:scheduleId ---
// Get the latest run for a schedule (useful for checking if a trigger worked)
agentRouter.get("/latest/:scheduleId", async (req: Request, res: Response) => {
  try {
    const scheduleId = parseInt(req.params.scheduleId, 10);
    if (isNaN(scheduleId)) {
      res.status(400).json({ error: "Invalid scheduleId" });
      return;
    }

    const schedule = await getScheduledJob(scheduleId);
    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    const runs = await getScheduleRunsByScheduleId(scheduleId, 1);
    const latestRun = runs[0];

    if (!latestRun) {
      res.json({
        success: true,
        schedule: { id: schedule.id, name: schedule.name },
        latestRun: null,
        job: null,
      });
      return;
    }

    // Get job details
    let jobDetails: Array<Record<string, any>> = [];
    if (latestRun.jobIds && latestRun.jobIds.length > 0) {
      for (const jobId of latestRun.jobIds) {
        const job = await getBatchJob(jobId);
        if (job) {
          jobDetails.push({
            id: job.id,
            status: job.status,
            progress: job.progress,
            processedItems: job.processedItems,
            successCount: job.successCount,
            errorCount: job.errorCount,
            statusMessage: job.statusMessage,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
          });
        }
      }
    }

    res.json({
      success: true,
      schedule: { id: schedule.id, name: schedule.name },
      latestRun: {
        id: latestRun.id,
        status: latestRun.status,
        triggerType: latestRun.triggerType,
        startedAt: latestRun.startedAt,
        completedAt: latestRun.completedAt,
        durationMs: latestRun.durationMs,
        totalItems: latestRun.totalItems,
        errorMessage: latestRun.errorMessage,
      },
      jobs: jobDetails,
    });
  } catch (error: any) {
    console.error("[AgentAPI] Error getting latest run:", error.message);
    res.status(500).json({ error: "Failed to get latest run", details: error.message });
  }
});

// --- POST /api/agent/cancel/:jobId ---
// Cancel a running or queued job
agentRouter.post("/cancel/:jobId", async (req: Request, res: Response) => {
  try {
    const jobId = parseInt(req.params.jobId, 10);
    if (isNaN(jobId)) {
      res.status(400).json({ error: "Invalid jobId" });
      return;
    }

    const job = await getBatchJob(jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (job.status !== "running" && job.status !== "queued") {
      res.status(400).json({ error: `Cannot cancel job with status: ${job.status}` });
      return;
    }

    // Mark job as cancelled
    await updateBatchJob(jobId, {
      status: "failed",
      statusMessage: "Cancelled via Agent API",
      completedAt: new Date(),
    });

    // Also update the associated schedule_run if exists
    const scheduleRunId = job.config?.scheduleRunId;
    if (scheduleRunId) {
      try {
        const run = await getScheduleRun(scheduleRunId);
        if (run && run.status === "running") {
          await updateScheduleRun(scheduleRunId, {
            status: "failed",
            errorMessage: "Cancelled via Agent API",
            completedAt: new Date(),
            durationMs: Date.now() - run.startedAt.getTime(),
          });
        }
      } catch (err) {
        console.warn("[AgentAPI] Failed to update schedule run after cancel:", err);
      }
    }

    console.log(`[AgentAPI] Job ${jobId} cancelled`);

    res.json({
      success: true,
      message: `Job ${jobId} cancelled successfully`,
      jobId,
    });
  } catch (error: any) {
    console.error("[AgentAPI] Error cancelling job:", error.message);
    res.status(500).json({ error: "Failed to cancel job", details: error.message });
  }
});

export { agentRouter };
