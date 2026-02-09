/**
 * Report Generator
 * 
 * This module handles background generation of Product Level Reports.
 * Data fetching and processing is delegated to a Python worker process
 * (python/report_worker.py) for better performance with large datasets.
 * 
 * Architecture:
 *   Node.js: Task scheduling, status management, API routing, notifications
 *   Python:  Facebook API data fetching, data processing, S3 upload, catalog updates
 *   Communication: Python updates progress directly in the database (batch_jobs table)
 */

import { spawn } from "child_process";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { 
  updateBatchJob, 
  createSavedReport, 
  updateSavedReport,
  getUserToken,
} from "./db";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import { BatchJob } from "../drizzle/schema";

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
  // Custom number fields (0-4)
  customNumbers?: Record<string, string>;
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
    case 'last_week':
      // Last complete week (Monday to Sunday)
      const dayOfWeek = now.getDay();
      const daysToLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
      dateEnd = new Date(now);
      dateEnd.setDate(dateEnd.getDate() - daysToLastSunday);
      dateStart = new Date(dateEnd);
      dateStart.setDate(dateStart.getDate() - 6);
      break;
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
    dateEnd: dateEnd.toISOString().split('T')[0]
  };
}

/**
 * Result from the Python worker process
 */
interface PythonWorkerResult {
  success: boolean;
  jobId: number;
  reportId?: number;
  totalItems?: number;
  totalSpend?: number;
  totalImpressions?: number;
  durationMs?: number;
  s3Url?: string;
  error?: string;
}

/**
 * Spawn the Python worker process and wait for it to complete.
 * The Python process updates the database directly for progress tracking.
 * Returns the parsed result from the worker's stdout.
 */
function runPythonWorker(configPath: string): Promise<PythonWorkerResult> {
  return new Promise((resolve, reject) => {
    // Resolve the Python script path relative to the project root
    const scriptPath = join(process.cwd(), 'python', 'report_worker.py');
    
    // Use absolute path to system Python 3.11 to avoid uv-installed Python 3.13 interference
    // The uv Python 3.13 causes SRE module mismatch with system-installed packages
    const pythonPath = '/usr/bin/python3.11';
    
    // Clean environment: remove PYTHONPATH and PYTHONHOME that may point to wrong Python
    const cleanEnv = { ...process.env };
    delete cleanEnv.PYTHONPATH;
    delete cleanEnv.PYTHONHOME;
    // Ensure /usr/bin is at the front of PATH so system Python is found
    if (cleanEnv.PATH) {
      cleanEnv.PATH = `/usr/bin:/usr/local/bin:${cleanEnv.PATH}`;
    }
    
    const child = spawn(pythonPath, ['-I', scriptPath, '--config', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      // Forward Python logs to Node.js console
      const lines = text.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        if (!line.includes('__RESULT__')) {
          console.log(`[ReportGenerator] ${line}`);
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      // Forward Python errors to Node.js console
      if (text.trim()) {
        console.error(`[ReportGenerator:Python:stderr] ${text.trim()}`);
      }
    });

    child.on('close', (code: number | null) => {
      // Parse the result from stdout
      const resultMatch = stdout.match(/__RESULT__(.+?)__END_RESULT__/);
      
      if (resultMatch) {
        try {
          const result: PythonWorkerResult = JSON.parse(resultMatch[1]);
          resolve(result);
        } catch (parseErr) {
          reject(new Error(`Failed to parse Python worker result: ${parseErr}`));
        }
      } else if (code !== 0) {
        // Python process failed without producing a result
        const errorMsg = stderr.trim().split('\n').pop() || `Python worker exited with code ${code}`;
        reject(new Error(errorMsg.substring(0, 500)));
      } else {
        reject(new Error('Python worker completed but produced no result'));
      }
    });

    child.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn Python worker: ${err.message}`));
    });
  });
}

/**
 * Process a report generation job by delegating to the Python worker.
 * 
 * Node.js responsibilities:
 *   1. Validate config and create saved report record
 *   2. Prepare job config JSON for Python
 *   3. Spawn Python worker process
 *   4. Handle result and send notifications
 * 
 * Python responsibilities:
 *   1. Create Facebook report run (with retry)
 *   2. Poll for report completion
 *   3. Fetch all paginated data
 *   4. Map and process data
 *   5. Upload to S3
 *   6. Catalog batch update (if requested)
 *   7. Update job/report/schedule status in database
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
  const filters: Array<{field: string, operator: string, value: any}> = [];
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
    statusMessage: 'Starting Python worker...',
  });
  
  // Prepare config JSON for the Python worker
  let configFilePath = '';
  try {
    const tmpDir = await mkdtemp(join(tmpdir(), 'report-worker-'));
    configFilePath = join(tmpDir, 'config.json');
    
    const workerConfig = {
      jobId: job.id,
      reportId,
      userId: job.userId,
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
      customNumbers: config.customNumbers,
      scheduleRunId: config.scheduleRunId,
      databaseUrl: ENV.databaseUrl,
      forgeApiUrl: ENV.forgeApiUrl,
      forgeApiKey: ENV.forgeApiKey,
    };
    
    await writeFile(configFilePath, JSON.stringify(workerConfig));
    
    console.log(`[ReportGenerator] Spawning Python worker for job ${job.id}...`);
    
    // Run the Python worker
    const result = await runPythonWorker(configFilePath);
    
    if (result.success) {
      console.log(`[ReportGenerator] Python worker completed successfully for job ${job.id}`);
      
      // Send notification to owner (Node.js handles this since it has the notification helper)
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
          `\n[View Reports](/reports)`
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
      // Python worker reported failure
      const errorMsg = result.error || 'Unknown Python worker error';
      console.error(`[ReportGenerator] Python worker failed for job ${job.id}: ${errorMsg}`);
      
      // Update report as failed
      await updateSavedReport(reportId, {
        status: 'failed',
        errorMessage: errorMsg.substring(0, 500),
      });
      
      throw new Error(errorMsg.substring(0, 500));
    }
    
  } catch (error: any) {
    console.error(`[ReportGenerator] Job ${job.id} failed:`, error);
    
    // Update report as failed if not already done by Python
    try {
      await updateSavedReport(reportId, {
        status: 'failed',
        errorMessage: (error.message || 'Unknown error').substring(0, 500),
      });
    } catch {
      // Ignore update errors
    }
    
    // Re-throw with truncated message
    throw new Error((error.message || 'Unknown error').substring(0, 500));
    
  } finally {
    // Clean up temp config file
    if (configFilePath) {
      try {
        await unlink(configFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
