import { AsyncJobStatus, ProductInsightData, ReportRunResponse, ReportRunStatus } from '../types';
import Papa from 'papaparse';

const GRAPH_API_VERSION = 'v22.0';

// Helper to map a raw CSV item to ProductInsightData
// Note: CSV keys will match the export_columns we requested, but flat
const mapCsvToProductInsightData = (item: any): ProductInsightData => {
  // Helper to safely parse numbers
  const pFloat = (val: any) => {
    if (!val) return 0;
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  };
  
  const pInt = (val: any) => {
    if (!val) return 0;
    const num = parseInt(val, 10);
    return isNaN(num) ? 0 : num;
  };

  const id = item['Product Retailer ID'] || item['Product Content ID'] || item['Product Group Content ID'] || 'N/A';
  const name = item['Product Name'] || id;

  // Basic fields
  const spend = pFloat(item['Amount Spent (USD)']); // CSV headers are human readable usually, but API returns machine names if not formatted. 
  // Wait, the API returns columns as requested in fields. Let's assume machine names first, but check for human readable fallback if needed.
  // Actually, for export_format=csv, Meta returns headers based on the field names usually, but let's be robust.
  
  // Re-mapping strategy: The CSV headers from Meta usually match the "Title" of the column if viewed in Ads Manager, 
  // OR the field name if requested via API.
  // Let's assume field names because we are requesting specific fields.
  
  // However, `export_columns` parameter might affect this.
  // Let's look at the keys from a sample response or just map flexibly.
  
  // Actually, standard graph API CSV export uses keys like "reporting_starts", "reporting_ends", "ad_name", etc.
  // But since we use `export_columns`, the order is guaranteed but headers might be friendly names.
  
  // Let's try to map by checking both potential keys.
  const get = (keys: string[]) => {
    for (const k of keys) {
      if (item[k] !== undefined) return item[k];
    }
    return undefined;
  };

  const getNum = (keys: string[]) => pFloat(get(keys));

  return {
    product_name: get(['product_name', 'Product Name']) || name,
    product_retailer_id: get(['product_retailer_id', 'Product Retailer ID']) || id,
    product_brand: get(['product_brand', 'Product Brand']),
    product_category: get(['product_category', 'Product Category']),
    
    impressions: getNum(['impressions', 'Impressions']),
    spend: getNum(['spend', 'Amount Spent (USD)', 'Amount Spent']),
    clicks: getNum(['clicks', 'Clicks (All)']),
    link_clicks: getNum(['inline_link_clicks', 'Link Clicks']),
    outbound_clicks: getNum(['outbound_clicks', 'Outbound Clicks']),
    
    cpm: getNum(['cpm', 'CPM (Cost per 1,000 Impressions)']),
    ctr: getNum(['ctr', 'CTR (All)']),
    inline_link_click_ctr: getNum(['inline_link_click_ctr', 'CTR (Link Click-Through Rate)']),
    outbound_ctr: getNum(['outbound_clicks_ctr', 'CTR (Outbound)']),
    cpc: getNum(['cpc', 'CPC (All)']),
    cost_per_inline_link_click: getNum(['cost_per_inline_link_click', 'Cost per Link Click']),
    cost_per_outbound_click: getNum(['cost_per_outbound_click', 'Cost per Outbound Click']),
    
    // CVR is calculated manually
    cvr: 0, // Will calc below

    purchases: getNum(['actions:omni_purchase', 'Purchases']),
    purchase_value: getNum(['action_values:omni_purchase', 'Purchases Conversion Value']),
    avg_purchase_value: getNum(['average_purchases_conversion_value', 'Average Purchase Value']),
    
    website_purchases: getNum(['actions:offsite_conversion.fb_pixel_purchase', 'Website Purchases']),
    mobile_app_purchases: getNum(['actions:app_custom_event.fb_mobile_purchase', 'Mobile App Purchases']),
    offline_purchases: getNum(['actions:offline_conversion.purchase', 'Offline Purchases']),
    onsite_purchases: getNum(['actions:onsite_conversion.purchase', 'On-Meta Purchases']),
    
    purchase_roas: getNum(['purchase_roas:omni_purchase', 'Purchase ROAS (Return on Ad Spend)']),
    website_roas: getNum(['website_purchase_roas:offsite_conversion.fb_pixel_purchase', 'Website Purchase ROAS']),
    mobile_app_roas: getNum(['mobile_app_purchase_roas:app_custom_event.fb_mobile_purchase', 'Mobile App Purchase ROAS']),
    
    adds_to_cart: getNum(['actions:omni_add_to_cart', 'Adds to Cart']),
    website_adds_to_cart: getNum(['actions:offsite_conversion.fb_pixel_add_to_cart', 'Website Adds to Cart']),
    mobile_app_adds_to_cart: getNum(['actions:app_custom_event.fb_mobile_add_to_cart', 'Mobile App Adds to Cart']),

    catalog_purchases: getNum(['converted_product_omni_purchase', 'Catalog Purchases']),
    catalog_purchase_value: getNum(['converted_product_omni_purchase_value', 'Catalog Purchase Value']),
    
    product_set_purchases: getNum(['converted_promoted_product_omni_purchase', 'Product Set Purchases']),
    product_set_purchase_value: getNum(['converted_promoted_product_omni_purchase_value', 'Product Set Purchase Value']),
    
    product_views: getNum(['product_views', 'Content Views']),
    
    date_start: get(['date_start', 'Reporting Starts']),
    date_stop: get(['date_stop', 'Reporting Ends'])
  };
};

export const facebookApiService = {
  createReportRun: async (accountId: string, startDate: string, endDate: string, accessToken?: string, level: string = 'account', breakdown: string = 'product_id'): Promise<ReportRunResponse> => {
    
    if (!accessToken) {
      throw new Error("Access Token is required to fetch real data from Meta Marketing API.");
    }

    // Ensure accountId has act_ prefix
    const formattedAccountId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

    // Use full field list for rich data export
    const fieldList = [
      'product_views',
      'converted_product_app_custom_event_fb_mobile_purchase_value',
      'converted_product_website_pixel_purchase_value',
      'converted_product_offline_purchase_value',
      'converted_product_omni_purchase',
      'converted_product_website_pixel_purchase',
      'converted_product_app_custom_event_fb_mobile_purchase',
      'converted_product_offline_purchase',
      
      'converted_promoted_product_app_custom_event_fb_mobile_purchase_value',
      'converted_promoted_product_website_pixel_purchase_value',
      'converted_promoted_product_offline_purchase_value',
      'converted_promoted_product_omni_purchase',
      'converted_promoted_product_app_custom_event_fb_mobile_purchase',
      'converted_promoted_product_website_pixel_purchase',
      'converted_promoted_product_offline_purchase',
      
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
      'impressions',
      'spend',
      'clicks',
      'inline_link_clicks',
      'outbound_clicks',
      'ctr',
      'inline_link_click_ctr',
      'cpm',
      'cpc',
      'cost_per_inline_link_click',
      'outbound_clicks_ctr',
      'cost_per_outbound_click',
      'purchase_roas',
      'website_purchase_roas',
      'mobile_app_purchase_roas',
      'results',
      'cost_per_result',
      'average_purchases_conversion_value',
      'actions',
      'action_values',
      'total_card_view',
      'product_retailer_id'
    ];
    
    const fields = fieldList.join(',');
    const sort = 'impressions_descending'; 
    
    const queryParams: Record<string, string> = {
      access_token: accessToken,
      time_range: JSON.stringify({ since: startDate, until: endDate }),
      breakdowns: breakdown,
      fields: fields,
      is_async: 'true',
      export_format: 'csv'
    };

    if (sort) queryParams.sort = sort;
    if (level && level !== 'account') queryParams.level = level;

    const params = new URLSearchParams(queryParams);
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${formattedAccountId}/insights?${params.toString()}`, { method: 'POST' });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || "Failed to create report run");
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

  getReportResults: async (
    reportRunId: string, 
    accessToken?: string, 
    onProgress?: (data: ProductInsightData[]) => void
  ): Promise<{ data: ProductInsightData[] }> => {
    if (!accessToken) {
      throw new Error("Access Token is required.");
    }

    // New Strategy: Fetch CSV from lookaside url
    const downloadUrl = `https://lookaside.facebook.com/ads/ads_insights/download_report/business/?report_run_id=${reportRunId}&access_token=${accessToken}`;
    
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to download report: ${response.statusText} - ${errText}`);
    }

    const csvText = await response.text();

    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors && results.errors.length > 0) {
            console.warn("CSV Parse Errors:", results.errors);
          }

          const mappedData = results.data.map(mapCsvToProductInsightData);
          
          // Post-calculation for fields that might be missing or need derived values
          const finalData = mappedData.map(item => {
            // Calculate CVR if missing
            if (item.cvr === 0 && item.link_clicks > 0) {
              item.cvr = (item.purchases / item.link_clicks) * 100;
            }
            return item;
          });

          if (onProgress) onProgress(finalData);
          resolve({ data: finalData });
        },
        error: (error: any) => {
          reject(new Error(`CSV Parsing failed: ${error.message}`));
        }
      });
    });
  }
};
