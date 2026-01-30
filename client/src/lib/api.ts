import { AsyncJobStatus, ProductInsightData, ReportRunResponse, ReportRunStatus } from '../types';
import * as Papa from 'papaparse';

const GRAPH_API_VERSION = 'v22.0';

// Helper to map CSV Row to ProductInsightData
// The CSV headers from Meta are usually user-friendly (e.g., "Product Name", "Impressions")
// We need to map them back to our internal structure.
const mapCsvRowToProductInsightData = (row: any): ProductInsightData => {
  const pFloat = (val: any) => {
    if (!val) return 0;
    // Remove currency symbols or commas if present
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

  // Helper to find value by possible header names (Meta CSV headers can vary slightly)
  const getVal = (keys: string[]) => {
    for (const key of keys) {
      if (row[key] !== undefined) return row[key];
    }
    return undefined;
  };

  const id = getVal(['Product Item ID', 'Content ID', 'product_retailer_id', 'product_content_id']) || 'N/A';
  const name = getVal(['Product Name', 'product_name']) || id;

  // Extract action values from CSV columns if they exist as specific columns
  // Note: Meta CSV export flattens 'actions' into specific columns like "Purchases", "Website Purchases", etc.
  
  // Ad Purchases (Omni)
  const adPurchases = pInt(getVal(['Purchases', 'Ad Purchases', 'actions:omni_purchase']));
  
  // Catalog Purchases
  // Try finding specific catalog purchase column first
  let catalogPurchases = pInt(getVal(['Catalog Purchases', 'actions:catalog_purchase', 'converted_product_omni_purchase']));
  
  // Link Clicks
  const linkClicks = pInt(getVal(['Link Clicks', 'inline_link_clicks']));

  // CVR Calculation: Catalog Purchases / Link Clicks * 100
  let cvr = 0;
  if (linkClicks > 0) {
    cvr = (catalogPurchases / linkClicks) * 100;
  }

  return {
    product_name: name,
    product_retailer_id: id,
    product_brand: getVal(['Brand', 'product_brand']),
    product_category: getVal(['Category', 'product_category']),
    
    impressions: pInt(getVal(['Impressions', 'impressions'])),
    spend: pFloat(getVal(['Amount Spent (USD)', 'Amount Spent', 'spend'])),
    clicks: 0, 
    link_clicks: linkClicks,
    outbound_clicks: 0,
    
    cpm: pFloat(getVal(['CPM (Cost per 1,000 Impressions)', 'CPM', 'cpm'])),
    ctr: pFloat(getVal(['CTR (All)', 'CTR', 'ctr'])), // Note: Check if CTR (Link Click-Through Rate) is available
    inline_link_click_ctr: pFloat(getVal(['CTR (Link Click-Through Rate)', 'inline_link_click_ctr'])),
    outbound_ctr: 0,
    cpc: pFloat(getVal(['CPC (All)', 'CPC', 'cpc'])),
    cost_per_inline_link_click: pFloat(getVal(['Cost per Link Click', 'cost_per_inline_link_click'])),
    cost_per_outbound_click: 0,
    
    cvr: cvr,

    // Purchase Metrics
    purchases: adPurchases,
    purchase_value: pFloat(getVal(['Purchase ROAS (Return on Ad Spend)', 'purchase_value'])), // This might be value, double check mapping if column exists
    avg_purchase_value: 0,
    
    website_purchases: 0,
    mobile_app_purchases: 0,
    offline_purchases: 0,
    onsite_purchases: 0,
    
    purchase_roas: pFloat(getVal(['Purchase ROAS (Return on Ad Spend)', 'purchase_roas'])),
    website_roas: pFloat(getVal(['Website Purchase ROAS', 'website_purchase_roas'])),
    mobile_app_roas: pFloat(getVal(['Mobile App Purchase ROAS', 'mobile_app_purchase_roas'])),
    
    adds_to_cart: 0,
    website_adds_to_cart: 0,
    mobile_app_adds_to_cart: 0,

    // Catalog & Product Set Metrics
    catalog_purchases: catalogPurchases,
    catalog_purchase_value: pFloat(getVal(['Catalog Purchase Value', 'converted_product_omni_purchase_values'])),
    
    product_set_purchases: pInt(getVal(['Product Set Purchases', 'converted_promoted_product_omni_purchase'])),
    product_set_purchase_value: pFloat(getVal(['Product Set Purchase Value', 'converted_promoted_product_omni_purchase_values'])),
    
    product_views: pInt(getVal(['Content Views', 'product_views'])),
    
    date_start: getVal(['Reporting Starts', 'date_start']),
    date_stop: getVal(['Reporting Ends', 'date_stop'])
  };
};


export const facebookApiService = {
  createReportRun: async (accountId: string, startDate: string, endDate: string, accessToken?: string, level: string = 'account', breakdown: string = 'product_id', filters?: Array<{field: string, operator: string, value: any}>): Promise<ReportRunResponse> => {
    
    if (!accessToken) {
      throw new Error("Access Token is required to fetch real data from Meta Marketing API.");
    }

    // Ensure accountId has act_ prefix
    const formattedAccountId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

    // Optimized field list removing Add to Cart and specific Purchase metrics
    const fieldList = [
      // Product Views
      'product_views',
      
      // Purchases (Product Level)
      'converted_product_omni_purchase',
      'converted_product_omni_purchase_values',
      
      // Product Set / Promoted Product Purchases
      'converted_promoted_product_omni_purchase',
      'converted_promoted_product_omni_purchase_values',
      
      'converted_promoted_product_website_pixel_purchase',
      'converted_promoted_product_website_pixel_purchase_value',
      'converted_promoted_product_app_custom_event_fb_mobile_purchase',
      'converted_promoted_product_app_custom_event_fb_mobile_purchase_value',
      'converted_promoted_product_offline_purchase',
      'converted_promoted_product_offline_purchase_value',
      
      // Standard Metadata
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
      
      // Standard Metrics
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
      
      // REQUIRED for Ad Purchases (Omni)
      'actions',
      'action_values'
    ];
    
    const fields = fieldList.join(',');
    const sort = 'impressions_descending'; 
    
    const queryParams: Record<string, string> = {
      access_token: accessToken,
      time_range: JSON.stringify({ since: startDate, until: endDate }),
      breakdowns: breakdown,
      fields: fields,
      is_async: 'true',
      export_format: 'csv' // Explicitly set to 'csv'
    };

    if (sort) queryParams.sort = sort;
    if (level && level !== 'account') queryParams.level = level;
    
    // Add filtering if provided
    if (filters && filters.length > 0) {
      queryParams.filtering = JSON.stringify(filters);
    }

    const params = new URLSearchParams(queryParams);
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${formattedAccountId}/insights?${params.toString()}`, { method: 'POST' });

    const data = await response.json();
    if (data.error) {
      console.error("Meta API Error:", JSON.stringify(data.error, null, 2));
      const errorMessage = data.error.error_user_msg || data.error.message || "Failed to create report run";
      throw new Error(`${errorMessage} (Code: ${data.error.code})`);
    }
    return { report_run_id: data.report_run_id };
  },

  pollReportStatus: async (reportRunId: string, accessToken?: string): Promise<ReportRunStatus> => {
    if (!accessToken) {
      throw new Error("Access Token is required.");
    }
    
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${reportRunId}?access_token=${accessToken}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || "Failed to poll report status");
    return {
      id: data.id,
      account_id: data.account_id || 'unknown',
      time_ref: Date.now(),
      async_status: data.async_status,
      async_percent_completion: data.async_percent_completion,
      date_start: "", 
      date_stop: ""
    };
  },

  // NEW: Download CSV via backend proxy to avoid CORS
  async downloadReportCSV(
    reportRunId: string,
    accessToken?: string,
    onProgress?: (data: ProductInsightData[]) => void,
    onDownloadProgress?: (percent: number) => void
  ): Promise<{ data: ProductInsightData[] }> {
    // Retry logic for 503 errors (Facebook CDN not ready)
    const maxRetries = 3;
    const retryDelays = [5000, 10000, 15000]; // 5s, 10s, 15s
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Use backend proxy to download CSV (avoids CORS)
        // tRPC batch format: input is a JSON object with "0" key containing the query params
        const input = {
          "0": {
            json: {
              reportRunId,
              accessToken
            }
          }
        };
        
        // Track download progress
        if (onDownloadProgress) {
          onDownloadProgress(10); // Starting download
        }
        
        const response = await fetch(`/api/trpc/facebook.downloadReportCSV?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[CSV Download] Server error:', errorText);
          
          // Check if it's a 503 and we have retries left
          if (response.status === 503 && attempt < maxRetries) {
            const delay = retryDelays[attempt];
            console.log(`[CSV Download] 503 error, retrying in ${delay/1000}s (attempt ${attempt + 1}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; // Retry
          }
          
          throw new Error(`Failed to download report via proxy. Status: ${response.status}`);
        }
      
      if (onDownloadProgress) {
        onDownloadProgress(50); // Download complete, parsing...
      }
      
      const result = await response.json();
      // tRPC batch response format: array with result at index 0
      const csvText = result[0].result.data.csvData;
      
      if (onDownloadProgress) {
        onDownloadProgress(70); // Received data, parsing CSV...
      }

      // Parse CSV using PapaParse
      return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          download: false, // Explicitly tell Papa we're parsing a string, not downloading
          complete: (results) => {
            if (results.errors && results.errors.length > 0) {
              console.warn("CSV Parsing Warnings:", results.errors);
            }
            
            // Map raw CSV rows to our data structure
            console.log('[CSV Parse] Raw CSV rows:', results.data.length);
            console.log('[CSV Parse] First raw row:', results.data[0]);
            const mappedData = results.data.map(mapCsvRowToProductInsightData);
            console.log('[CSV Parse] Mapped data:', mappedData.length, 'records');
            console.log('[CSV Parse] First mapped record:', mappedData[0]);
            
            if (onDownloadProgress) {
              onDownloadProgress(90); // Mapping complete
            }
            
            // Filter out rows with no product name/id if necessary (cleanup)
            const validData = mappedData.filter(item => item.product_retailer_id !== 'N/A' && item.product_name !== 'N/A');
            console.log('[CSV Parse] Valid data after filtering:', validData.length, 'records');

            if (onProgress) {
              onProgress(validData);
            }
            
            if (onDownloadProgress) {
              onDownloadProgress(100); // Complete
            }
            
            resolve({ data: validData });
          },
          error: (error: any) => {
            reject(new Error(`CSV Parsing Error: ${error.message}`));
          }
        });
      });
    } catch (error) {
        console.error("Error downloading/parsing report CSV:", error);
        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          throw error;
        }
        // Otherwise, continue to next retry
      }
    }
    
    // Should never reach here, but TypeScript needs a return
    throw new Error('Failed to download CSV after all retries');
  }
};
