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
  getUserToken
} from "./db";
import { BatchJob } from "../drizzle/schema";

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
  
  const response = await axios.post(url);
  
  if (response.data.error) {
    throw new Error(response.data.error.message || 'Failed to create report run');
  }
  
  return response.data.report_run_id;
}

/**
 * Poll report status until complete
 */
async function pollReportStatus(
  reportRunId: string,
  accessToken: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const maxAttempts = 120; // 10 minutes max
  const pollInterval = 5000; // 5 seconds
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${reportRunId}?access_token=${accessToken}`;
    const response = await axios.get(url);
    
    if (response.data.error) {
      throw new Error(response.data.error.message || 'Failed to poll report status');
    }
    
    const status = response.data.async_status;
    const percent = response.data.async_percent_completion || 0;
    
    if (onProgress) {
      onProgress(percent);
    }
    
    if (status === 'Job Completed') {
      return;
    } else if (status === 'Job Failed' || status === 'Job Skipped') {
      throw new Error(`Report generation failed with status: ${status}`);
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
  
  while (true) {
    let url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${reportRunId}/insights?access_token=${accessToken}&limit=1000`;
    if (after) {
      url += `&after=${after}`;
    }
    
    const response = await axios.get(url);
    
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
    // Step 1: Create report run
    console.log(`[ReportGenerator] Creating report run for ${adAccountId}...`);
    const reportRunId = await createReportRun(
      adAccountId,
      dateStart,
      dateEnd,
      accessToken,
      level,
      breakdown,
      filters.length > 0 ? filters : undefined
    );
    
    console.log(`[ReportGenerator] Report run created: ${reportRunId}`);
    
    // Step 2: Poll for completion
    await updateBatchJob(job.id, {
      statusMessage: 'Waiting for report generation...',
    });
    
    await pollReportStatus(reportRunId, accessToken, async (percent) => {
      await updateBatchJob(job.id, {
        progress: Math.floor(percent * 0.5), // 0-50% for generation
        statusMessage: `Generating report: ${percent}%`,
      });
    });
    
    // Step 3: Fetch all data
    await updateBatchJob(job.id, {
      progress: 50,
      statusMessage: 'Fetching report data...',
    });
    
    const data = await fetchInsightsData(reportRunId, accessToken, async (loaded) => {
      await updateBatchJob(job.id, {
        processedItems: loaded,
        statusMessage: `Fetched ${loaded} records...`,
      });
    });
    
    // Calculate statistics
    const totalSpend = data.reduce((sum, item) => sum + item.spend, 0);
    const totalImpressions = data.reduce((sum, item) => sum + item.impressions, 0);
    
    // Step 4: Save report data
    const durationMs = Date.now() - startTime;
    
    await updateSavedReport(reportId, {
      data,
      totalItems: data.length,
      totalSpend: Math.round(totalSpend * 100), // Store as cents
      totalImpressions,
      status: 'completed',
      generatedAt: new Date(),
      durationMs,
    });
    
    // Update job as completed
    await updateBatchJob(job.id, {
      status: 'completed',
      progress: 100,
      processedItems: data.length,
      totalItems: data.length,
      successCount: data.length,
      completedAt: new Date(),
      statusMessage: `Report completed: ${data.length} products`,
    });
    
    console.log(`[ReportGenerator] Job ${job.id} completed: ${data.length} products in ${durationMs}ms`);
    
  } catch (error: any) {
    console.error(`[ReportGenerator] Job ${job.id} failed:`, error);
    
    // Update report as failed
    await updateSavedReport(reportId, {
      status: 'failed',
      errorMessage: error.message || 'Unknown error',
    });
    
    throw error;
  }
}
