/**
 * Scheduler
 * 
 * This module handles scheduled job execution.
 * It checks for due scheduled jobs and creates batch jobs for them.
 */

import { 
  getDueScheduledJobs, 
  updateScheduledJob,
  createBatchJob,
  getUserToken
} from "./db";
import { ScheduledJob } from "../drizzle/schema";

// Scheduler state
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// Configuration
const SCHEDULER_INTERVAL_MS = 60000; // Check every minute

/**
 * Parse cron expression and calculate next run time
 * Cron format: "second minute hour dayOfMonth month dayOfWeek"
 * Example: "0 0 9 * * 1" = Every Monday at 9:00 AM
 */
function calculateNextRunTime(schedule: ScheduledJob): Date {
  const now = new Date();
  
  // Parse cron expression: "second minute hour dayOfMonth month dayOfWeek"
  const parts = schedule.cronExpression.split(' ');
  if (parts.length < 6) {
    // Invalid cron, default to next week
    const next = new Date(now);
    next.setDate(next.getDate() + 7);
    return next;
  }
  
  const [, minutePart, hourPart, dayOfMonthPart, , dayOfWeekPart] = parts;
  
  const minute = minutePart === '*' ? 0 : parseInt(minutePart);
  const hour = hourPart === '*' ? 9 : parseInt(hourPart);
  
  // Check if it's a weekly schedule (dayOfWeek is specified)
  if (dayOfWeekPart !== '*') {
    const dayOfWeek = parseInt(dayOfWeekPart); // 0 = Sunday, 1 = Monday, etc.
    
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    
    // Calculate days until next occurrence
    const currentDay = now.getDay();
    let daysUntil = dayOfWeek - currentDay;
    if (daysUntil < 0) {
      daysUntil += 7;
    }
    // If it's the same day but past the scheduled time, schedule for next week
    if (daysUntil === 0 && now >= next) {
      daysUntil = 7;
    }
    
    next.setDate(next.getDate() + daysUntil);
    return next;
  }
  
  // Check if it's a monthly schedule (dayOfMonth is specified)
  if (dayOfMonthPart !== '*') {
    const dayOfMonth = parseInt(dayOfMonthPart);
    
    const next = new Date(now);
    next.setDate(dayOfMonth);
    next.setHours(hour, minute, 0, 0);
    
    // If past this month's date, schedule for next month
    if (now >= next) {
      next.setMonth(next.getMonth() + 1);
    }
    
    return next;
  }
  
  // Daily schedule
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  
  // If past today's time, schedule for tomorrow
  if (now >= next) {
    next.setDate(next.getDate() + 1);
  }
  
  return next;
}

/**
 * Process a scheduled job
 */
async function processScheduledJob(schedule: ScheduledJob): Promise<void> {
  console.log(`[Scheduler] Processing scheduled job ${schedule.id}: ${schedule.name}`);
  
  try {
    // Get user's saved tokens
    const adsToken = await getUserToken(schedule.userId, 'ads_management');
    
    if (!adsToken || !adsToken.accessToken) {
      console.error(`[Scheduler] No ads token found for user ${schedule.userId}`);
      await updateScheduledJob(schedule.id, {
        lastRunStatus: 'failed',
      });
      return;
    }
    
    // Build job config from schedule config and user tokens
    const jobConfig = {
      ...schedule.config,
      accessToken: adsToken.accessToken,
      adAccountId: schedule.config?.adAccountId || adsToken.adAccountId || undefined,
      minSpend: schedule.config?.minSpend || adsToken.minSpend || undefined,
      minCTR: schedule.config?.minCTR || adsToken.minCTR || undefined,
    };
    
    // Create a batch job for report generation
    const jobId = await createBatchJob({
      userId: schedule.userId,
      jobType: 'report_generation',
      config: jobConfig,
    });
    
    if (!jobId) {
      throw new Error('Failed to create batch job');
    }
    
    console.log(`[Scheduler] Created batch job ${jobId} for schedule ${schedule.id}`);
    
    // Update schedule with next run time
    const nextRunAt = calculateNextRunTime(schedule);
    
    await updateScheduledJob(schedule.id, {
      lastRunAt: new Date(),
      nextRunAt,
      runCount: (schedule.runCount || 0) + 1,
      lastRunStatus: 'success',
      lastRunJobId: jobId,
    });
    
    console.log(`[Scheduler] Next run for schedule ${schedule.id}: ${nextRunAt.toISOString()}`);
    
  } catch (error: any) {
    console.error(`[Scheduler] Error processing schedule ${schedule.id}:`, error);
    
    await updateScheduledJob(schedule.id, {
      lastRunStatus: 'failed',
    });
  }
}

/**
 * Check and process due scheduled jobs
 */
async function checkScheduledJobs(): Promise<void> {
  try {
    const dueJobs = await getDueScheduledJobs();
    
    if (dueJobs.length === 0) {
      return;
    }
    
    console.log(`[Scheduler] Found ${dueJobs.length} due scheduled jobs`);
    
    for (const schedule of dueJobs) {
      await processScheduledJob(schedule);
    }
    
  } catch (error) {
    console.error('[Scheduler] Error checking scheduled jobs:', error);
  }
}

/**
 * Start the scheduler
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    console.log('[Scheduler] Already running');
    return;
  }
  
  console.log('[Scheduler] Starting scheduler...');
  
  // Check immediately on startup
  checkScheduledJobs().catch(console.error);
  
  // Then check periodically
  schedulerInterval = setInterval(() => {
    checkScheduledJobs().catch(console.error);
  }, SCHEDULER_INTERVAL_MS);
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Scheduler] Stopped');
  }
}
