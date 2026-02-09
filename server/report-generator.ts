/**
 * Report Generator
 * 
 * This module handles background generation of Product Level Reports.
 * Reports are fetched from Facebook API and stored in the database.
 */

import axios from "axios";
import { 
  updateBatchJob, 
  createSavedReport, 
  updateSavedReport,
  getUserToken,
  createBatchHistoryRecord,
  updateBatchHistoryRecord,
  getScheduleRun,
  updateScheduleRun,
} from "./db";
import { notifyOwner } from "./_core/notification";
import { BatchJob } from "../drizzle/schema";
import { batchUpdateProducts } from "./catalog";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

const GRAPH_API_VERSION = 'v22.0';

// Field list for Facebook API
const FIELD_LIST = [
  'product_views',
  'converted_product_omni_purchase',
  'converted_product_omni_purchase_values',
  'converted_promoted_product_omni_purchase',
  'converted_promoted_product_omni_purchase_values',
  'converted_promoted_product_website_pixel_purchase',
  'converted_promoted_product_website_pixel_purchase_value',
  'converted_promoted_product_app_custom_event_fb_mobile_purchase',
  'converted_promoted_product_app_custom_event_fb_mobile_purchase_value',
  'converted_promoted_product_offline_purchase',
  'converted_promoted_product_offline_purchase_value',
  'product_name',
  'product_content_id',
  'product_group_content_id',
  'product_brand',
  'product_category',
  'product_custom_label_0',
  'product_custom_label_1',
  'product_custom_label_2',
  'product_custom_label_3',
  'product_custom_label_4',
  'product_retailer_id',
  'impressions',
  'spend',
  'inline_link_clicks',
  'ctr',
  'inline_link_click_ctr',
  'cpm',
  'cpc',
  'cost_per_inline_link_click',
  'purchase_roas',
  'website_purchase_roas',
  'mobile_app_purchase_roas',
  'results',
  'cost_per_result',
  'actions',
  'action_values'
];

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

interface ProductInsight {
  product_name: string;
  product_retailer_id: string;
  product_brand?: string;
  impressions: number;
  spend: number;
  link_clicks: number;
  inline_link_click_ctr?: number;
  cvr?: number;
  cpm: number;
  cost_per_inline_link_click?: number;
  purchases: number;
  adds_to_cart?: number;
  catalog_purchases?: number;
  product_set_purchases?: number;
  product_views?: number;
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
 * Map Facebook API row to ProductInsight
 */
function mapRowToProductInsight(row: any): ProductInsight {
  const pFloat = (val: any) => {
    if (!val) return 0;
    const cleanVal = String(val).replace(/[$,]/g, '');
    const num = parseFloat(cleanVal);
    return isNaN(num) ? 0 : num;
  };
  
  const pInt = (val: any) => {
    if (!val) return 0;
    const cleanVal = String(val).replace(/[,]/g, '');
    const num = parseInt(cleanVal, 10);
    return isNaN(num) ? 0 : num;
  };

  // Extract omni_purchase from actions array
  let adPurchases = 0;
  if (row.actions && Array.isArray(row.actions)) {
    const omniAction = row.actions.find((a: any) => a.action_type === 'omni_purchase');
    if (omniAction) {
      adPurchases = pInt(omniAction.value);
    }
  }

  const linkClicks = pInt(row.inline_link_clicks);
  const catalogPurchases = pInt(row.converted_product_omni_purchase);
  
  // CVR Calculation: Catalog Purchases / Link Clicks * 100
  let cvr = 0;
  if (linkClicks > 0) {
    cvr = (catalogPurchases / linkClicks) * 100;
  }

  return {
    product_name: row.product_name || row.product_retailer_id || 'N/A',
    product_retailer_id: row.product_retailer_id || row.product_content_id || 'N/A',
    product_brand: row.product_brand,
    impressions: pInt(row.impressions),
    spend: pFloat(row.spend),
    link_clicks: linkClicks,
    inline_link_click_ctr: pFloat(row.inline_link_click_ctr),
    cvr,
    cpm: pFloat(row.cpm),
    cost_per_inline_link_click: pFloat(row.cost_per_inline_link_click),
    purchases: adPurchases,
    adds_to_cart: pInt(row.adds_to_cart),
    catalog_purchases: catalogPurchases,
    product_set_purchases: pInt(row.converted_promoted_product_omni_purchase),
    product_views: pInt(row.product_views),
  };
}

/**
 * Create a report run on Facebook API
 */
async function createReportRun(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  accessToken: string,
  level: string = 'account',
  breakdown: string = 'product_id',
  filters?: Array<{field: string, operator: string, value: any}>
): Promise<string> {
  const formattedAccountId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  
  const queryParams: Record<string, string> = {
    access_token: accessToken,
    time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
    breakdowns: breakdown,
    fields: FIELD_LIST.join(','),
    is_async: 'true',
    export_format: 'csv',
    sort: 'impressions_descending'
  };

  if (level && level !== 'account') queryParams.level = level;
  if (filters && filters.length > 0) {
    queryParams.filtering = JSON.stringify(filters);
  }

  const params = new URLSearchParams(queryParams);
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${formattedAccountId}/insights?${params.toString()}`;
  
  console.log(`[ReportGenerator] API call params: level=${level}, breakdown=${breakdown}, filters=${filters ? JSON.stringify(filters) : 'none'}, dateRange=${dateStart} to ${dateEnd}`);
  
  const response = await axios.post(url, null, { timeout: 60000 });
  
  if (response.data.error) {
    console.error(`[ReportGenerator] Facebook API error:`, JSON.stringify(response.data.error));
    const errorMessage = response.data.error.error_user_msg || response.data.error.message || 'Failed to create report run';
    throw new Error(`${errorMessage} (Code: ${response.data.error.code})`);
  }
  
  return response.data.report_run_id;
}

/**
 * Poll report status until complete.
 * If the job fails, returns the failure info instead of throwing,
 * so the caller can decide whether to retry.
 */
async function pollReportStatus(
  reportRunId: string,
  accessToken: string,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; failureReason?: string }> {
  const maxAttempts = 120; // 10 minutes max
  const pollInterval = 5000; // 5 seconds
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${reportRunId}?access_token=${accessToken}`;
    const response = await axios.get(url, { timeout: 30000 });
    
    if (response.data.error) {
      console.error(`[ReportGenerator] Poll error:`, JSON.stringify(response.data.error));
      throw new Error(response.data.error.message || 'Failed to poll report status');
    }
    
    const status = response.data.async_status;
    const percent = response.data.async_percent_completion || 0;
    
    if (onProgress) {
      onProgress(percent);
    }
    
    if (status === 'Job Completed') {
      return { success: true };
    } else if (status === 'Job Failed' || status === 'Job Skipped') {
      console.error(`[ReportGenerator] Facebook async job failed. Full response:`, JSON.stringify(response.data));
      return { success: false, failureReason: status };
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  throw new Error('Report generation timed out');
}

/**
 * Fetch all insights data with pagination
 */
async function fetchInsightsData(
  reportRunId: string,
  accessToken: string,
  onProgress?: (loaded: number, total?: number) => void
): Promise<ProductInsight[]> {
  const allData: ProductInsight[] = [];
  let after: string | undefined = undefined;
  let pageCount = 0;
  const MAX_PAGE_RETRIES = 3;
  
  while (true) {
    let url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${reportRunId}/insights?access_token=${accessToken}&limit=1000`;
    if (after) {
      url += `&after=${after}`;
    }
    
    // Retry logic for individual page fetches (network errors, timeouts)
    let response;
    for (let retry = 0; retry <= MAX_PAGE_RETRIES; retry++) {
      try {
        response = await axios.get(url, { timeout: 60000 }); // 60s timeout per page
        break; // Success, exit retry loop
      } catch (fetchError: any) {
        const isRetryable = fetchError.code === 'ECONNRESET' 
          || fetchError.code === 'ETIMEDOUT'
          || fetchError.code === 'ECONNABORTED'
          || fetchError.code === 'ERR_SOCKET_CONNECTION_TIMEOUT'
          || fetchError.response?.status === 502
          || fetchError.response?.status === 503;
        
        if (retry < MAX_PAGE_RETRIES && isRetryable) {
          const delay = Math.pow(2, retry) * 2000; // 2s, 4s, 8s
          console.warn(`[ReportGenerator] Page ${pageCount + 1} fetch failed (${fetchError.code || fetchError.response?.status}), retrying in ${delay/1000}s... (${retry + 1}/${MAX_PAGE_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw fetchError; // Non-retryable or max retries exceeded
      }
    }
    
    if (!response) {
      throw new Error('Failed to fetch insights page after retries');
    }
    
    if (response.data.error) {
      throw new Error(response.data.error.message || 'Failed to fetch insights');
    }
    
    const data = response.data.data || [];
    const mappedData = data.map(mapRowToProductInsight);
    allData.push(...mappedData);
    
    pageCount++;
    console.log(`[ReportGenerator] Page ${pageCount}: ${data.length} records (total: ${allData.length})`);
    
    if (onProgress) {
      onProgress(allData.length);
    }
    
    // Check for next page
    if (response.data.paging?.next && response.data.paging?.cursors?.after) {
      after = response.data.paging.cursors.after;
    } else {
      break;
    }
  }
  
  return allData;
}

/**
 * Process a report generation job
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
    statusMessage: 'Creating report run...',
  });
  
  try {
    // Step 1: Create report run with retry logic
    // Facebook async jobs can fail with certain parameter combinations.
    // Strategy: Try with full params first, then retry without filters if it fails.
    let reportRunId: string = '';
    let usedFilters = filters.length > 0 ? filters : undefined;
    
    const MAX_RETRIES = 2;
    let lastFailureReason = '';
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[ReportGenerator] Retry attempt ${attempt}/${MAX_RETRIES} for ${adAccountId} (previous failure: ${lastFailureReason})`);
        await updateBatchJob(job.id, {
          statusMessage: `Retrying report generation (attempt ${attempt + 1})...`,
        });
        
        // On first retry: remove API-level filters (they can cause Job Failed)
        // The data will be fetched unfiltered and we'll filter client-side after
        if (attempt === 1 && usedFilters) {
          console.log(`[ReportGenerator] Retry without API-level filters`);
          usedFilters = undefined;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      console.log(`[ReportGenerator] Creating report run for ${adAccountId}... (attempt ${attempt + 1})`);
      reportRunId = await createReportRun(
        adAccountId,
        dateStart,
        dateEnd,
        accessToken,
        level,
        breakdown,
        usedFilters
      );
      
      console.log(`[ReportGenerator] Report run created: ${reportRunId}`);
      
      // Step 2: Poll for completion
      await updateBatchJob(job.id, {
        statusMessage: 'Waiting for report generation...',
      });
      
      const pollResult = await pollReportStatus(reportRunId, accessToken, async (percent) => {
        await updateBatchJob(job.id, {
          progress: Math.floor(percent * 0.5), // 0-50% for generation
          statusMessage: `Generating report: ${percent}%`,
        });
      });
      
      if (pollResult.success) {
        // Success! Continue to data fetching
        break;
      } else {
        lastFailureReason = pollResult.failureReason || 'Unknown';
        console.warn(`[ReportGenerator] Facebook async job failed (attempt ${attempt + 1}): ${lastFailureReason}`);
        
        if (attempt === MAX_RETRIES) {
          throw new Error(`Report generation failed after ${MAX_RETRIES + 1} attempts. Last status: ${lastFailureReason}`);
        }
      }
    }
    
    // If we removed filters for retry, log it
    if (filters.length > 0 && !usedFilters) {
      console.log(`[ReportGenerator] Note: API-level filters were removed during retry. Data will be unfiltered.`);
    }
    
    // Step 3: Fetch all data
    await updateBatchJob(job.id, {
      progress: 50,
      statusMessage: 'Fetching report data...',
    });
    
    // Estimate total items based on previous runs (~73k typical)
    // We'll use processedItems growth to calculate progress from 50% to 90%
    const ESTIMATED_TOTAL = 80000; // Conservative estimate for progress calculation
    const data = await fetchInsightsData(reportRunId, accessToken, async (loaded) => {
      // Calculate progress: 50% (report gen done) to 90% (data fetch done)
      const fetchProgress = Math.min(Math.floor((loaded / ESTIMATED_TOTAL) * 40), 40);
      const totalProgress = 50 + fetchProgress; // 50-90%
      await updateBatchJob(job.id, {
        progress: totalProgress,
        processedItems: loaded,
        statusMessage: `Fetched ${loaded.toLocaleString()} records...`,
      });
    });
    
    // Calculate statistics
    const totalSpend = data.reduce((sum, item) => sum + item.spend, 0);
    const totalImpressions = data.reduce((sum, item) => sum + item.impressions, 0);
    
    // Step 4: Save report data to S3 (too large for database max_allowed_packet)
    const durationMs = Date.now() - startTime;
    const jsonData = JSON.stringify(data);
    const s3Key = `reports/${job.userId}/${reportId}-${nanoid(8)}.json`;
    
    console.log(`[ReportGenerator] Uploading ${data.length} records (${(jsonData.length / 1024 / 1024).toFixed(1)}MB) to S3...`);
    const { url: s3Url } = await storagePut(s3Key, jsonData, 'application/json');
    console.log(`[ReportGenerator] Report data uploaded to S3: ${s3Key}`);
    
    await updateSavedReport(reportId, {
      data: s3Url, // Store S3 URL instead of raw data
      totalItems: data.length,
      totalSpend: Math.round(totalSpend * 100), // Store as cents
      totalImpressions,
      status: 'completed',
      generatedAt: new Date(),
      durationMs,
    });
    
    // Check if this is a combined workflow (report + catalog update)
    if (config.updateToCatalog && config.catalogId && config.catalogAccessToken) {
      console.log(`[ReportGenerator] Combined workflow: Updating catalog with ${data.length} products...`);
      
      await updateBatchJob(job.id, {
        progress: 60,
        statusMessage: `Updating catalog with ${data.length} products...`,
      });
      
      try {
        // Extract retailer IDs from report data
        const retailerIds = data.map(item => item.product_retailer_id).filter(id => id && id !== 'N/A');
        
        if (retailerIds.length > 0) {
          // Create batch history record for catalog update
          const historyId = await createBatchHistoryRecord({
            userId: job.userId,
            catalogId: config.catalogId,
            operationType: 'UPDATE',
            totalItems: retailerIds.length,
            batchCount: Math.ceil(retailerIds.length / 3000),
            updatedFields: [
              ...(config.customLabel4 ? ['custom_label_4'] : []),
              ...(config.customNumbers ? Object.keys(config.customNumbers) : []),
            ],
            updateCriteria: {
              sourceField: 'scheduled_report',
              targetField: 'custom_label_4, custom_number_0-4',
              condition: `reportId=${reportId}`,
              description: `Scheduled report update: customLabel4=${config.customLabel4 || 'N/A'}, customNumbers=${JSON.stringify(config.customNumbers || {})}`,
            },
            status: 'processing',
          });
          
          // Build update data with custom_label_4 and custom_number fields
          const updateData: Record<string, any> = {};
          
          // Add custom_label_4 if provided
          if (config.customLabel4) {
            updateData.custom_label_4 = config.customLabel4;
          }
          
          // Add custom_number fields (0-4) if provided
          if (config.customNumbers) {
            Object.entries(config.customNumbers).forEach(([key, value]) => {
              if (value && value.trim()) {
                updateData[key] = parseFloat(value);
              }
            });
          }
          
          // Build update requests using the helper function
          const { createUpdateRequest } = await import('./catalog');
          const requests = retailerIds.map(retailerId => 
            createUpdateRequest(retailerId, updateData)
          );
          
          // Perform batch update
          const result = await batchUpdateProducts(
            config.catalogId,
            requests,
            config.catalogAccessToken
          );
          
          // Update history record
          if (historyId) {
            await updateBatchHistoryRecord(historyId, {
              status: result.errors > 0 ? 'failed' : 'completed',
              handles: result.handles,
              successCount: result.success,
              errorCount: result.errors,
              durationMs: Date.now() - startTime,
            });
          }
          
          console.log(`[ReportGenerator] Catalog update completed: ${result.success} success, ${result.errors} errors`);
          
          await updateBatchJob(job.id, {
            progress: 90,
            statusMessage: `Catalog updated: ${result.success} products`,
          });
        }
      } catch (catalogError: any) {
        console.error(`[ReportGenerator] Catalog update failed:`, catalogError);
        // Don't fail the whole job, just log the error
        await updateBatchJob(job.id, {
          statusMessage: `Report completed, but catalog update failed: ${catalogError.message}`,
        });
      }
    }
    
    // Update job as completed
    const finalDurationMs = Date.now() - startTime;
    await updateBatchJob(job.id, {
      status: 'completed',
      progress: 100,
      processedItems: data.length,
      totalItems: data.length,
      successCount: data.length,
      completedAt: new Date(),
      statusMessage: config.updateToCatalog 
        ? `Report + Catalog update completed: ${data.length} products`
        : `Report completed: ${data.length} products`,
    });
    
    console.log(`[ReportGenerator] Job ${job.id} completed: ${data.length} products in ${finalDurationMs}ms`);
    
    // Update schedule run if this job was triggered by a schedule
    const scheduleRunId = config.scheduleRunId;
    if (scheduleRunId) {
      try {
        const run = await getScheduleRun(scheduleRunId);
        if (run) {
          const newCompletedJobs = (run.completedJobs || 0) + 1;
          const totalJobsDone = newCompletedJobs + (run.failedJobs || 0);
          const allDone = totalJobsDone >= (run.totalJobs || 1);
          
          let runStatus: 'running' | 'completed' | 'partial' | 'failed' = 'running';
          if (allDone) {
            if ((run.failedJobs || 0) === 0) runStatus = 'completed';
            else runStatus = 'partial';
          }
          
          // Calculate total spend and impressions from data
          let totalSpend = 0;
          let totalImpressions = 0;
          for (const item of data) {
            totalSpend += item.spend || 0;
            totalImpressions += item.impressions || 0;
          }
          
          await updateScheduleRun(scheduleRunId, {
            completedJobs: newCompletedJobs,
            totalItems: (run.totalItems || 0) + data.length,
            totalSpend: (run.totalSpend || 0) + Math.round(totalSpend * 100),
            totalImpressions: (run.totalImpressions || 0) + totalImpressions,
            status: runStatus,
            ...(allDone ? {
              completedAt: new Date(),
              durationMs: Date.now() - run.startedAt.getTime(),
            } : {}),
          });
          console.log(`[ReportGenerator] Updated schedule run ${scheduleRunId}: ${runStatus}`);
        }
      } catch (err) {
        console.warn(`[ReportGenerator] Failed to update schedule run:`, err);
      }
    }
    
    // Send notification to owner
    try {
      const durationMinutes = Math.round(finalDurationMs / 60000);
      const notificationTitle = config.updateToCatalog 
        ? `✅ Report + Catalog Update Completed`
        : `✅ Report Generation Completed`;
      const notificationContent = [
        `**Job ID:** ${job.id}`,
        `**Account:** ${config.adAccountId}`,
        `**Products:** ${data.length.toLocaleString()}`,
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
      // Don't fail the job if notification fails
    }
    
  } catch (error: any) {
    console.error(`[ReportGenerator] Job ${job.id} failed:`, error);
    
    // Update report as failed - truncate error message to prevent Data Too Long
    const truncatedError = (error.message || 'Unknown error').substring(0, 500);
    await updateSavedReport(reportId, {
      status: 'failed',
      errorMessage: truncatedError,
    });
    
    // Re-throw with truncated message to prevent cascading Data Too Long errors
    throw new Error(truncatedError);
  }
}
