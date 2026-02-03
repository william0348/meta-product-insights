import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { saveUserToken, getUserToken, deleteUserToken } from "./db";
import { z } from "zod";
import axios from "axios";
import { fetchProductsByRetailerIds, batchUpdateProducts, BatchRequestItem } from "./catalog";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // User token management
  tokens: router({
    // Save a token (ads or catalog)
    save: protectedProcedure
      .input(z.object({
        tokenType: z.enum(["ads_management", "catalog_management"]),
        accessToken: z.string(),
        catalogId: z.string().optional(),
        adAccountId: z.string().optional(),
        minSpend: z.string().optional(),
        minCTR: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        await saveUserToken(userId, input.tokenType, input.accessToken, {
          catalogId: input.catalogId,
          adAccountId: input.adAccountId,
          minSpend: input.minSpend,
          minCTR: input.minCTR,
        });
        return { success: true };
      }),
    
    // Get a token
    get: protectedProcedure
      .input(z.object({
        tokenType: z.enum(["ads_management", "catalog_management"]),
      }))
      .query(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        const token = await getUserToken(userId, input.tokenType);
        if (!token) {
          return { found: false, accessToken: null, catalogId: null, adAccountId: null, minSpend: null, minCTR: null };
        }
        return {
          found: true,
          accessToken: token.accessToken,
          catalogId: token.catalogId,
          adAccountId: token.adAccountId,
          minSpend: token.minSpend,
          minCTR: token.minCTR,
        };
      }),
    
    // Delete a token
    delete: protectedProcedure
      .input(z.object({
        tokenType: z.enum(["ads_management", "catalog_management"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        await deleteUserToken(userId, input.tokenType);
        return { success: true };
      }),
  }),

  // Facebook Catalog Batch API
  catalog: router({ 
    // Fetch products by retailer IDs (for merge logic)
    fetchProducts: publicProcedure
      .input(z.object({
        catalogId: z.string(),
        retailerIds: z.array(z.string()),
        accessToken: z.string(),
      }))
      .query(async ({ input }) => {
        const { catalogId, retailerIds, accessToken } = input;
        
        try {
          const products = await fetchProductsByRetailerIds(catalogId, retailerIds, accessToken);
          return { success: true, products };
        } catch (error: any) {
          console.error('[Catalog Fetch] Error:', error.message);
          throw new Error(`Failed to fetch products: ${error.message}`);
        }
      }),
    
    // Batch update products
    batchUpdate: publicProcedure
      .input(z.object({
        catalogId: z.string(),
        requests: z.array(z.object({
          method: z.enum(['UPDATE', 'DELETE', 'CREATE']),
          retailer_id: z.string(),
          data: z.record(z.string(), z.any()),
        })),
        accessToken: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { catalogId, requests, accessToken } = input;
        
        try {
          console.log(`[Catalog Batch] Updating ${requests.length} products...`);
          const response = await batchUpdateProducts(catalogId, requests as BatchRequestItem[], accessToken);
          
          // Log validation errors/warnings
          if (response.validation_status) {
            let errorCount = 0;
            let warningCount = 0;
            
            response.validation_status.forEach(status => {
              if (status.errors && status.errors.length > 0) {
                status.errors.forEach(err => {
                  console.error(`[Catalog Batch Error] ID ${status.retailer_id}: ${err.message}`);
                  errorCount++;
                });
              }
              if (status.warnings && status.warnings.length > 0) {
                status.warnings.forEach(warn => {
                  console.warn(`[Catalog Batch Warning] ID ${status.retailer_id}: ${warn.message}`);
                  warningCount++;
                });
              }
            });
            
            console.log(`[Catalog Batch] Validation: ${errorCount} errors, ${warningCount} warnings`);
          }
          
          return {
            success: true,
            handles: response.handles,
            validation_status: response.validation_status || [],
          };
        } catch (error: any) {
          console.error('[Catalog Batch] Error:', error.message);
          throw new Error(`Failed to batch update: ${error.message}`);
        }
      }),
  }),

  // Facebook Insights API Proxy
  facebook: router({
    // Fetch insights data directly as JSON (paginated)
    getInsightsData: publicProcedure
      .input(z.object({
        reportRunId: z.string(),
        accessToken: z.string(),
        limit: z.number().default(500),
        after: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const { reportRunId, accessToken, limit, after } = input;
        
        // Retry logic with exponential backoff
        const maxRetries = 3;
        const baseDelay = 2000; // 2 seconds
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            // Build the insights URL with pagination
            let insightsUrl = `https://graph.facebook.com/v22.0/${reportRunId}/insights?access_token=${accessToken}&limit=${limit}`;
            
            if (after) {
              insightsUrl += `&after=${after}`;
            }
            
            if (attempt > 0) {
              console.log(`[Facebook Insights] Retry attempt ${attempt}/${maxRetries}`);
            }
            console.log('[Facebook Insights] Fetching from:', insightsUrl.replace(accessToken, 'TOKEN_HIDDEN'));
            
            const response = await axios.get(insightsUrl, {
              timeout: 60000, // 60 second timeout
            });
            
            const data = response.data;
            
            console.log('[Facebook Insights] Received', data.data?.length || 0, 'records');
            
            return {
              success: true,
              data: data.data || [],
              paging: data.paging || null,
            };
          } catch (error: any) {
            const isLastAttempt = attempt === maxRetries;
            const isRetryableError = 
              error.code === 'ECONNRESET' ||
              error.code === 'ETIMEDOUT' ||
              error.code === 'ENOTFOUND' ||
              error.message?.includes('socket') ||
              error.message?.includes('timeout') ||
              (error.response?.status >= 500 && error.response?.status < 600);
            
            console.error(`[Facebook Insights] Error (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
            if (error.response) {
              console.error('[Facebook Insights] Response status:', error.response.status);
              console.error('[Facebook Insights] Response data:', error.response.data);
            }
            
            // If it's the last attempt or not a retryable error, throw
            if (isLastAttempt || !isRetryableError) {
              throw new Error(`Failed to fetch insights: ${error.message}`);
            }
            
            // Wait before retrying (exponential backoff)
            const delay = baseDelay * Math.pow(2, attempt);
            console.log(`[Facebook Insights] Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        
        // This should never be reached, but TypeScript needs it
        throw new Error('Failed to fetch insights after all retries');
      }),
  }),
});

export type AppRouter = typeof appRouter;
