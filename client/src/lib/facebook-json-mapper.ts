import type { ProductInsightData } from '../types';

const pFloat = (val: any) => {
  if (!val || val === '-') return 0;
  const cleaned = String(val).replace(/[$,]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

const pInt = (val: any) => {
  if (!val || val === '-') return 0;
  const cleaned = String(val).replace(/[,]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
};

function get(row: any, ...keys: string[]): any {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

export const mapJsonRowToProductInsightData = (row: any): ProductInsightData => {
  // Detect if this is CSV format (has "Product Name") or JSON format (has "product_name")
  const isCSV = row['Product Name'] !== undefined || row['Impressions'] !== undefined;

  if (isCSV) {
    return mapCSVRow(row);
  }
  return mapJSONRow(row);
};

function mapCSVRow(row: any): ProductInsightData {
  const productName = get(row, 'Product Name') || 'N/A';
  const contentId = get(row, 'Content ID') || 'N/A';
  const impressions = pInt(get(row, 'Impressions'));
  const spend = pFloat(get(row, 'Product amount spent'));
  const linkClicks = pInt(get(row, 'Product link clicks', 'Link clicks'));
  const ctr = pFloat(get(row, 'CTR (link click-through rate)'));
  const cpm = pFloat(get(row, 'CPM (cost per 1,000 impressions)'));
  const costPerClick = pFloat(get(row, 'Product CPC (cost per product link click)'));
  const purchases = pInt(get(row, 'Product purchases', 'Meta purchases'));
  const purchaseValue = pFloat(get(row, 'Product purchases conversion value', 'Meta purchase conversion value'));
  const addsToCart = pInt(get(row, 'Product adds to cart', 'Meta adds to cart'));
  const catalogPurchases = pInt(get(row, 'Product attributed orders'));
  const productSetPurchases = pInt(get(row, 'Product set purchases'));
  const productViews = pInt(get(row, 'Product views'));
  const roas = pFloat(get(row, 'Product attributed orders ROAS'));

  const cvr = linkClicks > 0 ? (catalogPurchases / linkClicks) * 100 : 0;

  return {
    product_name: productName,
    product_retailer_id: contentId,
    product_brand: get(row, 'Brand') || undefined,
    product_category: get(row, 'Category') || undefined,
    impressions,
    spend,
    clicks: 0,
    link_clicks: linkClicks,
    outbound_clicks: 0,
    cpm,
    ctr: pFloat(get(row, 'CTR (all)')),
    inline_link_click_ctr: ctr,
    outbound_ctr: 0,
    cpc: pFloat(get(row, 'Product CPC (all)')),
    cost_per_inline_link_click: costPerClick,
    cost_per_outbound_click: 0,
    cvr,
    purchases,
    purchase_value: purchaseValue,
    avg_purchase_value: purchases > 0 ? purchaseValue / purchases : 0,
    website_purchases: pInt(get(row, 'Website product attributed orders')),
    mobile_app_purchases: pInt(get(row, 'In-app product attributed orders')),
    offline_purchases: pInt(get(row, 'Offline product attributed orders')),
    onsite_purchases: 0,
    purchase_roas: roas,
    website_roas: pFloat(get(row, 'Website product attributed orders ROAS')),
    mobile_app_roas: pFloat(get(row, 'In-app product attributed orders ROAS')),
    adds_to_cart: addsToCart,
    website_adds_to_cart: pInt(get(row, 'Website product adds to cart')),
    mobile_app_adds_to_cart: pInt(get(row, 'In-app product adds to cart')),
    catalog_purchases: catalogPurchases,
    catalog_purchase_value: pFloat(get(row, 'Product attributed orders conversion value')),
    product_set_purchases: productSetPurchases,
    product_set_purchase_value: pFloat(get(row, 'Product set purchases conversion value')),
    product_views: productViews,
    date_start: get(row, 'Reporting starts', '﻿"Reporting starts"') || '',
    date_stop: get(row, 'Reporting ends') || '',
  };
}

function mapJSONRow(row: any): ProductInsightData {
  const getActionValue = (actions: any[], actionType: string): number => {
    if (!actions || !Array.isArray(actions)) return 0;
    const action = actions.find((a: any) => a.action_type === actionType);
    return action ? pInt(action.value) : 0;
  };

  const getActionValueAmount = (actionValues: any[], actionType: string): number => {
    if (!actionValues || !Array.isArray(actionValues)) return 0;
    const actionValue = actionValues.find((a: any) => a.action_type === actionType);
    return actionValue ? pFloat(actionValue.value) : 0;
  };

  const productName = row.product_name || 'N/A';
  const productRetailerId = row.product_retailer_id || row.product_content_id || 'N/A';
  const impressions = pInt(row.impressions);
  const spend = pFloat(row.spend);
  const linkClicks = pInt(row.inline_link_clicks);
  const catalogPurchases = row.converted_product_omni_purchase && Array.isArray(row.converted_product_omni_purchase) && row.converted_product_omni_purchase[0]
    ? pInt(row.converted_product_omni_purchase[0].value)
    : 0;
  const omniPurchases = getActionValue(row.actions, 'omni_purchase');
  const addsToCart = getActionValue(row.actions, 'omni_add_to_cart');
  const productViews = getActionValue(row.actions, 'omni_view_content');
  const purchaseValue = getActionValueAmount(row.action_values, 'omni_purchase');
  const cvr = linkClicks > 0 ? (catalogPurchases / linkClicks) * 100 : 0;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const costPerLinkClick = linkClicks > 0 ? spend / linkClicks : 0;
  const purchaseRoas = spend > 0 ? purchaseValue / spend : 0;

  return {
    product_name: productName,
    product_retailer_id: productRetailerId,
    product_brand: row.product_brand || undefined,
    product_category: row.product_category || undefined,
    impressions,
    spend,
    clicks: 0,
    link_clicks: linkClicks,
    outbound_clicks: 0,
    cpm,
    ctr: 0,
    inline_link_click_ctr: pFloat(row.inline_link_click_ctr),
    outbound_ctr: 0,
    cpc: 0,
    cost_per_inline_link_click: costPerLinkClick,
    cost_per_outbound_click: 0,
    cvr,
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
    catalog_purchases: catalogPurchases,
    catalog_purchase_value: purchaseValue,
    product_set_purchases: 0,
    product_set_purchase_value: 0,
    product_views: productViews,
    date_start: row.date_start || '',
    date_stop: row.date_stop || '',
  };
}
