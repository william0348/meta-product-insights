/**
 * Background Job Processor
 * 
 * This module handles background processing of catalog batch jobs.
 * Jobs are stored in the database and processed independently of the HTTP request lifecycle.
 * This allows jobs to continue even if the browser is closed.
 */

import { 
  getBatchJob, 
  updateBatchJob, 
  getQueuedJobs, 
  getRunningJobs,
  createBatchHistoryRecord,
  updateBatchHistoryRecord,
  getScheduleRun,
  updateScheduleRun,
} from "./db";
import { notifyOwner } from "./_core/notification";
import { batchUpdateProducts, fetchProductsByRetailerIds, checkBatchRequestStatus } from "./catalog";
import { processReportGenerationJob } from "./report-generator";
import { workerHeartbeats } from "./report-worker";
import { BatchJob } from "../drizzle/schema";
import { calculateRetryDelay } from "./error-classifier";

// Job processor state
let isProcessing = false;
let processorInterval: ReturnType<typeof setInterval> | null = null;

// Configuration
const PROCESSOR_INTERVAL_MS = 5000; // Check for new jobs every 5 seconds
const MAX_CONCURRENT_JOBS = 1; // Process one job at a time to avoid rate limits
const BATCH_SIZE = 3000; // Items per Facebook API request
const CONCURRENT_BATCHES = 5; // Parallel batch requests
const JOB_TIMEOUT_MS = 240 * 60 * 1000; // 240 minutes max for any job (doubled from 120 to handle large CVR datasets with 150K+ products)
const STALE_PROGRESS_TIMEOUT_MS = 90 * 60 * 1000; // 90 minutes without progress update = stale (doubled from 45, allows for mega retries: 3 × 6min = 18min extra)

// Track last known progress for stale detection
// We track `progress`, `processedItems`, AND `statusMessage` to detect activity
// The statusMessage check is critical: during retries/rate-limit waits, the worker
// sends heartbeat messages that update statusMessage without changing progress%
const jobProgressCache = new Map<number, { progress: number; processedItems: number; statusMessage: string; updatedAt: number }>();
let lastTransientLogTime: number | null = null;

/**
 * Start the background job processor
 */
export function startJobProcessor(): void {
  if (processorInterval) {
    console.log("[JobProcessor] Already running");
    return;
  }

  console.log("[JobProcessor] Starting background job processor...");
  
  // On startup, recover orphaned "running" jobs that were interrupted by a server restart.
  // These jobs have no active worker — re-queue them so they get picked up immediately.
  recoverOrphanedJobs().catch(err => {
    console.error("[JobProcessor] Failed to recover orphaned jobs:", err);
  });
  
  // Process jobs immediately on startup
  processJobs().catch(console.error);
  
  // Then check for new jobs periodically
  processorInterval = setInterval(() => {
    processJobs().catch(console.error);
  }, PROCESSOR_INTERVAL_MS);
}

/**
 * Recover orphaned "running" jobs on startup.
 * After a server restart, any job marked as "running" in the DB has no active worker.
 * We re-queue them so they get processed again, and update the associated schedule_run.
 */
async function recoverOrphanedJobs(): Promise<void> {
  try {
    const runningJobs = await getRunningJobs();
    if (runningJobs.length === 0) return;
    
    console.log(`[JobProcessor] Found ${runningJobs.length} orphaned running job(s) after restart — re-queuing`);
    
    for (const job of runningJobs) {
      const runningTime = Date.now() - (job.startedAt?.getTime() || 0);
      console.log(
        `[JobProcessor] Re-queuing orphaned job ${job.id} (type: ${job.jobType}, ` +
        `was running for ${Math.round(runningTime / 60000)}min before restart)`
      );
      
      await updateBatchJob(job.id, {
        status: "queued",
        statusMessage: `Re-queued after server restart (was running for ${Math.round(runningTime / 60000)}min)`,
        progress: 0,
        processedItems: 0,
        startedAt: null,
      });
      
      // Also reset the associated schedule_run status if it was 'running'
      const scheduleRunId = job.config?.scheduleRunId;
      if (scheduleRunId) {
        try {
          const run = await getScheduleRun(scheduleRunId);
          if (run && run.status === 'running') {
            await updateScheduleRun(scheduleRunId, {
              errorMessage: `Job ${job.id} re-queued after server restart`,
            });
          }
        } catch (runErr) {
          console.warn(`[JobProcessor] Failed to update schedule run ${scheduleRunId} during recovery:`, runErr);
        }
      }
      
      // Clean up any stale cache entries
      jobProgressCache.delete(job.id);
      workerHeartbeats.delete(job.id);
    }
    
    console.log(`[JobProcessor] Successfully re-queued ${runningJobs.length} orphaned job(s)`);
  } catch (error) {
    console.error("[JobProcessor] Error recovering orphaned jobs:", error);
  }
}

/**
 * Stop the background job processor
 */
export function stopJobProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    console.log("[JobProcessor] Stopped");
  }
}

/**
 * Main job processing loop
 */
async function processJobs(): Promise<void> {
  if (isProcessing) {
    return; // Already processing
  }

  try {
    isProcessing = true;

    // Check for running jobs that might have been interrupted or stalled
    let runningJobs: BatchJob[] = [];
    try {
      runningJobs = await getRunningJobs();
    } catch (dbErr) {
      const errMsg = (dbErr as Error).message || '';
      const isTransient = errMsg.includes('no available peers') || errMsg.includes('ECONNRESET') || errMsg.includes('ETIMEDOUT');
      if (isTransient) {
        if (!lastTransientLogTime || Date.now() - lastTransientLogTime > 60000) {
          console.warn(`[JobProcessor] DB temporarily unavailable, will retry: ${errMsg.substring(0, 100)}`);
          lastTransientLogTime = Date.now();
        }
      } else {
        console.warn(`[JobProcessor] Failed to query running jobs:`, errMsg);
      }
      return; // Skip this cycle, retry on next interval
    }
    
    for (const job of runningJobs) {
      const runningTime = Date.now() - (job.startedAt?.getTime() || 0);
      
      // Track progress for stale detection
      // Check BOTH progress field AND processedItems to detect activity
      const cached = jobProgressCache.get(job.id);
      const currentProgress = job.progress || 0;
      const currentProcessedItems = job.processedItems || 0;
      const currentStatusMessage = job.statusMessage || '';
      
      if (!cached) {
        jobProgressCache.set(job.id, { progress: currentProgress, processedItems: currentProcessedItems, statusMessage: currentStatusMessage, updatedAt: Date.now() });
      } else if (
        currentProgress > cached.progress ||
        currentProcessedItems > cached.processedItems ||
        currentStatusMessage !== cached.statusMessage  // Heartbeat messages count as activity
      ) {
        // Activity detected (progress %, processedItems, or statusMessage changed), update cache
        jobProgressCache.set(job.id, { progress: currentProgress, processedItems: currentProcessedItems, statusMessage: currentStatusMessage, updatedAt: Date.now() });
      }
      
      // Check for absolute timeout (60 minutes)
      const isAbsoluteTimeout = runningTime > JOB_TIMEOUT_MS;
      
      // Check for stale progress (no DB-level progress change for STALE_PROGRESS_TIMEOUT_MS)
      const cachedEntry = jobProgressCache.get(job.id);
      const timeSinceLastProgress = cachedEntry ? Date.now() - cachedEntry.updatedAt : 0;
      let isStaleProgress = cachedEntry && timeSinceLastProgress > STALE_PROGRESS_TIMEOUT_MS;

      // CRITICAL: Also check in-memory heartbeat from the worker process.
      // Even if DB writes fail, the worker updates workerHeartbeats on every retry/wait.
      // If the in-memory heartbeat is recent (< 5 min), the worker is still alive — don't kill it.
      if (isStaleProgress) {
        const lastHeartbeat = workerHeartbeats.get(job.id);
        if (lastHeartbeat) {
          const timeSinceHeartbeat = Date.now() - lastHeartbeat;
          if (timeSinceHeartbeat < 5 * 60 * 1000) {
            // Worker is still alive (heartbeat within 5 min), don't kill
            console.log(
              `[JobProcessor] Job ${job.id} DB-stale for ${Math.round(timeSinceLastProgress / 60000)}min ` +
              `but in-memory heartbeat ${Math.round(timeSinceHeartbeat / 1000)}s ago — keeping alive`,
            );
            isStaleProgress = false;
          } else {
            console.log(
              `[JobProcessor] Job ${job.id} both DB-stale (${Math.round(timeSinceLastProgress / 60000)}min) ` +
              `and in-memory heartbeat stale (${Math.round(timeSinceHeartbeat / 60000)}min) — will timeout`,
            );
          }
        }
      }
      
      if (isAbsoluteTimeout || isStaleProgress) {
        const reason = isAbsoluteTimeout 
          ? `absolute timeout after ${Math.round(runningTime / 60000)} minutes`
          : `no progress for ${Math.round(timeSinceLastProgress / 60000)} minutes (stuck at ${currentProgress}%)`;
        
        console.log(`[JobProcessor] Job ${job.id} timed out: ${reason}`);
        
        await updateBatchJob(job.id, {
          status: "failed",
          statusMessage: `Job timed out: ${reason}`,
          completedAt: new Date(),
        });
        
        // Also update the associated schedule_run if exists
        const scheduleRunId = job.config?.scheduleRunId;
        if (scheduleRunId) {
          try {
            const run = await getScheduleRun(scheduleRunId);
            if (run && run.status === 'running') {
              const newFailedJobs = (run.failedJobs || 0) + 1;
              const totalJobsDone = (run.completedJobs || 0) + newFailedJobs;
              const allDone = totalJobsDone >= (run.totalJobs || 1);
              
              // Calculate retry delay for timeout errors (retryable)
              const currentRetryCount = run.retryCount || 0;
              const maxRetries = run.maxRetries || 3;
              const shouldRetry = currentRetryCount < maxRetries;
              const retryDelay = shouldRetry ? calculateRetryDelay(currentRetryCount, 'transient') : 0;
              const nextRetryAt = shouldRetry ? new Date(Date.now() + retryDelay) : null;
              
              await updateScheduleRun(scheduleRunId, {
                failedJobs: newFailedJobs,
                status: allDone ? ((run.completedJobs || 0) > 0 ? 'partial' : 'failed') : 'running',
                errorMessage: `Job timed out: ${reason}`,
                lastErrorType: 'timeout',
                ...(allDone && shouldRetry ? {
                  completedAt: new Date(),
                  durationMs: Date.now() - run.startedAt.getTime(),
                  nextRetryAt,
                } : allDone ? {
                  completedAt: new Date(),
                  durationMs: Date.now() - run.startedAt.getTime(),
                } : {}),
              });
              if (shouldRetry && nextRetryAt) {
                console.log(`[JobProcessor] Updated schedule run ${scheduleRunId} after job timeout — retry scheduled at ${nextRetryAt.toISOString()}`);
              } else {
                console.log(`[JobProcessor] Updated schedule run ${scheduleRunId} after job timeout (no more retries)`);  
              }
            }
          } catch (runErr) {
            console.warn(`[JobProcessor] Failed to update schedule run after timeout:`, runErr);
          }
        }
        
        // Clean up progress cache and in-memory heartbeat
        jobProgressCache.delete(job.id);
        workerHeartbeats.delete(job.id);
      }
    }

    // Get queued jobs
    let queuedJobs: BatchJob[] = [];
    try {
      queuedJobs = await getQueuedJobs(MAX_CONCURRENT_JOBS);
    } catch (dbErr) {
      const errMsg = (dbErr as Error).message || '';
      // Only log once per minute for transient DB errors to reduce noise
      const isTransient = errMsg.includes('no available peers') || errMsg.includes('ECONNRESET') || errMsg.includes('ETIMEDOUT');
      if (isTransient) {
        if (!lastTransientLogTime || Date.now() - lastTransientLogTime > 60000) {
          console.warn(`[JobProcessor] DB temporarily unavailable, will retry: ${errMsg.substring(0, 100)}`);
          lastTransientLogTime = Date.now();
        }
      } else {
        console.warn(`[JobProcessor] Failed to query queued jobs:`, errMsg);
      }
      return;
    }
    
    for (const job of queuedJobs) {
      console.log(`[JobProcessor] Processing job ${job.id} (${job.jobType})`);
      await processJob(job);
    }
  } catch (error) {
    const errMsg = (error as Error).message || '';
    const isTransient = errMsg.includes('no available peers') || errMsg.includes('ECONNRESET') || errMsg.includes('ETIMEDOUT');
    if (!isTransient) {
      console.error("[JobProcessor] Error in processing loop:", error);
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Process a single job
 */
async function processJob(job: BatchJob): Promise<void> {
  const startTime = Date.now();
  
  try {
    // Mark job as running
    await updateBatchJob(job.id, {
      status: "running",
      startedAt: new Date(),
      statusMessage: "Starting job...",
    });

    if (job.jobType === "catalog_update") {
      await processCatalogUpdateJob(job, startTime);
    } else if (job.jobType === "report_generation") {
      await processReportGenerationJob(job, startTime);
    } else {
      throw new Error(`Unknown job type: ${job.jobType}`);
    }
  } catch (error: any) {
    console.error(`[JobProcessor] Job ${job.id} failed:`, error);
    
    // Clean up progress cache
    jobProgressCache.delete(job.id);
    
    // Truncate error message to prevent Data Too Long errors in database
    const errorMsg = (error.message || "Unknown error").substring(0, 500);
    
    await updateBatchJob(job.id, {
      status: "failed",
      statusMessage: errorMsg,
      completedAt: new Date(),
      errors: [{ message: errorMsg }],
    });
    
    // Update schedule run with error classification for retry logic
    const scheduleRunId = job.config?.scheduleRunId;
    if (scheduleRunId) {
      try {
        const { classifyError, calculateRetryDelay } = await import("./error-classifier");
        const classified = classifyError(error);
        const run = await getScheduleRun(scheduleRunId);
        
        if (run) {
          const newFailedJobs = (run.failedJobs || 0) + 1;
          const totalJobsDone = (run.completedJobs || 0) + newFailedJobs;
          const allDone = totalJobsDone >= (run.totalJobs || 1);
          
          if (allDone && newFailedJobs > 0) {
            const currentRetryCount = run.retryCount || 0;
            const maxRetries = run.maxRetries || 3;
            
            if (classified.retryable && currentRetryCount < maxRetries) {
              const retryDelay = calculateRetryDelay(currentRetryCount, classified.type);
              const nextRetryAt = new Date(Date.now() + retryDelay);
              
              console.log(`[JobProcessor] Scheduling retry for run ${scheduleRunId} at ${nextRetryAt.toISOString()}`);
              
              await updateScheduleRun(scheduleRunId, {
                failedJobs: newFailedJobs,
                status: 'failed',
                completedAt: new Date(),
                durationMs: Date.now() - run.startedAt.getTime(),
                lastErrorType: classified.type,
                nextRetryAt,
                errorMessage: errorMsg,
              });
            } else {
              await updateScheduleRun(scheduleRunId, {
                failedJobs: newFailedJobs,
                status: (run.completedJobs || 0) > 0 ? 'partial' : 'failed',
                completedAt: new Date(),
                durationMs: Date.now() - run.startedAt.getTime(),
                lastErrorType: classified.type,
                nextRetryAt: null,
                errorMessage: errorMsg,
              });
            }
          } else {
            await updateScheduleRun(scheduleRunId, {
              failedJobs: newFailedJobs,
              lastErrorType: classified.type,
              errorMessage: errorMsg,
            });
          }
        }
      } catch (retryErr) {
        console.warn(`[JobProcessor] Failed to update schedule run retry info:`, retryErr);
      }
    }
  }
}

/**
 * Process a catalog update job
 */
async function processCatalogUpdateJob(job: BatchJob, startTime: number): Promise<void> {
  const config = job.config;
  
  // Validate required config fields
  if (!config.catalogId || !config.accessToken || !config.retailerIds) {
    throw new Error("Missing required config fields: catalogId, accessToken, or retailerIds");
  }
  
  const catalogId = config.catalogId;
  const accessToken = config.accessToken;
  const retailerIds = config.retailerIds;
  const totalItems = retailerIds.length;
  
  // Calculate batches
  const batches: string[][] = [];
  for (let i = 0; i < retailerIds.length; i += BATCH_SIZE) {
    batches.push(retailerIds.slice(i, i + BATCH_SIZE));
  }
  
  const totalBatches = batches.length;
  
  await updateBatchJob(job.id, {
    totalItems,
    totalBatches,
    statusMessage: `Preparing ${totalItems} items in ${totalBatches} batches...`,
  });

  // Create batch history record
  const historyId = await createBatchHistoryRecord({
    userId: job.userId,
    catalogId: config.catalogId,
    operationType: "UPDATE",
    totalItems,
    batchCount: totalBatches,
    updatedFields: getUpdatedFields(config),
    updateCriteria: config.updateCriteria,
    status: "processing",
    handles: [],
  });

  if (historyId) {
    await updateBatchJob(job.id, { historyId });
  }

  let processedItems = 0;
  let successCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  const allHandles: string[] = [];
  const allErrors: Array<{ retailerId?: string; message: string; batchIndex?: number }> = [];

  // Process batches with concurrency control
  for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
    // Check if job was cancelled
    const currentJob = await getBatchJob(job.id);
    if (currentJob?.status === "cancelled") {
      console.log(`[JobProcessor] Job ${job.id} was cancelled`);
      return;
    }

    const batchGroup = batches.slice(i, i + CONCURRENT_BATCHES);
    const batchPromises = batchGroup.map(async (batchIds, groupIndex) => {
      const batchIndex = i + groupIndex;
      
      try {
        // Fetch current products to merge values
        const products = await fetchProductsByRetailerIds(
          catalogId,
          batchIds,
          accessToken
        );
        
        const productMap = new Map(products.map((p: any) => [p.retailer_id, p]));
        
        // Build update requests
        const requests = batchIds.map(id => {
          const product = productMap.get(id);
          const dataPayload: { id: string; [key: string]: any } = { id };
          
          // Custom Label 4 (Merge)
          if (config.customLabel4) {
            let finalVal = config.customLabel4;
            if (product && product.custom_label_4) {
              const existing = product.custom_label_4.split(',').map((s: string) => s.trim()).filter(Boolean);
              if (!existing.includes(config.customLabel4)) {
                existing.push(config.customLabel4);
                finalVal = existing.join(', ');
              } else {
                finalVal = product.custom_label_4;
              }
            }
            dataPayload.custom_label_4 = finalVal;
          }
          
          // Custom Number (Overwrite)
          if (config.customNumberValue && config.customNumberField) {
            const numValue = parseInt(config.customNumberValue);
            dataPayload[config.customNumberField] = numValue;
          }
          
          return {
            method: 'UPDATE' as const,
            retailer_id: id,
            data: dataPayload,
          };
        });
        
        // Send batch update
        const response = await batchUpdateProducts(
          catalogId,
          requests,
          accessToken
        );
        
        // Collect handles
        if (response.handles && response.handles.length > 0) {
          allHandles.push(...response.handles);
        }
        
        // Check for validation errors
        if (response.validation_status) {
          for (const status of response.validation_status) {
            if (status.errors && status.errors.length > 0) {
              for (const err of status.errors) {
                allErrors.push({
                  retailerId: status.retailer_id,
                  message: err.message,
                  batchIndex,
                });
                errorCount++;
              }
            }
            if (status.warnings && status.warnings.length > 0) {
              warningCount += status.warnings.length;
            }
          }
        }
        
        return { success: true, count: batchIds.length };
      } catch (error: any) {
        console.error(`[JobProcessor] Batch ${batchIndex} failed:`, error.message);
        allErrors.push({
          message: error.message || "Batch failed",
          batchIndex,
        });
        errorCount += batchIds.length;
        return { success: false, count: 0 };
      }
    });
    
    const results = await Promise.all(batchPromises);
    
    for (const result of results) {
      if (result.success) {
        successCount += result.count;
      }
      processedItems += result.count;
    }
    
    // Update progress
    const progress = Math.round((processedItems / totalItems) * 100);
    const currentBatch = Math.min(i + CONCURRENT_BATCHES, totalBatches);
    
    await updateBatchJob(job.id, {
      progress,
      currentBatch,
      processedItems,
      successCount,
      errorCount,
      warningCount,
      handles: allHandles,
      errors: allErrors.slice(-100), // Keep last 100 errors
      statusMessage: `Processing batch ${currentBatch}/${totalBatches} (${progress}%)`,
    });
    
    // Small delay between batch groups
    if (i + CONCURRENT_BATCHES < batches.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Poll Facebook for final status of all handles
  if (allHandles.length > 0) {
    await updateBatchJob(job.id, {
      statusMessage: `Verifying ${allHandles.length} batch handles with Facebook...`,
    });
    
    for (const handle of allHandles) {
      try {
        const statusResponse = await checkBatchRequestStatus(config.catalogId, handle, config.accessToken);
        // Check each item in the response data array
        for (const item of statusResponse.data || []) {
          if (item.errors && item.errors.length > 0) {
            for (const err of item.errors) {
              allErrors.push({ message: err.message || "Unknown error" });
              errorCount++;
            }
          }
        }
      } catch (error: any) {
        console.warn(`[JobProcessor] Failed to check handle status:`, error.message);
      }
    }
  }

  const durationMs = Date.now() - startTime;
  
  // Mark job as completed
  await updateBatchJob(job.id, {
    status: errorCount > 0 && successCount === 0 ? "failed" : "completed",
    progress: 100,
    processedItems: totalItems,
    successCount,
    errorCount,
    warningCount,
    handles: allHandles,
    errors: allErrors.slice(-100),
    completedAt: new Date(),
    statusMessage: `Completed: ${successCount} success, ${errorCount} errors, ${warningCount} warnings`,
  });

  // Update batch history record
  if (historyId) {
    await updateBatchHistoryRecord(historyId, {
      status: errorCount > 0 && successCount === 0 ? "failed" : "completed",
      successCount,
      errorCount,
      warningCount,
      handles: allHandles,
      errors: allErrors.slice(-100).map(e => ({ retailerId: e.retailerId || "", message: e.message })),
      completedAt: new Date(),
      durationMs,
    });
  }

  console.log(`[JobProcessor] Job ${job.id} completed in ${durationMs}ms: ${successCount} success, ${errorCount} errors`);
  
  // Update schedule run if this job was triggered by a schedule
  await updateScheduleRunFromJob(job, {
    totalItems,
    successCount: successCount,
    errorCount,
    catalogItemsUpdated: successCount,
    catalogErrors: errorCount,
    durationMs,
  });
  
  // Send notification to owner
  try {
    const durationMinutes = Math.round(durationMs / 60000);
    const status = errorCount > 0 && successCount === 0 ? '❌ Failed' : '✅ Completed';
    const notificationTitle = `${status}: Catalog Batch Update`;
    const notificationContent = [
      `**Job ID:** ${job.id}`,
      `**Catalog ID:** ${config.catalogId}`,
      `**Total Items:** ${totalItems.toLocaleString()}`,
      `**Success:** ${successCount.toLocaleString()}`,
      `**Errors:** ${errorCount.toLocaleString()}`,
      `**Duration:** ${durationMinutes} minutes`,
      `\n[View Reports](/reports)`
    ].join('\n');
    
    await notifyOwner({
      title: notificationTitle,
      content: notificationContent,
    });
    console.log(`[JobProcessor] Notification sent for job ${job.id}`);
  } catch (notifyError) {
    console.warn(`[JobProcessor] Failed to send notification:`, notifyError);
    // Don't fail the job if notification fails
  }
}

/**
 * Update schedule run record when a batch job completes
 * Aggregates results from all linked jobs
 */
async function updateScheduleRunFromJob(
  job: BatchJob,
  results: {
    totalItems: number;
    successCount: number;
    errorCount: number;
    catalogItemsUpdated?: number;
    catalogErrors?: number;
    durationMs: number;
  }
): Promise<void> {
  const scheduleRunId = job.config?.scheduleRunId;
  if (!scheduleRunId) return;
  
  try {
    const run = await getScheduleRun(scheduleRunId);
    if (!run) return;
    
    const jobStatus = results.errorCount > 0 && results.successCount === 0 ? 'failed' : 'completed';
    const newCompletedJobs = (run.completedJobs || 0) + (jobStatus === 'completed' ? 1 : 0);
    const newFailedJobs = (run.failedJobs || 0) + (jobStatus === 'failed' ? 1 : 0);
    const totalJobsDone = newCompletedJobs + newFailedJobs;
    const allDone = totalJobsDone >= (run.totalJobs || 1);
    
    // Determine overall run status
    let runStatus: 'running' | 'completed' | 'partial' | 'failed' = 'running';
    if (allDone) {
      if (newFailedJobs === 0) runStatus = 'completed';
      else if (newCompletedJobs === 0) runStatus = 'failed';
      else runStatus = 'partial';
    }
    
    await updateScheduleRun(scheduleRunId, {
      completedJobs: newCompletedJobs,
      failedJobs: newFailedJobs,
      totalItems: (run.totalItems || 0) + results.totalItems,
      catalogItemsUpdated: (run.catalogItemsUpdated || 0) + (results.catalogItemsUpdated || 0),
      catalogErrors: (run.catalogErrors || 0) + (results.catalogErrors || 0),
      status: runStatus,
      ...(allDone ? {
        completedAt: new Date(),
        durationMs: Date.now() - run.startedAt.getTime(),
      } : {}),
    });
    
    console.log(`[JobProcessor] Updated schedule run ${scheduleRunId}: ${runStatus} (${totalJobsDone}/${run.totalJobs} jobs done)`);
  } catch (error) {
    console.warn(`[JobProcessor] Failed to update schedule run ${scheduleRunId}:`, error);
  }
}

/**
 * Get list of fields being updated based on config
 */
function getUpdatedFields(config: BatchJob["config"]): string[] {
  const fields: string[] = [];
  if (config.customLabel4) fields.push("custom_label_4");
  if (config.customNumberField && config.customNumberValue) {
    fields.push(config.customNumberField);
  }
  return fields;
}
