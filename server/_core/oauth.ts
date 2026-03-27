import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { processScheduledJob } from "../scheduler";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Retry a function with exponential backoff for transient DB errors
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const errMsg = lastError.message || '';
      const isTransient = 
        errMsg.includes('no available peers') ||
        errMsg.includes('ECONNRESET') ||
        errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('EPIPE') ||
        errMsg.includes('Connection lost') ||
        errMsg.includes('ER_UNKNOWN_ERROR');
      
      if (!isTransient || attempt === maxRetries) {
        throw lastError;
      }
      
      // Reset DB connection on transient errors
      db.resetDbConnection();
      
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.log(`[OAuth] DB transient error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries}): ${errMsg.substring(0, 100)}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export function registerOAuthRoutes(app: Express) {
  // Cron trigger endpoint - piggybacks on /manus-oauth/callback to bypass platform OAuth
  // POST /manus-oauth/callback?cron=trigger&key=<AGENT_API_KEY>
  // Body: { "action": "trigger", "scheduleId": 1 } or { "action": "trigger_all" } or { "action": "status", "scheduleId": 1 }
  app.post("/api/oauth/callback", async (req: Request, res: Response) => {
    const cronParam = getQueryParam(req, "cron");
    const keyParam = getQueryParam(req, "key");

    if (cronParam !== "trigger") {
      res.status(400).json({ error: "Missing OAuth parameters" });
      return;
    }

    // Validate API key
    const agentKey = process.env.AGENT_API_KEY;
    if (!agentKey || keyParam !== agentKey) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    try {
      const body = req.body || {};
      const action = body.action || "trigger_all";

      if (action === "trigger" && body.scheduleId) {
        // Trigger a specific schedule
        const schedule = await db.getScheduledJob(body.scheduleId);
        if (!schedule) {
          res.status(404).json({ error: "Schedule not found" });
          return;
        }
        // Fire and forget - don't wait for completion
        processScheduledJob(schedule, "manual").catch(err => {
          console.error(`[CronTrigger] Error processing schedule ${body.scheduleId}:`, err);
        });
        res.json({ success: true, message: `Schedule ${body.scheduleId} (${schedule.name}) triggered`, scheduleId: body.scheduleId });
      } else if (action === "trigger_all") {
        // Trigger all enabled schedules
        const allSchedules = await db.getEnabledScheduledJobs();
        const triggered: any[] = [];
        for (const schedule of allSchedules) {
          processScheduledJob(schedule, "manual").catch(err => {
            console.error(`[CronTrigger] Error processing schedule ${schedule.id}:`, err);
          });
          triggered.push({ id: schedule.id, name: schedule.name });
        }
        res.json({ success: true, message: `Triggered ${triggered.length} schedules`, schedules: triggered });
      } else if (action === "status") {
        // Check status of latest runs
        // Get latest run for each enabled schedule
        const schedules = await db.getEnabledScheduledJobs();
        const runs = [];
        for (const s of schedules) {
          const latestRun = await db.getLatestScheduleRun(s.id);
          runs.push({ scheduleId: s.id, name: s.name, latestRun });
        }
        res.json({ success: true, runs });
      } else {
        res.status(400).json({ error: "Invalid action. Use 'trigger', 'trigger_all', or 'status'" });
      }
    } catch (error: any) {
      console.error("[CronTrigger] Error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      // Retry upsertUser with exponential backoff for transient DB errors
      await withRetry(() => db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      }));

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      // Redirect to home with error parameter instead of showing raw JSON error
      res.redirect(302, "/?login_error=1");
    }
  });
}
