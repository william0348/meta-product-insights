import type { ProductInsightData, ReportRunResponse } from '../types';
import { mapJsonRowToProductInsightData } from './facebook-json-mapper';
import { apiClient } from './api-client';

const GRAPH_API_VERSION = 'v25.0';

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

  const id = getVal(['Content ID', 'Product Item ID', 'product_retailer_id', 'product_content_id']) || 'N/A';
  const name = getVal(['Product Name', 'product_name']) || id;

  // Extract action values from CSV columns if they exist as specific columns
  // Note: Meta CSV export flattens 'actions' into specific columns like "Purchases", "Website Purchases", etc.
  
  // Ad Purchases (Omni)
  const adPurchases = pInt(getVal(['Ad Purchases (Omni)', 'Purchases', 'Ad Purchases', 'actions:omni_purchase']));
  
  // Catalog Purchases
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
    spend: pFloat(getVal(['Spend', 'Amount Spent (USD)', 'Amount Spent', 'spend'])),
    clicks: 0, 
    link_clicks: linkClicks,
    outbound_clicks: 0,
    
    cpm: pFloat(getVal(['CPM (Cost per 1,000 Impressions)', 'CPM', 'cpm'])),
    ctr: pFloat(getVal(['CTR (All)', 'CTR', 'ctr'])), // Note: Check if CTR (Link Click-Through Rate) is available
    inline_link_click_ctr: pFloat(getVal(['Link Click CTR (%)', 'CTR (Link Click-Through Rate)', 'inline_link_click_ctr'])),
    outbound_ctr: 0,
    cpc: pFloat(getVal(['CPC (All)', 'CPC', 'cpc'])),
    cost_per_inline_link_click: pFloat(getVal(['Cost per Link Click', 'cost_per_inline_link_click'])),
    cost_per_outbound_click: 0,
    
    cvr: pFloat(getVal(['CVR (%)', 'cvr'])) || cvr,

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
    
    adds_to_cart: pInt(getVal(['Adds to Cart (Omni)', 'adds_to_cart'])),
    website_adds_to_cart: 0,
    mobile_app_adds_to_cart: 0,

    // Catalog & Product Set Metrics
    catalog_purchases: catalogPurchases,
    catalog_purchase_value: pFloat(getVal(['Catalog Purchase Value', 'converted_product_omni_purchase_values'])),
    
    product_set_purchases: pInt(getVal(['Product Set Purchases', 'converted_promoted_product_omni_purchase'])),
    product_set_purchase_value: pFloat(getVal(['Product Set Purchase Value', 'converted_promoted_product_omni_purchase_values'])),
    
    product_views: pInt(getVal(['Product Views', 'Content Views', 'product_views'])),
    
    date_start: getVal(['Reporting Starts', 'date_start']),
    date_stop: getVal(['Reporting Ends', 'date_stop'])
  };
};


export const facebookApiService = {
  createReportRun: async (accountId: string, startDate: string, endDate: string, accessToken?: string, level: string = 'account', breakdown: string = 'product_id'): Promise<ReportRunResponse> => {
    
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

    const params = new URLSearchParams(queryParams);
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${formattedAccountId}/insights`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      }
    );

    const data = await response.json();
    if (data.error) {
      console.error("Meta API Error:", JSON.stringify(data.error, null, 2));
      const errorMessage = data.error.error_user_msg || data.error.message || "Failed to create report run";
      throw new Error(`${errorMessage} (Code: ${data.error.code})`);
    }
    return { report_run_id: data.report_run_id };
  },

  pollReportStatus: async (reportRunId: string, accessToken?: string): Promise<any> => {
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

  // Fetch insights data as JSON via backend proxy
  async downloadReportCSV(
    reportRunId: string,
    accessToken?: string,
    onProgress?: (data: ProductInsightData[]) => void,
    onDownloadProgress?: (percent: number) => void,
    filters?: { minSpend?: string; minCTR?: string; maxSpend?: string; maxCVR?: string }
  ): Promise<{ data: ProductInsightData[] }> {
    try {
      const allData: ProductInsightData[] = [];
      let after: string | undefined = undefined;
      let pageCount = 0;
      
      if (onDownloadProgress) {
        onDownloadProgress(10); // Starting
      }
      
      // Fetch ALL pages server-side in one call (Python backend handles pagination)
      console.log('[Insights Fetch] Fetching all data server-side...');
      if (onDownloadProgress) onDownloadProgress(20);

      const result = await apiClient.facebook.fetchAll({
        reportRunId,
        accessToken: accessToken || '',
        ...filters,
      });

      console.log(`[Insights Fetch] Server returned ${result.totalRecords || result.data?.length || 0} records in ${result.totalPages || '?'} pages`);

      const insightsData = result.data || result;
      if (!Array.isArray(insightsData)) {
        throw new Error('Failed to fetch insights data from backend');
      }

      if (onDownloadProgress) onDownloadProgress(70);

      // Map all data at once
      const mapped = insightsData.map(mapJsonRowToProductInsightData);
      allData.push(...mapped);

      if (onProgress) onProgress(allData);
      if (onDownloadProgress) onDownloadProgress(90);
      
      console.log(`[Insights Fetch] Complete: ${allData.length} total records`);
      
      if (onDownloadProgress) {
        onDownloadProgress(100);
      }
      
      return { data: allData };
      
    } catch (error) {
      console.error("Error fetching insights data:", error);
      throw error;
    }
  }
};
