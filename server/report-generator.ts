/**
 * Report Generator
 *
 * This module handles background generation of Product Level Reports.
 * All data fetching and processing is done in Node.js via report-worker.ts.
 *
 * Architecture:
 *   Node.js: Task scheduling, status management, API routing, notifications,
 *            Facebook API data fetching, data processing, S3 upload, catalog updates
 *   Communication: Worker updates progress directly in the database (batch_jobs table)
 */

import {
  updateBatchJob,
  createSavedReport,
  updateSavedReport,
} from "./db";
import { notifyOwner } from "./_core/notification";
import { BatchJob } from "../drizzle/schema";
import { runReportWorker, WorkerConfig, WorkerResult } from "./report-worker";

interface ReportConfig {
  adAccountId?: string;
  accessToken?: string;
  dateStart?: string;
  dateEnd?: string;
  level?: string;
  breakdown?: string;
  minSpend?: string;
  minCTR?: string;
  dateRangeType?: string;
  // For combined workflow (report + catalog update)
  updateToCatalog?: boolean;
  catalogId?: string;
  catalogAccessToken?: string;
  customLabel4?: string;
  enableCustomLabel4?: boolean;
  // Custom number fields (0-4)
  customNumbers?: Record<string, string>;
  // Custom label fields (0-4)
  customLabels?: Record<string, string>;
  // Schedule tracking
  scheduleId?: number;
  scheduleName?: string;
  scheduleRunId?: number;
  configIndex?: number;
  configName?: string;
}

/**
 * Calculate date range based on type
 */
function calculateDateRange(dateRangeType: string): { dateStart: string; dateEnd: string } {
  const now = new Date();
  let dateStart: Date;
  let dateEnd: Date = new Date(now);
  dateEnd.setDate(dateEnd.getDate() - 1); // Yesterday

  switch (dateRangeType) {
    case 'last_7_days':
      dateStart = new Date(now);
      dateStart.setDate(dateStart.getDate() - 7);
      break;
    case 'last_14_days':
      dateStart = new Date(now);
      dateStart.setDate(dateStart.getDate() - 14);
      break;
    case 'last_30_days':
      dateStart = new Date(now);
      dateStart.setDate(dateStart.getDate() - 30);
      break;
    case 'last_week': {
      // Last complete week (Monday to Sunday)
      const dayOfWeek = now.getDay();
      const daysToLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
      dateEnd = new Date(now);
      dateEnd.setDate(dateEnd.getDate() - daysToLastSunday);
      dateStart = new Date(dateEnd);
      dateStart.setDate(dateStart.getDate() - 6);
      break;
    }
    case 'last_month':
      // Last complete month
      dateEnd = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of previous month
      dateStart = new Date(now.getFullYear(), now.getMonth() - 1, 1); // First day of previous month
      break;
    default:
      // Default to last 7 days
      dateStart = new Date(now);
      dateStart.setDate(dateStart.getDate() - 7);
  }

  return {
    dateStart: dateStart.toISOString().split('T')[0],
    dateEnd: dateEnd.toISOString().split('T')[0],
  };
}

/**
 * Process a report generation job using the Node.js worker.
 *
 * Steps:
 *   1. Validate config and create saved report record
 *   2. Build worker config
 *   3. Run the Node.js report worker (async, same process)
 *   4. Handle result and send notifications
 */
export async function processReportGenerationJob(job: BatchJob, startTime: number): Promise<void> {
  const config = job.config as ReportConfig;

  // Validate required fields
  if (!config.adAccountId || !config.accessToken) {
    throw new Error('Missing required config fields: adAccountId or accessToken');
  }

  const adAccountId = config.adAccountId;
  const accessToken = config.accessToken;

  // Calculate date range
  let dateStart = config.dateStart;
  let dateEnd = config.dateEnd;

  if (config.dateRangeType && !dateStart) {
    const range = calculateDateRange(config.dateRangeType);
    dateStart = range.dateStart;
    dateEnd = range.dateEnd;
  }

  if (!dateStart || !dateEnd) {
    throw new Error('Missing date range configuration');
  }

  const level = config.level || 'account';
  const breakdown = config.breakdown || 'product_id';

  // Build filters
  const filters: Array<{ field: string; operator: string; value: any }> = [];
  if (config.minSpend) {
    filters.push({ field: 'spend', operator: 'GREATER_THAN', value: parseFloat(config.minSpend) });
  }
  if (config.minCTR) {
    filters.push({ field: 'inline_link_click_ctr', operator: 'GREATER_THAN', value: parseFloat(config.minCTR) });
  }

  // Create saved report record
  const reportId = await createSavedReport({
    userId: job.userId,
    name: `Report ${dateStart} to ${dateEnd}`,
    adAccountId,
    dateStart,
    dateEnd,
    level,
    breakdown,
    minSpend: config.minSpend,
    minCTR: config.minCTR,
    status: 'generating',
    source: 'manual',
  });

  if (!reportId) {
    throw new Error('Failed to create saved report record');
  }

  // Update job with report ID
  await updateBatchJob(job.id, {
    reportId,
    statusMessage: 'Starting report worker…',
  });

  // Build worker config
  const workerConfig: WorkerConfig = {
    jobId: job.id,
    reportId,
    userId: String(job.userId),
    adAccountId,
    accessToken,
    dateStart,
    dateEnd,
    level,
    breakdown,
    filters: filters.length > 0 ? filters : null,
    updateToCatalog: config.updateToCatalog || false,
    catalogId: config.catalogId,
    catalogAccessToken: config.catalogAccessToken,
    customLabel4: config.customLabel4,
    enableCustomLabel4: config.enableCustomLabel4,
    customNumbers: config.customNumbers,
    customLabels: config.customLabels,
    scheduleRunId: config.scheduleRunId,
  };

  console.log(`[ReportGenerator] Starting Node.js worker for job ${job.id}…`);

  // Run the Node.js worker directly (no Python spawn)
  const result: WorkerResult = await runReportWorker(workerConfig);

  if (result.success) {
    console.log(`[ReportGenerator] Worker completed successfully for job ${job.id}`);

    // Send notification to owner
    try {
      const durationMinutes = Math.round((result.durationMs || 0) / 60000);
      const notificationTitle = config.updateToCatalog
        ? `✅ Report + Catalog Update Completed`
        : `✅ Report Generation Completed`;
      const notificationContent = [
        `**Job ID:** ${job.id}`,
        `**Account:** ${config.adAccountId}`,
        `**Products:** ${(result.totalItems || 0).toLocaleString()}`,
        `**Duration:** ${durationMinutes} minutes`,
        config.updateToCatalog ? `**Catalog Updated:** Yes` : '',
        `\n[View Reports](/reports)`,
      ].filter(Boolean).join('\n');

      await notifyOwner({
        title: notificationTitle,
        content: notificationContent,
      });
      console.log(`[ReportGenerator] Notification sent for job ${job.id}`);
    } catch (notifyError) {
      console.warn(`[ReportGenerator] Failed to send notification:`, notifyError);
    }
  } else {
    // Worker reported failure
    const errorMsg = result.error || 'Unknown worker error';
    console.error(`[ReportGenerator] Worker failed for job ${job.id}: ${errorMsg}`);

    // Update report as failed
    await updateSavedReport(reportId, {
      status: 'failed',
      errorMessage: errorMsg.substring(0, 500),
    });

    throw new Error(errorMsg.substring(0, 500));
  }
}
