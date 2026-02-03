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
 * Includes retry logic with exponential backoff for network failures
 */
export const fetchProductsByRetailerIds = async (
  catalogId: string,
  retailerIds: string[],
  accessToken: string,
  maxRetries: number = 3
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

  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.get(
        `${BASE_URL}/${catalogId}/products?filter=${encodedFilter}&fields=${fields}&access_token=${accessToken}&limit=${retailerIds.length}`,
        {
          timeout: 30000, // 30 second timeout
        }
      );

      return response.data.data || [];
    } catch (error: any) {
      lastError = error;
      const isNetworkError = error.code === 'ECONNRESET' || 
                            error.code === 'ETIMEDOUT' ||
                            error.message?.includes('socket hang up') ||
                            error.message?.includes('network');
      
      if (isNetworkError && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.log(`[Catalog Fetch] Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
};

/**
 * Checks the status of a batch request using the handle returned from items_batch
 */
export const checkBatchRequestStatus = async (
  catalogId: string,
  handle: string,
  accessToken: string,
  loadInvalidIds: boolean = false
): Promise<any> => {
  const response = await axios.get(
    `${BASE_URL}/${catalogId}/check_batch_request_status`,
    {
      params: {
        handle,
        load_ids_of_invalid_requests: loadInvalidIds,
        access_token: accessToken,
      },
    }
  );

  return response.data;
};

/**
 * Sends a batch update request to the Facebook Catalog
 * Sets allow_upsert to false to only update existing products
 * Uses form data format as per Facebook API documentation
 */
export const batchUpdateProducts = async (
  catalogId: string,
  requests: BatchRequestItem[],
  accessToken: string
): Promise<BatchResponse> => {
  // Facebook Catalog Batch API requires form data format
  const formData = new URLSearchParams();
  formData.append('access_token', accessToken);
  formData.append('requests', JSON.stringify(requests));
  formData.append('item_type', 'PRODUCT_ITEM');
  formData.append('allow_upsert', 'false'); // Only update existing products

  const response = await axios.post(
    `${BASE_URL}/${catalogId}/items_batch`,
    formData.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  return response.data;
};
