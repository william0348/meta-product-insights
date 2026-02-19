/**
 * Report Worker (Node.js)
 *
 * Replaces the Python worker (python/report_worker.py) with a pure Node.js
 * implementation so the production environment no longer requires Python.
 *
 * Responsibilities:
 *   1. Create a Facebook async report run (with retry)
 *   2. Poll for report completion
 *   3. Fetch all paginated insights data (with per-page retry)
 *   4. Map raw rows to ProductInsight structure
 *   5. Upload processed data to S3
 *   6. Catalog batch update (if requested)
 *   7. Catalog verification (if requested)
 *   8. Update job / report / schedule-run status in the database
 */

import axios, { AxiosError } from "axios";
import { storagePut } from "./storage";
import {
  updateBatchJob,
  updateSavedReport,
  createBatchHistoryRecord,
  updateBatchHistoryRecord,
  getScheduleRun,
  updateScheduleRun,
} from "./db";
import {
  batchUpdateProducts,
  createUpdateRequest,
  BatchRequestItem,
} from "./catalog";
import { nanoid } from "nanoid";

// ─── Constants ─────────────────────────────────────────────────────────────

const GRAPH_API_VERSION = "v22.0";
const FB_CATALOG_API_VERSION = "v24.0";
const PAGE_SIZE = 1000;
const MAX_PAGE_RETRIES = 5;
const MAX_REPORT_RETRIES = 2;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 120; // ~10 minutes max

const FIELD_LIST = [
  "product_views",
  "converted_product_omni_purchase",
  "converted_product_omni_purchase_values",
  "converted_promoted_product_omni_purchase",
  "converted_promoted_product_omni_purchase_values",
  "converted_promoted_product_website_pixel_purchase",
  "converted_promoted_product_website_pixel_purchase_value",
  "converted_promoted_product_app_custom_event_fb_mobile_purchase",
  "converted_promoted_product_app_custom_event_fb_mobile_purchase_value",
  "converted_promoted_product_offline_purchase",
  "converted_promoted_product_offline_purchase_value",
  "product_name",
  "product_content_id",
  "product_group_content_id",
  "product_brand",
  "product_category",
  "product_custom_label_0",
  "product_custom_label_1",
  "product_custom_label_2",
  "product_custom_label_3",
  "product_custom_label_4",
  "product_retailer_id",
  "impressions",
  "spend",
  "inline_link_clicks",
  "ctr",
  "inline_link_click_ctr",
  "cpm",
  "cpc",
  "cost_per_inline_link_click",
  "purchase_roas",
  "website_purchase_roas",
  "mobile_app_purchase_roas",
  "results",
  "cost_per_result",
  "actions",
  "action_values",
];

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkerConfig {
  jobId: number;
  reportId: number;
  userId: string;
  adAccountId: string;
  accessToken: string;
  dateStart: string;
  dateEnd: string;
  level?: string;
  breakdown?: string;
  filters?: Array<{ field: string; operator: string; value: any }> | null;
  // Catalog
  updateToCatalog?: boolean;
  catalogId?: string;
  catalogAccessToken?: string;
  customLabel4?: string;
  enableCustomLabel4?: boolean;
  customNumbers?: Record<string, string>;
  // Schedule
  scheduleRunId?: number;
}

export interface WorkerResult {
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

interface ProductInsight {
  product_name: string;
  product_retailer_id: string;
  product_brand: string | null;
  impressions: number;
  spend: number;
  link_clicks: number;
  inline_link_click_ctr: number;
  cvr: number;
  cpm: number;
  cost_per_inline_link_click: number;
  purchases: number;
  adds_to_cart: number;
  catalog_purchases: number;
  product_set_purchases: number;
  product_views: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function pFloat(val: any): number {
  if (val == null || val === "") return 0;
  const n = parseFloat(String(val).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pInt(val: any): number {
  if (val == null || val === "") return 0;
  const n = parseInt(String(val).replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Facebook API ──────────────────────────────────────────────────────────

async function createReportRun(
  adAccountId: string,
  dateStart: string,
  dateEnd: string,
  accessToken: string,
  level: string,
  breakdown: string,
  filters?: Array<{ field: string; operator: string; value: any }> | null,
): Promise<string> {
  const formattedId = adAccountId.startsWith("act_")
    ? adAccountId
    : `act_${adAccountId}`;

  const params: Record<string, string> = {
    access_token: accessToken,
    level,
    fields: JSON.stringify(FIELD_LIST),
    time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
    action_breakdowns: JSON.stringify(["action_type"]),
    breakdowns: JSON.stringify([breakdown]),
    time_increment: "all_days",
    export_format: "csv",
  };
  if (filters && filters.length > 0) {
    params.filtering = JSON.stringify(filters);
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${formattedId}/insights`;
  const { data } = await axios.post(url, null, { params, timeout: 60_000 });

  if (data.error) {
    const msg =
      data.error.error_user_msg || data.error.message || "Unknown error";
    const code = data.error.code ?? "?";
    throw new Error(`${msg} (Code: ${code})`);
  }
  return data.report_run_id;
}

async function pollReportStatus(
  reportRunId: string,
  accessToken: string,
  onProgress?: (percent: number) => Promise<void>,
): Promise<{ success: boolean; failureReason?: string }> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${reportRunId}`;
    const { data } = await axios.get(url, {
      params: { access_token: accessToken },
      timeout: 30_000,
    });

    if (data.error) {
      throw new Error(data.error.message || "Poll error");
    }

    const status: string = data.async_status ?? "";
    const percent: number = data.async_percent_completion ?? 0;

    if (onProgress) await onProgress(percent);

    if (status === "Job Completed") return { success: true };
    if (status === "Job Failed" || status === "Job Skipped") {
      return { success: false, failureReason: status };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("Report generation timed out (polling exceeded max attempts)");
}

async function fetchInsightsData(
  reportRunId: string,
  accessToken: string,
  onProgress?: (loaded: number) => Promise<void>,
  onHeartbeat?: (message: string) => Promise<void>,
): Promise<any[]> {
  const allData: any[] = [];
  let after: string | null = null;
  let pageCount = 0;

  while (true) {
    let url =
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${reportRunId}/insights` +
      `?access_token=${accessToken}&limit=${PAGE_SIZE}`;
    if (after) url += `&after=${after}`;

    // Per-page retry with AbortController to prevent hanging requests
    let responseData: any = null;
    for (let retry = 0; retry <= MAX_PAGE_RETRIES; retry++) {
      try {
        // Use AbortController with 60s hard timeout to prevent TCP-level hangs
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), 60_000);
        try {
          const resp = await axios.get(url, {
            timeout: 45_000,
            signal: controller.signal,
            headers: { "Accept-Encoding": "gzip, deflate" },
          });
          responseData = resp.data;

          // Check Facebook rate limit headers
          const usageHeader = resp.headers?.['x-business-use-case-usage'] || resp.headers?.['x-app-usage'];
          if (usageHeader) {
            try {
              const usage = typeof usageHeader === 'string' ? JSON.parse(usageHeader) : usageHeader;
              // Check if any account is near the rate limit
              const values = Object.values(usage) as any[];
              for (const val of values) {
                const entries = Array.isArray(val) ? val : [val];
                for (const entry of entries) {
                  const callPct = entry.call_count ?? entry.total_cputime ?? 0;
                  if (callPct > 75) {
                    const waitSec = Math.min(Math.ceil(callPct / 10) * 5, 120);
                    console.log(
                      `[ReportWorker] Rate limit approaching (${callPct}%), waiting ${waitSec}s…`,
                    );
                    if (onHeartbeat) await onHeartbeat(`Rate limit cooldown (${callPct}%)…`);
                    await sleep(waitSec * 1000);
                  }
                }
              }
            } catch { /* ignore parse errors */ }
          }
        } finally {
          clearTimeout(abortTimer);
        }
      } catch (err: any) {
        const errDetail = err.code || err.message || 'unknown';
        // Send heartbeat during retries so Job Processor knows we're still alive
        if (onHeartbeat) {
          await onHeartbeat(`Page ${pageCount + 1} retry ${retry + 1}/${MAX_PAGE_RETRIES}: ${errDetail}`);
        }
        if (retry < MAX_PAGE_RETRIES) {
          // Use longer backoff for later retries (up to ~64s)
          const delay = Math.min(2 ** retry * 2_000, 64_000);
          console.log(
            `[ReportWorker] Page ${pageCount + 1} fetch failed (${errDetail}), ` +
              `retrying in ${delay / 1000}s… (${retry + 1}/${MAX_PAGE_RETRIES})`,
          );
          await sleep(delay);
          continue;
        }
        throw err;
      }

      // API-level errors (Facebook returns 200 with error body)
      if (responseData?.error) {
        const errMsg = responseData.error.message || "Failed to fetch insights";
        const errCode = responseData.error.code ?? 0;
        const isTransient =
          [1, 2, 4, 17, 32, 80004, 190, 368].includes(errCode) ||
          /unknown|temporarily|rate|throttl/i.test(errMsg);

        if (isTransient && retry < MAX_PAGE_RETRIES) {
          // Rate limit errors need longer backoff
          const isRateLimit = errCode === 80004 || errCode === 4 || errCode === 32 || /rate|throttl/i.test(errMsg);
          const delay = isRateLimit
            ? Math.min(2 ** retry * 30_000, 300_000) // 30s, 60s, 120s, 240s, 300s for rate limits
            : Math.min(2 ** retry * 3_000, 60_000);  // 3s, 6s, 12s, 24s, 48s for other transient
          console.log(
            `[ReportWorker] Page ${pageCount + 1} API error code=${errCode} (${errMsg}), ` +
              `retrying in ${delay / 1000}s… (${retry + 1}/${MAX_PAGE_RETRIES})`,
          );
          if (onHeartbeat) {
            await onHeartbeat(`API error on page ${pageCount + 1}, retrying in ${delay / 1000}s…`);
          }
          await sleep(delay);
          responseData = null;
          continue;
        }
        throw new Error(errMsg);
      }

      break; // success
    }

    if (!responseData) {
      throw new Error(
        `Failed to fetch insights page after ${MAX_PAGE_RETRIES} retries`,
      );
    }

    const rows: any[] = responseData.data ?? [];
    allData.push(...rows);
    pageCount++;
    console.log(
      `[ReportWorker] Page ${pageCount}: ${rows.length} records (total: ${allData.length})`,
    );

    if (onProgress) await onProgress(allData.length);

    const paging = responseData.paging ?? {};
    if (paging.next && paging.cursors?.after) {
      after = paging.cursors.after;
    } else {
      break;
    }
  }

  return allData;
}

// ─── Data Mapping ──────────────────────────────────────────────────────────

function mapRowToProductInsight(row: any): ProductInsight {
  // Extract omni_purchase from actions array
  let adPurchases = 0;
  if (Array.isArray(row.actions)) {
    for (const a of row.actions) {
      if (a.action_type === "omni_purchase") {
        adPurchases = pInt(a.value);
        break;
      }
    }
  }

  const linkClicks = pInt(row.inline_link_clicks);
  const catalogPurchases = pInt(row.converted_product_omni_purchase);
  const cvr = linkClicks > 0 ? (catalogPurchases / linkClicks) * 100 : 0;

  return {
    product_name:
      row.product_name || row.product_retailer_id || "N/A",
    product_retailer_id:
      row.product_retailer_id || row.product_content_id || "N/A",
    product_brand: row.product_brand ?? null,
    impressions: pInt(row.impressions),
    spend: pFloat(row.spend),
    link_clicks: linkClicks,
    inline_link_click_ctr: pFloat(row.inline_link_click_ctr),
    cvr: Math.round(cvr * 1e6) / 1e6,
    cpm: pFloat(row.cpm),
    cost_per_inline_link_click: pFloat(row.cost_per_inline_link_click),
    purchases: adPurchases,
    adds_to_cart: 0,
    catalog_purchases: catalogPurchases,
    product_set_purchases: pInt(
      row.converted_promoted_product_omni_purchase,
    ),
    product_views: pInt(row.product_views),
  };
}

// ─── Catalog Verification ──────────────────────────────────────────────────

async function verifyCatalogUpdate(
  catalogId: string,
  accessToken: string,
  updateFields: Record<string, any>,
): Promise<{
  total_catalog_products: number;
  fields: Record<
    string,
    { value: string; matched_count: number; total_count: number; error?: string }
  >;
}> {
  const baseUrl = `https://graph.facebook.com/${FB_CATALOG_API_VERSION}`;
  const verification: Record<
    string,
    { value: string; matched_count: number; total_count: number; error?: string }
  > = {};

  // Get total product count
  let totalCount = 0;
  try {
    const { data } = await axios.get(`${baseUrl}/${catalogId}/products`, {
      params: {
        access_token: accessToken,
        limit: 0,
        summary: "true",
        fields: "id",
      },
      timeout: 30_000,
    });
    totalCount = data.summary?.total_count ?? 0;
    console.log(`[ReportWorker] Catalog total products: ${totalCount}`);
  } catch (e: any) {
    console.log(`[ReportWorker] Failed to get total product count: ${e.message}`);
  }

  for (const [fieldName, fieldValue] of Object.entries(updateFields)) {
    try {
      let filterParam: string;
      if (fieldName === "custom_label_4") {
        filterParam = JSON.stringify({ custom_label_4: { eq: String(fieldValue) } });
      } else if (fieldName.startsWith("custom_number_")) {
        filterParam = JSON.stringify({ [fieldName]: { eq: Number(fieldValue) } });
      } else {
        continue;
      }

      const { data } = await axios.get(`${baseUrl}/${catalogId}/products`, {
        params: {
          access_token: accessToken,
          limit: 0,
          summary: "true",
          fields: "id",
          filter: filterParam,
        },
        timeout: 30_000,
      });

      if (data.error) {
        console.log(
          `[ReportWorker] Verification filter error for ${fieldName}: ${data.error.message}`,
        );
        verification[fieldName] = {
          value: String(fieldValue),
          matched_count: -1,
          total_count: totalCount,
          error: data.error.message,
        };
      } else {
        const matched = data.summary?.total_count ?? 0;
        console.log(
          `[ReportWorker] Verification: ${fieldName}=${fieldValue} -> ${matched}/${totalCount} products match`,
        );
        verification[fieldName] = {
          value: String(fieldValue),
          matched_count: matched,
          total_count: totalCount,
        };
      }

      await sleep(500);
    } catch (e: any) {
      console.log(`[ReportWorker] Verification failed for ${fieldName}: ${e.message}`);
      verification[fieldName] = {
        value: String(fieldValue),
        matched_count: -1,
        total_count: totalCount,
        error: e.message,
      };
    }
  }

  return { total_catalog_products: totalCount, fields: verification };
}

// ─── Main Worker ───────────────────────────────────────────────────────────

export async function runReportWorker(config: WorkerConfig): Promise<WorkerResult> {
  const startTime = Date.now();
  const {
    jobId,
    reportId,
    userId,
    adAccountId,
    accessToken,
    dateStart,
    dateEnd,
    level = "account",
    breakdown = "product_id",
  } = config;

  try {
    // ── Step 1: Create report run (with retry) ──
    let reportRunId: string = "";
    let usedFilters = config.filters ?? null;
    let lastFailure = "";

    for (let attempt = 0; attempt <= MAX_REPORT_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(
          `[ReportWorker] Retry attempt ${attempt}/${MAX_REPORT_RETRIES} (prev: ${lastFailure})`,
        );
        await updateBatchJob(jobId, {
          statusMessage: `Retrying report generation (attempt ${attempt + 1})…`,
        });
        if (attempt === 1 && usedFilters) {
          console.log("[ReportWorker] Retry without API-level filters");
          usedFilters = null;
        }
        await sleep(5_000);
      }

      console.log(
        `[ReportWorker] Creating report run for ${adAccountId}… (attempt ${attempt + 1})`,
      );
      reportRunId = await createReportRun(
        adAccountId,
        dateStart,
        dateEnd,
        accessToken,
        level,
        breakdown,
        usedFilters,
      );
      console.log(`[ReportWorker] Report run created: ${reportRunId}`);

      // ── Step 2: Poll for completion ──
      await updateBatchJob(jobId, {
        statusMessage: "Waiting for report generation…",
      });

      const pollResult = await pollReportStatus(
        reportRunId,
        accessToken,
        async (percent) => {
          const progress = Math.floor(percent * 0.5); // 0-50%
          await updateBatchJob(jobId, {
            progress,
            statusMessage: `Generating report: ${percent}%`,
          });
        },
      );

      if (pollResult.success) break;

      lastFailure = pollResult.failureReason || "Unknown";
      console.log(
        `[ReportWorker] Facebook async job failed (attempt ${attempt + 1}): ${lastFailure}`,
      );
      if (attempt === MAX_REPORT_RETRIES) {
        throw new Error(
          `Report generation failed after ${MAX_REPORT_RETRIES + 1} attempts. Last status: ${lastFailure}`,
        );
      }
    }

    if (config.filters && !usedFilters) {
      console.log(
        "[ReportWorker] Note: API-level filters removed during retry. Data is unfiltered.",
      );
    }

    // ── Step 3: Fetch all data ──
    await updateBatchJob(jobId, {
      progress: 50,
      statusMessage: "Fetching report data…",
    });

    const estimatedTotal = 80_000;

    const rawData = await fetchInsightsData(
      reportRunId,
      accessToken,
      async (loaded) => {
        const fetchPct = Math.min(Math.floor((loaded / estimatedTotal) * 40), 40);
        const totalPct = 50 + fetchPct; // 50-90%
        await updateBatchJob(jobId, {
          progress: totalPct,
          processedItems: loaded,
          statusMessage: `Fetched ${loaded.toLocaleString()} records…`,
        });
      },
      // Heartbeat callback: updates statusMessage during retries/rate-limit waits
      // so the Job Processor's stale-progress detector doesn't kill us
      async (heartbeatMsg) => {
        try {
          await updateBatchJob(jobId, {
            statusMessage: heartbeatMsg,
          });
        } catch {
          // Ignore DB errors in heartbeat — best effort
        }
      },
    );

    // ── Step 4: Map data ──
    console.log(`[ReportWorker] Mapping ${rawData.length} rows…`);
    const mappedData = rawData.map(mapRowToProductInsight);

    let totalSpend = 0;
    let totalImpressions = 0;
    for (const row of mappedData) {
      totalSpend += row.spend;
      totalImpressions += row.impressions;
    }

    // ── Step 5: Upload to S3 ──
    const jsonStr = JSON.stringify(mappedData);
    const sizeMB = Buffer.byteLength(jsonStr, "utf-8") / 1024 / 1024;
    console.log(
      `[ReportWorker] Uploading ${mappedData.length} records (${sizeMB.toFixed(1)}MB) to S3…`,
    );

    const s3Key = `reports/${userId}/${reportId}-${nanoid(8)}.json`;
    const { url: s3Url } = await storagePut(s3Key, jsonStr, "application/json");
    console.log(`[ReportWorker] Report data uploaded to S3: ${s3Key}`);

    // Update saved_reports
    const durationMs = Date.now() - startTime;
    await updateSavedReport(reportId, {
      data: s3Url,
      totalItems: mappedData.length,
      totalSpend: Math.round(totalSpend * 100), // cents
      totalImpressions,
      status: "completed",
      generatedAt: new Date(),
      durationMs,
    });

    // ── Step 6: Catalog update (if requested) ──
    if (config.updateToCatalog && config.catalogId && config.catalogAccessToken) {
      console.log(
        `[ReportWorker] Combined workflow: Updating catalog with ${mappedData.length} products…`,
      );
      await updateBatchJob(jobId, {
        progress: 91,
        statusMessage: `Updating catalog with ${mappedData.length} products…`,
      });

      const retailerIds = mappedData
        .map((item) => item.product_retailer_id)
        .filter((id) => id && id !== "N/A");

      if (retailerIds.length > 0) {
        // Build update data
        const updateFields: Record<string, any> = {};
        const enableCustomLabel4 = config.enableCustomLabel4 ?? true;
        if (enableCustomLabel4 && config.customLabel4) {
          updateFields.custom_label_4 = config.customLabel4;
        }
        const customNumbers = config.customNumbers ?? {};
        for (const [key, value] of Object.entries(customNumbers)) {
          if (value && String(value).trim()) {
            updateFields[key] = parseFloat(value);
          }
        }

        // Create batch history record
        const updatedFieldNames = Object.keys(updateFields);
        const historyId = await createBatchHistoryRecord({
          userId: parseInt(userId) || 0,
          catalogId: config.catalogId,
          operationType: "UPDATE",
          totalItems: retailerIds.length,
          batchCount: Math.ceil(retailerIds.length / 3000),
          updatedFields: updatedFieldNames,
          updateCriteria: {
            sourceField: "scheduled_report",
            targetField: "custom_label_4, custom_number_0-4",
            condition: `reportId=${reportId}`,
            description: `Scheduled report update: customLabel4=${config.customLabel4 || "N/A"}, customNumbers=${JSON.stringify(customNumbers)}`,
          },
          status: "processing",
        });

        try {
          // Build batch requests using existing catalog.ts helpers
          const batchRequests: BatchRequestItem[] = retailerIds.map((rid) =>
            createUpdateRequest(rid, updateFields),
          );

          const result = await batchUpdateProducts(
            config.catalogId,
            batchRequests,
            config.catalogAccessToken,
            false, // allow_upsert = false
          );

          if (historyId) {
            await updateBatchHistoryRecord(historyId, {
              status: result.errors > 0 ? "failed" : "completed",
              handles: result.handles,
              successCount: result.success,
              errorCount: result.errors,
              durationMs: Date.now() - startTime,
            });
          }

          console.log(
            `[ReportWorker] Catalog update completed: ${result.success} success, ${result.errors} errors`,
          );
          await updateBatchJob(jobId, {
            progress: 95,
            statusMessage: `Catalog updated: ${result.success} products. Verifying…`,
          });

          // ── Step 6b: Verify catalog update ──
          try {
            console.log("[ReportWorker] Starting catalog verification…");
            await updateBatchJob(jobId, {
              progress: 97,
              statusMessage: "Verifying catalog update…",
            });

            const verification = await verifyCatalogUpdate(
              config.catalogId,
              config.catalogAccessToken,
              updateFields,
            );

            const verifyParts: string[] = [];
            for (const [fname, finfo] of Object.entries(verification.fields)) {
              if (finfo.matched_count >= 0) {
                verifyParts.push(
                  `${fname}=${finfo.value}: ${finfo.matched_count}/${finfo.total_count}`,
                );
              } else {
                verifyParts.push(`${fname}: verification failed`);
              }
            }
            const verifySummary =
              verifyParts.length > 0 ? verifyParts.join("; ") : "No fields verified";
            const totalCatalog = verification.total_catalog_products;

            if (historyId) {
              await updateBatchHistoryRecord(historyId, {
                updateCriteria: {
                  sourceField: "scheduled_report",
                  targetField: Object.keys(updateFields).join(", "),
                  condition: `reportId=${reportId}`,
                  description: `Scheduled report update: ${verifySummary}`,
                },
              });
            }

            await updateBatchJob(jobId, {
              progress: 98,
              statusMessage: `Catalog updated: ${result.success} products. Verified: ${verifySummary} (Total catalog: ${totalCatalog})`,
            });
            console.log(
              `[ReportWorker] Verification complete: ${verifySummary} (Total catalog: ${totalCatalog})`,
            );
          } catch (verifyErr: any) {
            console.log(
              `[ReportWorker] Verification failed (non-critical): ${verifyErr.message}`,
            );
          }
        } catch (catErr: any) {
          console.log(`[ReportWorker] Catalog update failed: ${catErr.message}`);
          await updateBatchJob(jobId, {
            statusMessage: `Report completed, but catalog update failed: ${String(catErr.message).substring(0, 200)}`,
          });
        }
      }
    }

    // ── Step 7: Mark job completed ──
    const finalDurationMs = Date.now() - startTime;
    const statusMsg = config.updateToCatalog
      ? `Report + Catalog update completed: ${mappedData.length} products`
      : `Report completed: ${mappedData.length} products`;

    await updateBatchJob(jobId, {
      status: "completed",
      progress: 100,
      processedItems: mappedData.length,
      totalItems: mappedData.length,
      successCount: mappedData.length,
      completedAt: new Date(),
      statusMessage: statusMsg,
    });

    console.log(
      `[ReportWorker] Job ${jobId} completed: ${mappedData.length} products in ${finalDurationMs}ms`,
    );

    // ── Step 8: Update schedule run if applicable ──
    if (config.scheduleRunId) {
      try {
        const run = await getScheduleRun(config.scheduleRunId);
        if (run) {
          const newCompleted = (run.completedJobs ?? 0) + 1;
          const totalDone = newCompleted + (run.failedJobs ?? 0);
          const allDone = totalDone >= (run.totalJobs ?? 1);

          let runStatus: string = "running";
          if (allDone) {
            runStatus = (run.failedJobs ?? 0) === 0 ? "completed" : "partial";
          }

          const updateKwargs: Record<string, any> = {
            completedJobs: newCompleted,
            totalItems: (run.totalItems ?? 0) + mappedData.length,
            totalSpend: (run.totalSpend ?? 0) + Math.round(totalSpend * 100),
            totalImpressions: (run.totalImpressions ?? 0) + totalImpressions,
            status: runStatus,
          };
          if (allDone) {
            updateKwargs.completedAt = new Date();
            if (run.startedAt) {
              updateKwargs.durationMs =
                Date.now() - new Date(run.startedAt).getTime();
            }
          }

          await updateScheduleRun(config.scheduleRunId, updateKwargs);
          console.log(
            `[ReportWorker] Updated schedule run ${config.scheduleRunId}: ${runStatus}`,
          );
        }
      } catch (runErr: any) {
        console.log(
          `[ReportWorker] Failed to update schedule run: ${runErr.message}`,
        );
      }
    }

    return {
      success: true,
      jobId,
      reportId,
      totalItems: mappedData.length,
      totalSpend,
      totalImpressions,
      durationMs: finalDurationMs,
      s3Url,
    };
  } catch (error: any) {
    const errorMsg = String(error.message || "Unknown error").substring(0, 500);
    console.error(`[ReportWorker] Job ${jobId} failed: ${errorMsg}`);

    // Update saved report as failed
    try {
      await updateSavedReport(reportId, {
        status: "failed",
        errorMessage: errorMsg,
      });
    } catch {
      // ignore
    }

    return { success: false, jobId, error: errorMsg };
  }
}
