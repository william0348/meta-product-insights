/**
 * Scheduler
 * 
 * This module handles scheduled job execution.
 * It checks for due scheduled jobs and creates batch jobs for them.
 * Supports multi-account configurations - a single schedule can generate multiple reports.
 */

import { 
  getDueScheduledJobs, 
  updateScheduledJob,
  createBatchJob,
  getUserToken,
  createScheduleRun,
  updateScheduleRun,
  getRetryableScheduleRuns,
  getScheduledJob,
} from "./db";
import { ScheduledJob, ScheduleRun } from "../drizzle/schema";
import { classifyError, calculateRetryDelay } from "./error-classifier";

// Scheduler state
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// Configuration
const SCHEDULER_INTERVAL_MS = 60000; // Check every minute

// Type for report configuration
interface ReportConfig {
  name?: string;
  adAccountId: string;
  accessToken?: string;
  dateRangeType?: string;
  minSpend?: string;
  minCTR?: string;
  level?: string;
  breakdown?: string;
}

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
 * Get all report configurations from a schedule
 * Supports both legacy single config and new multi-config format
 */
function getReportConfigs(schedule: ScheduledJob): ReportConfig[] {
  const configs: ReportConfig[] = [];
  
  // Check for new multi-account configurations
  if (schedule.reportConfigs && Array.isArray(schedule.reportConfigs) && schedule.reportConfigs.length > 0) {
    for (const rc of schedule.reportConfigs) {
      if (rc.adAccountId) {
        configs.push({
          name: rc.name,
          adAccountId: rc.adAccountId,
          accessToken: rc.accessToken,
          dateRangeType: rc.dateRangeType || schedule.config?.dateRangeType,
          minSpend: rc.minSpend,
          minCTR: rc.minCTR,
          level: rc.level || schedule.config?.level,
          breakdown: rc.breakdown || schedule.config?.breakdown,
        });
      }
    }
  }
  
  // Fall back to legacy single config if no multi-configs
  if (configs.length === 0 && schedule.config?.adAccountId) {
    configs.push({
      adAccountId: schedule.config.adAccountId,
      accessToken: schedule.config.accessToken,
      dateRangeType: schedule.config.dateRangeType,
      minSpend: schedule.config.minSpend,
      minCTR: schedule.config.minCTR,
      level: schedule.config.level,
      breakdown: schedule.config.breakdown,
    });
  }
  
  return configs;
}

/**
 * Process a scheduled job
 * Creates multiple batch jobs if there are multiple report configurations
 * Exported for manual triggering via Run Now feature
 * @param schedule - The scheduled job to process
 * @param triggerType - 'auto' for scheduled runs, 'manual' for Run Now
 */
interface RetryOptions {
  retryCount: number;
  maxRetries: number;
  originalRunId: number;
}

export async function processScheduledJob(
  schedule: ScheduledJob, 
  triggerType: 'auto' | 'manual' = 'auto',
  retryOpts?: RetryOptions
): Promise<void> {
  const retryLabel = retryOpts ? ` [retry ${retryOpts.retryCount}/${retryOpts.maxRetries}]` : '';
  console.log(`[Scheduler] Processing scheduled job ${schedule.id}: ${schedule.name} (trigger: ${triggerType})${retryLabel}`);
  
  const startTime = Date.now();
  
  // Create a schedule run record
  let runId: number | null = null;
  try {
    runId = await createScheduleRun({
      scheduleId: schedule.id,
      userId: schedule.userId,
      triggerType,
      status: 'running',
      startedAt: new Date(),
      retryCount: retryOpts?.retryCount || 0,
      maxRetries: retryOpts?.maxRetries || 3,
    });
    console.log(`[Scheduler] Created schedule run ${runId} for schedule ${schedule.id}${retryLabel}`);
  } catch (err) {
    console.error(`[Scheduler] Failed to create schedule run record:`, err);
  }
  
  try {
    // Get user's saved tokens
    const adsToken = await getUserToken(schedule.userId, 'ads_management');
    
    if (!adsToken || !adsToken.accessToken) {
      console.error(`[Scheduler] No ads token found for user ${schedule.userId}`);
      await updateScheduledJob(schedule.id, {
        lastRunStatus: 'failed',
      });
      if (runId) {
        await updateScheduleRun(runId, {
          status: 'failed',
          errorMessage: 'No ads management token found. Please save your access token in Settings.',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        });
      }
      return;
    }
    
    // Get all report configurations
    const reportConfigs = getReportConfigs(schedule);
    
    if (reportConfigs.length === 0) {
      console.error(`[Scheduler] No report configurations found for schedule ${schedule.id}`);
      await updateScheduledJob(schedule.id, {
        lastRunStatus: 'failed',
      });
      if (runId) {
        await updateScheduleRun(runId, {
          status: 'failed',
          errorMessage: 'No report configurations found. Please add at least one ad account.',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        });
      }
      return;
    }
    
    console.log(`[Scheduler] Creating ${reportConfigs.length} report job(s) for schedule ${schedule.id}`);
    
    let lastJobId: number | null = null;
    let successCount = 0;
    let failCount = 0;
    const jobIds: number[] = [];
    
    // Update run with total jobs count
    if (runId) {
      await updateScheduleRun(runId, {
        totalJobs: reportConfigs.length,
      });
    }
    
    // Create a batch job for each report configuration
    for (let i = 0; i < reportConfigs.length; i++) {
      const config = reportConfigs[i];
      
      try {
        // Build job config from report config and user tokens
        const jobConfig = {
          adAccountId: config.adAccountId,
          accessToken: config.accessToken || adsToken.accessToken,
          dateRangeType: config.dateRangeType || 'last_7_days',
          level: config.level || 'account',
          breakdown: config.breakdown || 'product_id',
          minSpend: config.minSpend || adsToken.minSpend || undefined,
          minCTR: config.minCTR || adsToken.minCTR || undefined,
          // Add metadata for tracking
          configIndex: i,
          configName: config.name || `Config ${i + 1}`,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          scheduleRunId: runId ?? undefined, // Link batch job to the schedule run
        };
        
        // Determine job type based on schedule type
        const jobType = schedule.jobType === 'catalog_update' ? 'catalog_update' : 'report_generation';
        
        // For combined workflow, add catalog settings to the job config
        if (schedule.jobType === 'report_and_catalog') {
          const catalogToken = await getUserToken(schedule.userId, 'catalog_management');
          if (catalogToken) {
            (jobConfig as any).updateToCatalog = true;
            (jobConfig as any).catalogId = schedule.config?.catalogId || catalogToken.catalogId;
            (jobConfig as any).catalogAccessToken = schedule.config?.catalogAccessToken || catalogToken.accessToken;
            (jobConfig as any).customLabel4 = schedule.config?.customLabel4;
            (jobConfig as any).enableCustomLabel4 = schedule.config?.enableCustomLabel4 !== false; // default true for backward compat
            (jobConfig as any).customNumbers = schedule.config?.customNumbers;
            (jobConfig as any).customLabels = schedule.config?.customLabels;
          }
        }
        
        // Create a batch job
        const jobId = await createBatchJob({
          userId: schedule.userId,
          jobType: jobType,
          config: jobConfig,
        });
        
        if (jobId) {
          console.log(`[Scheduler] Created batch job ${jobId} for config ${i + 1}/${reportConfigs.length} (Account: ${config.adAccountId})`);
          lastJobId = jobId;
          successCount++;
          jobIds.push(jobId);
        } else {
          console.error(`[Scheduler] Failed to create batch job for config ${i + 1}`);
          failCount++;
        }
        
        // Small delay between job creations to avoid overwhelming the system
        if (i < reportConfigs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
      } catch (error: any) {
        console.error(`[Scheduler] Error creating job for config ${i + 1}:`, error.message);
        failCount++;
      }
    }
    
    // Update schedule with next run time
    const nextRunAt = calculateNextRunTime(schedule);
    
    await updateScheduledJob(schedule.id, {
      lastRunAt: new Date(),
      nextRunAt,
      runCount: (schedule.runCount || 0) + 1,
      lastRunStatus: failCount === 0 ? 'success' : (successCount > 0 ? 'success' : 'failed'),
      lastRunJobId: lastJobId,
    });
    
    // Update schedule run record - mark as running (jobs are queued, will be updated when they complete)
    if (runId) {
      const runStatus = failCount === reportConfigs.length ? 'failed' : 'running';
      await updateScheduleRun(runId, {
        status: runStatus,
        jobIds,
        completedJobs: 0,
        failedJobs: failCount,
        errorMessage: failCount > 0 ? `${failCount} job(s) failed to create` : null,
      });
    }
    
    console.log(`[Scheduler] Schedule ${schedule.id} completed: ${successCount} jobs created, ${failCount} failed. Next run: ${nextRunAt.toISOString()}`);
    
  } catch (error: any) {
    console.error(`[Scheduler] Error processing schedule ${schedule.id}:`, error);
    
    // Classify the error to determine if it's retryable
    const classified = classifyError(error);
    console.log(`[Scheduler] Error classified as: ${classified.type} (retryable: ${classified.retryable})`);
    
    await updateScheduledJob(schedule.id, {
      lastRunStatus: 'failed',
    });
    
    if (runId) {
      const currentRetryCount = retryOpts?.retryCount || 0;
      const maxRetries = retryOpts?.maxRetries || 3;
      
      if (classified.retryable && currentRetryCount < maxRetries) {
        // Schedule a retry with exponential backoff
        const retryDelay = calculateRetryDelay(currentRetryCount, classified.type);
        const nextRetryAt = new Date(Date.now() + retryDelay);
        
        console.log(`[Scheduler] Scheduling retry for run ${runId} at ${nextRetryAt.toISOString()} (delay: ${Math.round(retryDelay / 1000)}s)`);
        
        await updateScheduleRun(runId, {
          status: 'failed',
          errorMessage: error.message?.substring(0, 2000) || 'Unknown error',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          lastErrorType: classified.type,
          retryCount: currentRetryCount,
          maxRetries,
          nextRetryAt,
        });
      } else {
        // Permanent error or max retries reached
        await updateScheduleRun(runId, {
          status: 'failed',
          errorMessage: error.message?.substring(0, 2000) || 'Unknown error',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          lastErrorType: classified.type,
          retryCount: currentRetryCount,
          maxRetries: classified.retryable ? maxRetries : 0,
          nextRetryAt: null,
        });
      }
    }
  }
}

/**
 * Retry a failed schedule run
 */
async function retryFailedRun(failedRun: ScheduleRun): Promise<void> {
  const newRetryCount = failedRun.retryCount + 1;
  console.log(`[Scheduler] Retrying failed run ${failedRun.id} for schedule ${failedRun.scheduleId} (attempt ${newRetryCount}/${failedRun.maxRetries})`);
  
  try {
    const schedule = await getScheduledJob(failedRun.scheduleId);
    if (!schedule) {
      console.error(`[Scheduler] Schedule ${failedRun.scheduleId} not found for retry`);
      await updateScheduleRun(failedRun.id, {
        nextRetryAt: null,
        errorMessage: (failedRun.errorMessage || '') + ' | Retry aborted: schedule not found',
      });
      return;
    }
    
    // Clear the retry marker on the failed run
    await updateScheduleRun(failedRun.id, {
      nextRetryAt: null,
      errorMessage: (failedRun.errorMessage || '') + ` | Retry #${newRetryCount} initiated`,
    });
    
    // Re-process the schedule with retry context
    await processScheduledJob(schedule, 'auto', {
      retryCount: newRetryCount,
      maxRetries: failedRun.maxRetries,
      originalRunId: failedRun.id,
    });
    
    console.log(`[Scheduler] Retry #${newRetryCount} for schedule ${failedRun.scheduleId} completed`);
    
  } catch (error: any) {
    console.error(`[Scheduler] Retry failed for run ${failedRun.id}:`, error);
    
    const classified = classifyError(error);
    
    if (classified.retryable && newRetryCount < failedRun.maxRetries) {
      const retryDelay = calculateRetryDelay(newRetryCount, classified.type);
      const nextRetryAt = new Date(Date.now() + retryDelay);
      
      await updateScheduleRun(failedRun.id, {
        retryCount: newRetryCount,
        lastErrorType: classified.type,
        nextRetryAt,
        errorMessage: error.message?.substring(0, 2000) || 'Unknown error',
      });
    } else {
      await updateScheduleRun(failedRun.id, {
        retryCount: newRetryCount,
        lastErrorType: classified.type,
        nextRetryAt: null,
        errorMessage: (error.message?.substring(0, 1500) || 'Unknown error') + ' | Max retries reached',
      });
    }
  }
}

/**
 * Check and process due scheduled jobs, and retry failed runs
 */
async function checkScheduledJobs(): Promise<void> {
  try {
    // 1. Process due scheduled jobs
    const dueJobs = await getDueScheduledJobs();
    
    if (dueJobs.length > 0) {
      console.log(`[Scheduler] Found ${dueJobs.length} due scheduled jobs`);
      for (const schedule of dueJobs) {
        await processScheduledJob(schedule, 'auto');
      }
    }
    
    // 2. Check for failed runs that need retrying
    const retryableRuns = await getRetryableScheduleRuns();
    
    if (retryableRuns.length > 0) {
      console.log(`[Scheduler] Found ${retryableRuns.length} runs eligible for retry`);
      for (const run of retryableRuns) {
        await retryFailedRun(run);
      }
    }
    
  } catch (error) {
    const errMsg = (error as Error).message || '';
    const causeMsg = String((error as any)?.cause?.message || '');
    const isTransient = /no available peers|ECONNRESET|ETIMEDOUT/i.test(errMsg + causeMsg);
    if (!isTransient) {
      console.error('[Scheduler] Error checking scheduled jobs:', error);
    }
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
