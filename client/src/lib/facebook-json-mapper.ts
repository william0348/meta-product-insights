import type { ProductInsightData } from '../types';

/**
 * Map Facebook Insights API JSON response to ProductInsightData
 * The JSON format from /insights endpoint has a different structure than CSV
 */
export const mapJsonRowToProductInsightData = (row: any): ProductInsightData => {
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

  // Helper to extract action values from the actions array
  const getActionValue = (actions: any[], actionType: string): number => {
    if (!actions || !Array.isArray(actions)) return 0;
    const action = actions.find((a: any) => a.action_type === actionType);
    return action ? pInt(action.value) : 0;
  };

  // Helper to extract action values from the action_values array (for monetary values)
  const getActionValueAmount = (actionValues: any[], actionType: string): number => {
    if (!actionValues || !Array.isArray(actionValues)) return 0;
    const actionValue = actionValues.find((a: any) => a.action_type === actionType);
    return actionValue ? pFloat(actionValue.value) : 0;
  };

  // Extract product info from Facebook API response
  // The API returns: product_name, product_content_id, product_retailer_id, product_brand, product_category
  const productName = row.product_name || 'N/A';
  const productContentId = row.product_content_id || row.product_retailer_id || 'N/A';
  const productRetailerId = row.product_retailer_id || row.product_content_id || 'N/A';
  const productBrand = row.product_brand || undefined;
  const productCategory = row.product_category || undefined;
  
  // Extract metrics
  const impressions = pInt(row.impressions);
  const spend = pFloat(row.spend);
  const linkClicks = getActionValue(row.actions, 'link_click');
  
  // Calculate CTR
  const inlineLinkClickCtr = impressions > 0 ? (linkClicks / impressions) * 100 : 0;
  
  // Extract purchase metrics from actions
  const omniPurchases = getActionValue(row.actions, 'omni_purchase');
  const catalogPurchases = getActionValue(row.actions, 'omni_purchase'); // Same as omni_purchase
  const addsToCart = getActionValue(row.actions, 'omni_add_to_cart');
  const productViews = getActionValue(row.actions, 'omni_view_content');
  
  // Extract purchase values
  const purchaseValue = getActionValueAmount(row.action_values, 'omni_purchase');
  
  // Calculate CVR
  const cvr = linkClicks > 0 ? (catalogPurchases / linkClicks) * 100 : 0;
  
  // Calculate CPM
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  
  // Calculate Cost per Link Click
  const costPerLinkClick = linkClicks > 0 ? spend / linkClicks : 0;
  
  // Calculate ROAS
  const purchaseRoas = spend > 0 ? purchaseValue / spend : 0;

  return {
    product_name: productName,
    product_retailer_id: productRetailerId,
    product_brand: productBrand,
    product_category: productCategory,
    
    impressions,
    spend,
    clicks: 0,
    link_clicks: linkClicks,
    outbound_clicks: 0,
    
    cpm,
    ctr: 0,
    inline_link_click_ctr: inlineLinkClickCtr,
    outbound_ctr: 0,
    cpc: 0,
    cost_per_inline_link_click: costPerLinkClick,
    cost_per_outbound_click: 0,
    
    cvr,

    // Purchase Metrics
    purchases: omniPurchases,
    purchase_value: purchaseValue,
    avg_purchase_value: omniPurchases > 0 ? purchaseValue / omniPurchases : 0,
    
    website_purchases: 0,
    mobile_app_purchases: 0,
    offline_purchases: 0,
    onsite_purchases: 0,
    
    purchase_roas: purchaseRoas,
    website_roas: 0,
    mobile_app_roas: 0,
    
    adds_to_cart: addsToCart,
    website_adds_to_cart: 0,
    mobile_app_adds_to_cart: 0,

    // Catalog & Product Set Metrics
    catalog_purchases: catalogPurchases,
    catalog_purchase_value: purchaseValue,
    
    product_set_purchases: 0,
    product_set_purchase_value: 0,
    
    product_views: productViews,
    
    date_start: row.date_start || '',
    date_stop: row.date_stop || ''
  };
};
