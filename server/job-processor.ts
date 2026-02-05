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
  updateBatchHistoryRecord
} from "./db";
import { batchUpdateProducts, fetchProductsByRetailerIds, checkBatchRequestStatus } from "./catalog";
import { BatchJob } from "../drizzle/schema";

// Job processor state
let isProcessing = false;
let processorInterval: ReturnType<typeof setInterval> | null = null;

// Configuration
const PROCESSOR_INTERVAL_MS = 5000; // Check for new jobs every 5 seconds
const MAX_CONCURRENT_JOBS = 1; // Process one job at a time to avoid rate limits
const BATCH_SIZE = 3000; // Items per Facebook API request
const CONCURRENT_BATCHES = 5; // Parallel batch requests

/**
 * Start the background job processor
 */
export function startJobProcessor(): void {
  if (processorInterval) {
    console.log("[JobProcessor] Already running");
    return;
  }

  console.log("[JobProcessor] Starting background job processor...");
  
  // Process jobs immediately on startup
  processJobs().catch(console.error);
  
  // Then check for new jobs periodically
  processorInterval = setInterval(() => {
    processJobs().catch(console.error);
  }, PROCESSOR_INTERVAL_MS);
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

    // Check for running jobs that might have been interrupted
    const runningJobs = await getRunningJobs();
    for (const job of runningJobs) {
      // If a job has been running for more than 30 minutes, mark it as failed
      const runningTime = Date.now() - (job.startedAt?.getTime() || 0);
      if (runningTime > 30 * 60 * 1000) {
        console.log(`[JobProcessor] Job ${job.id} timed out after 30 minutes`);
        await updateBatchJob(job.id, {
          status: "failed",
          statusMessage: "Job timed out after 30 minutes",
          completedAt: new Date(),
        });
      }
    }

    // Get queued jobs
    const queuedJobs = await getQueuedJobs(MAX_CONCURRENT_JOBS);
    
    for (const job of queuedJobs) {
      console.log(`[JobProcessor] Processing job ${job.id} (${job.jobType})`);
      await processJob(job);
    }
  } catch (error) {
    console.error("[JobProcessor] Error in processing loop:", error);
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
    } else {
      throw new Error(`Unknown job type: ${job.jobType}`);
    }
  } catch (error: any) {
    console.error(`[JobProcessor] Job ${job.id} failed:`, error);
    
    await updateBatchJob(job.id, {
      status: "failed",
      statusMessage: error.message || "Unknown error",
      completedAt: new Date(),
      errors: [{ message: error.message || "Unknown error" }],
    });
  }
}

/**
 * Process a catalog update job
 */
async function processCatalogUpdateJob(job: BatchJob, startTime: number): Promise<void> {
  const config = job.config;
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
          config.catalogId,
          batchIds,
          config.accessToken
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
          config.catalogId,
          requests,
          config.accessToken
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
