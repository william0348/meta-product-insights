import axios from 'axios';

const FB_API_VERSION = 'v24.0';
const BASE_URL = `https://graph.facebook.com/${FB_API_VERSION}`;

export interface FBProduct {
  id: string;
  retailer_id: string;
  name: string;
  custom_label_4?: string;
  tags?: string[];
  custom_number_0?: number;
  custom_number_1?: number;
  custom_number_2?: number;
  custom_number_3?: number;
  custom_number_4?: number;
}

export interface BatchRequestItem {
  method: 'UPDATE' | 'DELETE' | 'CREATE';
  retailer_id: string;
  data: Record<string, any>;
}

export interface BatchResponse {
  handles: string[];
  validation_status?: Array<{
    retailer_id: string;
    errors?: Array<{ message: string; [key: string]: any }>;
    warnings?: Array<{ message: string; [key: string]: any }>;
  }>;
}

/**
 * Fetches specific products by their retailer IDs from the catalog
 * Used to get existing data before merging
 */
export const fetchProductsByRetailerIds = async (
  catalogId: string,
  retailerIds: string[],
  accessToken: string
): Promise<FBProduct[]> => {
  if (retailerIds.length === 0) return [];

  const filter = {
    retailer_id: {
      is_any: retailerIds,
    },
  };

  const encodedFilter = encodeURIComponent(JSON.stringify(filter));
  const fields =
    'id,retailer_id,name,custom_label_4,tags,custom_number_0,custom_number_1,custom_number_2,custom_number_3,custom_number_4';

  const response = await axios.get(
    `${BASE_URL}/${catalogId}/products?filter=${encodedFilter}&fields=${fields}&access_token=${accessToken}&limit=${retailerIds.length}`
  );

  return response.data.data || [];
};

/**
 * Sends a batch update request to the Facebook Catalog
 */
export const batchUpdateProducts = async (
  catalogId: string,
  requests: BatchRequestItem[],
  accessToken: string
): Promise<BatchResponse> => {
  const response = await axios.post(
    `${BASE_URL}/${catalogId}/batch`,
    { requests },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  return response.data;
};
