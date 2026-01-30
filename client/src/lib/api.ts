import { AsyncJobStatus, ProductInsightData, ReportRunResponse, ReportRunStatus } from '../types';

const GRAPH_API_VERSION = 'v22.0';

// Helper to extract values from action lists
const getVal = (arr: any[], type: string) => {
  if (!Array.isArray(arr)) return 0;
  const found = arr.find(x => x.action_type === type);
  return found ? parseFloat(found.value) : 0;
};

// Helper to map a raw API item to ProductInsightData
const mapToProductInsightData = (item: any): ProductInsightData => {
  const id = item.product_retailer_id || item.product_content_id || item.product_group_content_id || item.product_id || 'N/A';
  const name = item.product_name || id;

  // Basic fields with defaults
  const spend = parseFloat(item.spend || 0);
  const impressions = parseInt(item.impressions || 0);
  
  // Clicks
  const clicks = parseInt(item.clicks || 0); 
  const linkClicks = item.inline_link_clicks ? parseInt(item.inline_link_clicks) : (clicks || getVal(item.actions, 'link_click'));
  const outboundClicks = item.outbound_clicks ? parseInt(item.outbound_clicks) : 0;

  // Ad Purchases (Omni and variants)
  const purchases = getVal(item.actions, 'purchase') || getVal(item.actions, 'omni_purchase');
  const purchaseValue = getVal(item.action_values, 'omni_purchase');
  const websitePurchases = getVal(item.actions, 'offsite_conversion.fb_pixel_purchase');
  const mobilePurchases = getVal(item.actions, 'app_custom_event.fb_mobile_purchase');
  const offlinePurchases = getVal(item.actions, 'offline_conversion.purchase');
  const onsitePurchases = getVal(item.actions, 'onsite_conversion.purchase');

  // ROAS
  let roas = 0;
  if (item.purchase_roas) {
      roas = getVal(item.purchase_roas, 'omni_purchase');
  } else if (spend > 0 && purchaseValue > 0) {
      roas = purchaseValue / spend;
  }
  
  const websiteRoas = item.website_purchase_roas ? getVal(item.website_purchase_roas, 'offsite_conversion.fb_pixel_purchase') : 0;
  const appRoas = item.mobile_app_purchase_roas ? getVal(item.mobile_app_purchase_roas, 'app_custom_event.fb_mobile_purchase') : 0;

  // Adds to Cart
  const addsToCart = getVal(item.actions, 'omni_add_to_cart');
  const websiteAddToCart = getVal(item.actions, 'offsite_conversion.fb_pixel_add_to_cart');
  const mobileAddToCart = getVal(item.actions, 'app_custom_event.fb_mobile_add_to_cart');

  // Catalog (Converted Product)
  const catalogPurchases = item.converted_product_omni_purchase ? (getVal(item.converted_product_omni_purchase, 'omni_purchase') || parseFloat(item.converted_product_omni_purchase)) : undefined;
  const catalogValue = item.converted_product_omni_purchase_value ? (getVal(item.converted_product_omni_purchase_value, 'omni_purchase') || parseFloat(item.converted_product_omni_purchase_value)) : undefined;
  
  // Product Set (Converted Promoted Product)
  const productSetPurchases = item.converted_promoted_product_omni_purchase ? (getVal(item.converted_promoted_product_omni_purchase, 'omni_purchase') || parseFloat(item.converted_promoted_product_omni_purchase)) : undefined;
  const productSetValue = item.converted_promoted_product_omni_purchase_value ? (getVal(item.converted_promoted_product_omni_purchase_value, 'omni_purchase') || parseFloat(item.converted_promoted_product_omni_purchase_value)) : undefined;

  // Calculate CVR: Purchases / Link Clicks
  const cvr = linkClicks > 0 ? (purchases / linkClicks) * 100 : 0;

  return {
    product_name: name,
    product_retailer_id: id,
    product_content_id: item.product_content_id,
    product_group_content_id: item.product_group_content_id,
    product_brand: item.product_brand,
    product_category: item.product_category,
    custom_label_0: item.product_custom_label_0,
    custom_label_1: item.product_custom_label_1,
    custom_label_2: item.product_custom_label_2,
    custom_label_3: item.product_custom_label_3,
    custom_label_4: item.product_custom_label_4,
    
    impressions,
    spend,
    clicks,
    link_clicks: linkClicks,
    outbound_clicks: outboundClicks,
    
    cpm: item.cpm ? parseFloat(item.cpm) : 0,
    ctr: item.ctr ? parseFloat(item.ctr) : 0,
    inline_link_click_ctr: item.inline_link_click_ctr ? parseFloat(item.inline_link_click_ctr) : 0,
    outbound_ctr: item.outbound_clicks_ctr ? parseFloat(item.outbound_clicks_ctr) : 0,
    cpc: item.cpc ? parseFloat(item.cpc) : 0,
    cost_per_inline_link_click: item.cost_per_inline_link_click ? parseFloat(item.cost_per_inline_link_click) : 0,
    cost_per_outbound_click: item.cost_per_outbound_click ? parseFloat(item.cost_per_outbound_click) : 0,
    
    cvr,

    purchases,
    purchase_value: purchaseValue,
    avg_purchase_value: item.average_purchases_conversion_value ? parseFloat(item.average_purchases_conversion_value) : 0,
    website_purchases: websitePurchases,
    mobile_app_purchases: mobilePurchases,
    offline_purchases: offlinePurchases,
    onsite_purchases: onsitePurchases,
    
    purchase_roas: roas,
    website_roas: websiteRoas,
    mobile_app_roas: appRoas,
    
    results: item.results ? parseFloat(item.results) : undefined,
    cost_per_result: item.cost_per_result ? parseFloat(item.cost_per_result) : undefined,
    
    adds_to_cart: addsToCart,
    website_adds_to_cart: websiteAddToCart,
    mobile_app_adds_to_cart: mobileAddToCart,

    catalog_purchases: catalogPurchases,
    catalog_purchase_value: catalogValue,
    
    product_set_purchases: productSetPurchases,
    product_set_purchase_value: productSetValue,
    
    product_views: item.product_views ? parseFloat(item.product_views) : getVal(item.actions, 'view_content'),
    total_card_view: item.total_card_view ? parseInt(item.total_card_view) : undefined,
    
    date_start: item.date_start,
    date_stop: item.date_stop
  };
};

export const facebookApiService = {
  createReportRun: async (accountId: string, startDate: string, endDate: string, accessToken?: string, level: string = 'account', breakdown: string = 'product_id'): Promise<ReportRunResponse> => {
    
    if (!accessToken) {
      throw new Error("Access Token is required to fetch real data from Meta Marketing API.");
    }

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
    
    // Export Columns Configuration matches the fields requested
    const exportColumns = [
      "product_views",
      "converted_product_app_custom_event_fb_mobile_purchase_value",
      "converted_product_website_pixel_purchase_value",
      "converted_product_offline_purchase_value",
      "converted_product_omni_purchase",
      "converted_product_website_pixel_purchase_value", 
      "converted_product_app_custom_event_fb_mobile_purchase",
      "converted_product_offline_purchase",
      
      "converted_promoted_product_app_custom_event_fb_mobile_purchase_value",
      "converted_promoted_product_website_pixel_purchase_value",
      "converted_promoted_product_offline_purchase_value",
      "converted_promoted_product_omni_purchase",
      "converted_promoted_product_app_custom_event_fb_mobile_purchase",
      "converted_promoted_product_website_pixel_purchase",
      "converted_promoted_product_offline_purchase",
      
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
      "impressions",
      "spend",
      "clicks",
      "inline_link_clicks",
      "outbound_clicks",
      "ctr",
      "inline_link_click_ctr",
      "cpm",
      "cpc",
      "cost_per_inline_link_click",
      "outbound_clicks_ctr",
      "cost_per_outbound_click",
      "purchase_roas:omni_purchase",
      "website_purchase_roas:offsite_conversion.fb_pixel_purchase",
      "mobile_app_purchase_roas:app_custom_event.fb_mobile_purchase",
      "results",
      "cost_per_result",
      "average_purchases_conversion_value",
      "actions:omni_add_to_cart",
      "actions:app_custom_event.fb_mobile_add_to_cart",
      "actions:offsite_conversion.fb_pixel_add_to_cart",
      "actions:offline_conversion.add_to_cart",
      "actions:onsite_conversion.add_to_cart",
      "actions:omni_purchase",
      "actions:app_custom_event.fb_mobile_purchase",
      "actions:offsite_conversion.fb_pixel_purchase",
      "actions:offline_conversion.purchase",
      "actions:onsite_conversion.purchase"
    ];

    const queryParams: Record<string, string> = {
      access_token: accessToken,
      time_range: JSON.stringify({ since: startDate, until: endDate }),
      breakdowns: breakdown,
      fields: fields,
      is_async: 'true',
      export_format: 'csv'
    };

    if (sort) queryParams.sort = sort;
    if (exportColumns.length > 0) queryParams.export_columns = JSON.stringify(exportColumns);
    if (level && level !== 'account') queryParams.level = level;

    const params = new URLSearchParams(queryParams);
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${accountId}/insights?${params.toString()}`, { method: 'POST' });

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

    // Initialize variables for pagination
    let allMappedData: ProductInsightData[] = [];
    // Start with limit=500, but subsequent paging links provided by API will determine the batch size
    let nextUrl: string | null = `https://graph.facebook.com/${GRAPH_API_VERSION}/${reportRunId}/insights?access_token=${accessToken}&limit=500`;

    // Loop until nextUrl is null
    while (nextUrl) {
      const response: Response = await fetch(nextUrl);
      const json: any = await response.json();

      if (json.error) {
        throw new Error(json.error.message || "Failed to fetch report results");
      }

      if (json.data && Array.isArray(json.data)) {
        // Map this chunk of data
        const mappedChunk = json.data.map(mapToProductInsightData);
        
        // Append to full list
        allMappedData = [...allMappedData, ...mappedChunk];
        
        // Notify progress if callback is provided
        if (onProgress) {
          onProgress(allMappedData);
        }
      }

      // Check for pagination
      nextUrl = json.paging && json.paging.next ? json.paging.next : null;
    }

    return { data: allMappedData };
  }
};
