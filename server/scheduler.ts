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
  getUserToken
} from "./db";
import { ScheduledJob } from "../drizzle/schema";

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
    
    // Get all report configurations
    const reportConfigs = getReportConfigs(schedule);
    
    if (reportConfigs.length === 0) {
      console.error(`[Scheduler] No report configurations found for schedule ${schedule.id}`);
      await updateScheduledJob(schedule.id, {
        lastRunStatus: 'failed',
      });
      return;
    }
    
    console.log(`[Scheduler] Creating ${reportConfigs.length} report job(s) for schedule ${schedule.id}`);
    
    let lastJobId: number | null = null;
    let successCount = 0;
    let failCount = 0;
    
    // Create a batch job for each report configuration
    for (let i = 0; i < reportConfigs.length; i++) {
      const config = reportConfigs[i];
      
      try {
        // Build job config from report config and user tokens
        const jobConfig = {
          adAccountId: config.adAccountId,
          accessToken: config.accessToken || adsToken.accessToken,
          dateRangeType: config.dateRangeType || 'last_7_days',
          level: config.level || 'ad',
          breakdown: config.breakdown || 'product_id',
          minSpend: config.minSpend || adsToken.minSpend || undefined,
          minCTR: config.minCTR || adsToken.minCTR || undefined,
          // Add metadata for tracking
          configIndex: i,
          configName: config.name || `Config ${i + 1}`,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
        };
        
        // Determine job type based on schedule type
        // For combined workflow, we still create report_generation jobs
        // but add updateToCatalog flag so job processor knows to continue with catalog update
        const jobType = schedule.jobType === 'catalog_update' ? 'catalog_update' : 'report_generation';
        
        // For combined workflow, add catalog settings to the job config
        if (schedule.jobType === 'report_and_catalog') {
          // Get catalog token for the combined workflow
          const catalogToken = await getUserToken(schedule.userId, 'catalog_management');
          if (catalogToken) {
            (jobConfig as any).updateToCatalog = true;
            (jobConfig as any).catalogId = schedule.config?.catalogId || catalogToken.catalogId;
            (jobConfig as any).catalogAccessToken = schedule.config?.catalogAccessToken || catalogToken.accessToken;
            (jobConfig as any).customLabel4 = schedule.config?.customLabel4;
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
    
    console.log(`[Scheduler] Schedule ${schedule.id} completed: ${successCount} jobs created, ${failCount} failed. Next run: ${nextRunAt.toISOString()}`);
    
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
