import axios from 'axios';

const FB_API_VERSION = 'v24.0';
const BASE_URL = `https://graph.facebook.com/${FB_API_VERSION}`;

// Maximum items per batch request (Facebook limit is 5000, recommended 3000 for optimal performance)
const MAX_BATCH_SIZE = 3000;

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

/**
 * Batch request item structure as per Facebook API documentation
 * Reference: https://developers.facebook.com/docs/marketing-api/reference/product-catalog/items_batch/
 */
export interface BatchRequestItem {
  method: 'UPDATE' | 'DELETE' | 'CREATE';
  data: {
    id: string;  // Required: retailer_id of the product
    [key: string]: any;  // Additional fields to update
  };
}

/**
 * Response from items_batch endpoint
 * Can be synchronous (immediate results) or asynchronous (handles for large batches)
 */
export interface BatchResponse {
  handles?: string[];  // Returned for async processing of large batches
  validation_status?: Array<{
    retailer_id: string;
    errors?: Array<{ message: string; [key: string]: any }>;
    warnings?: Array<{ message: string; [key: string]: any }>;
  }>;
}

/**
 * Response from check_batch_request_status endpoint
 */
export interface BatchStatusResponse {
  data: Array<{
    status?: string;  // e.g., "finished", "in_progress"
    errors_total_count?: number;
    errors?: Array<{ message: string; [key: string]: any }>;
    validation_status?: Array<{
      retailer_id: string;
      errors?: Array<{ message: string }>;
      warnings?: Array<{ message: string }>;
    }>;
    ids_of_invalid_requests?: string[];
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
 * Reference: https://developers.facebook.com/docs/marketing-api/reference/product-catalog/check_batch_request_status/
 * 
 * @param catalogId - The catalog ID
 * @param handle - The handle string from items_batch response
 * @param accessToken - Valid access token
 * @param loadInvalidIds - Whether to populate 'ids_of_invalid_requests' field (default: false)
 */
export const checkBatchRequestStatus = async (
  catalogId: string,
  handle: string,
  accessToken: string,
  loadInvalidIds: boolean = true
): Promise<BatchStatusResponse> => {
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
 * Reference: https://developers.facebook.com/docs/marketing-api/reference/product-catalog/items_batch/
 * 
 * Key parameters:
 * - requests: Array of batch request items (max 5000, recommended 3000)
 * - item_type: PRODUCT_ITEM for product catalog
 * - allow_upsert: false to only update existing products (prevents accidental creation)
 * 
 * Request format uses form data (-F) as per Facebook's curl example:
 * curl -X POST https://graph.facebook.com/{catalog-id}/items_batch \
 *   -F access_token=TOKEN \
 *   -F 'requests=[{"method":"UPDATE","data":{"id":"product_123",...}}]' \
 *   -F item_type=PRODUCT_ITEM
 * 
 * @param catalogId - The catalog ID
 * @param requests - Array of batch request items
 * @param accessToken - Valid access token
 * @param allowUpsert - Whether to create new products if they don't exist (default: false)
 */
export const batchUpdateProducts = async (
  catalogId: string,
  requests: BatchRequestItem[],
  accessToken: string,
  allowUpsert: boolean = false
): Promise<BatchResponse> => {
  // Validate batch size
  if (requests.length > MAX_BATCH_SIZE) {
    console.warn(`[Catalog Batch] Warning: Batch size ${requests.length} exceeds recommended limit of ${MAX_BATCH_SIZE}`);
  }

  // Facebook Catalog Batch API uses form data format (multipart/form-data style via -F)
  // Using URLSearchParams to mimic form data submission
  const formData = new URLSearchParams();
  formData.append('access_token', accessToken);
  formData.append('requests', JSON.stringify(requests));
  formData.append('item_type', 'PRODUCT_ITEM');
  formData.append('allow_upsert', allowUpsert ? 'true' : 'false');

  try {
    const response = await axios.post(
      `${BASE_URL}/${catalogId}/items_batch`,
      formData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 60000, // 60 second timeout for large batches
      }
    );

    // Log response for debugging
    if (response.data.handles) {
      console.log(`[Catalog Batch] Async processing started. Handles: ${response.data.handles.length}`);
    }
    if (response.data.validation_status) {
      const errors = response.data.validation_status.filter((s: any) => s.errors?.length > 0);
      const warnings = response.data.validation_status.filter((s: any) => s.warnings?.length > 0);
      if (errors.length > 0) {
        console.log(`[Catalog Batch] Validation errors: ${errors.length} items`);
      }
      if (warnings.length > 0) {
        console.log(`[Catalog Batch] Validation warnings: ${warnings.length} items`);
      }
    }

    return response.data;
  } catch (error: any) {
    // Log detailed error information
    if (error.response) {
      console.error(`[Catalog Batch] API Error:`, JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
};

/**
 * Helper function to create a batch request item for UPDATE operation
 * Ensures the 'id' field is properly set in the data payload
 * 
 * @param retailerId - The retailer ID (content_id) of the product
 * @param updateData - Object containing fields to update
 */
export const createUpdateRequest = (
  retailerId: string,
  updateData: Record<string, any>
): BatchRequestItem => {
  return {
    method: 'UPDATE',
    data: {
      id: retailerId,  // Required: identifies the product to update
      ...updateData,
    },
  };
};

/**
 * Helper function to create a batch request item for DELETE operation
 * 
 * @param retailerId - The retailer ID (content_id) of the product to delete
 */
export const createDeleteRequest = (retailerId: string): BatchRequestItem => {
  return {
    method: 'DELETE',
    data: {
      id: retailerId,
    },
  };
};

/**
 * Helper function to create a batch request item for CREATE operation
 * 
 * @param retailerId - The retailer ID (content_id) for the new product
 * @param productData - Object containing all required product fields
 */
export const createCreateRequest = (
  retailerId: string,
  productData: Record<string, any>
): BatchRequestItem => {
  return {
    method: 'CREATE',
    data: {
      id: retailerId,
      ...productData,
    },
  };
};
