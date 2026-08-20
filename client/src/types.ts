export enum AsyncJobStatus {
  NOT_STARTED = 'Job Not Started',
  STARTED = 'Job Started',
  RUNNING = 'Job Running',
  COMPLETED = 'Job Completed',
  FAILED = 'Job Failed',
  SKIPPED = 'Job Skipped'
}

export interface ReportRunResponse {
  report_run_id: string;
}

export interface ReportRunStatus {
  id: string;
  account_id: string;
  time_ref: number;
  async_status: AsyncJobStatus;
  async_percent_completion: number;
  date_start: string;
  date_stop: string;
}

export interface ProductInsightData {
  // Identification
  product_name: string;
  product_retailer_id: string;
  product_content_id?: string;
  product_group_content_id?: string;
  product_brand?: string;
  product_category?: string;
  
  // Custom Labels
  custom_label_0?: string;
  custom_label_1?: string;
  custom_label_2?: string;
  custom_label_3?: string;
  custom_label_4?: string;

  // Basic Metrics
  impressions: number;
  spend: number;
  clicks: number;
  link_clicks: number;
  outbound_clicks: number;
  
  // Rates & Costs
  cpm: number;
  ctr: number;
  inline_link_click_ctr: number;
  outbound_ctr: number;
  cpc: number;
  cost_per_inline_link_click: number;
  cost_per_outbound_click: number;
  cvr: number; // Calculated: Purchases / Link Clicks

  // Conversions (Purchases)
  purchases: number;
  purchase_value: number;
  avg_purchase_value: number;
  
  website_purchases: number;
  mobile_app_purchases: number;
  offline_purchases: number;
  onsite_purchases: number;

  // ROAS
  purchase_roas: number;
  website_roas: number;
  mobile_app_roas: number;

  // Other Actions
  results?: number;
  cost_per_result?: number;
  adds_to_cart: number;
  website_adds_to_cart: number;
  mobile_app_adds_to_cart: number;

  // Catalog Specific
  catalog_purchases?: number;
  catalog_purchase_value?: number;
  product_set_purchases?: number;
  product_set_purchase_value?: number;

  // Views
  product_views: number;
  total_card_view?: number;

  // Time
  date_start: string;
  date_stop: string;
  
  // Index signature to allow dynamic property access for filtering
  [key: string]: any;
}

export interface ReportConfig {
  accessToken: string;
  accountId: string;
  dateStart: string;
  dateEnd: string;
  level: string;
  breakdown: string;
  minSpend?: string; // Minimum spend filter
  minCTR?: string; // Minimum CTR filter
  maxSpend?: string; // Maximum spend filter (spend less than)
  maxCVR?: string; // Maximum CVR filter (CVR less than)
  minCVR?: string; // Minimum CVR filter (CVR greater than or equal to)
  minROAS?: string; // Minimum estimated ROAS filter (sale_price x purchases / spend)
  apiFilters?: Array<{field: string, operator: string, value: any}>; // Filters applied at API level before CSV generation
}

export interface FilterCondition {
  id: string;
  field: string;
  operator: '>' | '<' | '>=' | '<=' | '=';
  value: number;
}
