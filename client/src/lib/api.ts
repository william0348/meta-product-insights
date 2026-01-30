import { AsyncJobStatus, ProductInsightData, ReportRunResponse, ReportRunStatus } from '../types';

const GRAPH_API_VERSION = 'v22.0';

// Helper to map JSON item from Graph API to ProductInsightData
const mapJsonToProductInsightData = (item: any): ProductInsightData => {
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

  const id = item.product_retailer_id || item.product_content_id || item.product_group_content_id || 'N/A';
  const name = item.product_name || id;

  // Extract action values safely
  const getActionValue = (actions: any[], actionType: string) => {
    if (!actions || !Array.isArray(actions)) return 0;
    const action = actions.find((a: any) => a.action_type === actionType);
    return action ? pFloat(action.value) : 0;
  };

  // CORRECTED MAPPING:
  // Ad Purchases (Omni) -> actions:omni_purchase
  // Catalog Purchases -> converted_product_omni_purchase
  
  const adPurchases = getActionValue(item.actions, 'omni_purchase');
  const catalogPurchases = pInt(item.converted_product_omni_purchase);

  return {
    product_name: name,
    product_retailer_id: id,
    product_brand: item.product_brand,
    product_category: item.product_category,
    
    impressions: pInt(item.impressions),
    spend: pFloat(item.spend),
    clicks: 0, // Removed as requested
    link_clicks: pInt(item.inline_link_clicks),
    outbound_clicks: 0, // Removed as requested
    
    cpm: pFloat(item.cpm),
    ctr: pFloat(item.ctr),
    inline_link_click_ctr: pFloat(item.inline_link_click_ctr),
    outbound_ctr: 0, // Removed as requested
    cpc: pFloat(item.cpc),
    cost_per_inline_link_click: pFloat(item.cost_per_inline_link_click),
    cost_per_outbound_click: 0, // Removed as requested
    
    // CVR calculated later
    cvr: 0, 

    // Purchase Metrics
    purchases: adPurchases, // Mapped to Ad Purchases (Omni)
    purchase_value: getActionValue(item.action_values, 'omni_purchase'),
    avg_purchase_value: 0, // Derived if needed
    
    website_purchases: 0, // Removed as requested
    mobile_app_purchases: 0, // Removed as requested
    offline_purchases: 0, // Removed as requested
    onsite_purchases: 0, // Removed as requested
    
    purchase_roas: pFloat(item.purchase_roas),
    website_roas: pFloat(item.website_purchase_roas),
    mobile_app_roas: pFloat(item.mobile_app_purchase_roas),
    
    // Add to Cart Metrics - Removed as requested
    adds_to_cart: 0, 
    website_adds_to_cart: 0,
    mobile_app_adds_to_cart: 0,

    // Catalog & Product Set Metrics
    catalog_purchases: catalogPurchases, // Mapped to Catalog Purchases
    // CORRECTED: converted_product_omni_purchase_value -> converted_product_omni_purchase_values
    catalog_purchase_value: pFloat(item.converted_product_omni_purchase_values),
    
    product_set_purchases: pInt(item.converted_promoted_product_omni_purchase),
    // CORRECTED: converted_promoted_product_omni_purchase_value -> converted_promoted_product_omni_purchase_values
    product_set_purchase_value: pFloat(item.converted_promoted_product_omni_purchase_values),
    
    product_views: pInt(item.product_views),
    
    date_start: item.date_start,
    date_stop: item.date_stop
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
      // CORRECTED: Plural 'values'
      'converted_product_omni_purchase_values',
      
      // Product Set / Promoted Product Purchases
      'converted_promoted_product_omni_purchase',
      // CORRECTED: Plural 'values'
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

  getReportResults: async (
    reportRunId: string, 
    accessToken?: string, 
    onProgress?: (data: ProductInsightData[]) => void
  ): Promise<{ data: ProductInsightData[] }> => {
    if (!accessToken) {
      throw new Error("Access Token is required.");
    }

    let allData: ProductInsightData[] = [];
    // Only fetch the first page (limit=100) and stop
    const nextUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${reportRunId}/insights?access_token=${accessToken}&limit=100`;

    try {
      const response = await fetch(nextUrl);
      const json = await response.json();

      if (json.error) {
        throw new Error(json.error.message || "Failed to fetch report results");
      }

      const pageData = json.data.map(mapJsonToProductInsightData);
      
      // Calculate derived fields
      const processedPageData = pageData.map((item: ProductInsightData) => {
        if (item.cvr === 0 && item.link_clicks > 0) {
          item.cvr = (item.purchases / item.link_clicks) * 100;
        }
        return item;
      });

      allData = processedPageData;

      // Notify UI immediately with data
      if (onProgress) {
        onProgress(allData);
      }
      
      // We intentionally do NOT fetch next pages (paging.next) as per user request to limit to first 100 rows.

    } catch (error) {
      console.error("Error fetching report results:", error);
      throw error;
    }

    return { data: allData };
  }
};
