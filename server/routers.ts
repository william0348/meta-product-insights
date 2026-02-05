import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { saveUserToken, getUserToken, deleteUserToken, createBatchHistoryRecord, updateBatchHistoryRecord, getBatchHistoryByUser, getBatchHistoryByCatalog, getAllBatchHistory, createBatchJob, getBatchJob, getBatchJobsByUser, updateBatchJob, createSavedReport, getSavedReport, getSavedReportsByUser, deleteSavedReport, createScheduledJob, getScheduledJob, getScheduledJobsByUser, updateScheduledJob, deleteScheduledJob } from "./db";
import { z } from "zod";
import axios from "axios";
import { fetchProductsByRetailerIds, batchUpdateProducts, checkBatchRequestStatus, BatchRequestItem } from "./catalog";

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
        batchSize: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        await saveUserToken(userId, input.tokenType, input.accessToken, {
          catalogId: input.catalogId,
          adAccountId: input.adAccountId,
          minSpend: input.minSpend,
          minCTR: input.minCTR,
          batchSize: input.batchSize,
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
          return { found: false, accessToken: null, catalogId: null, adAccountId: null, minSpend: null, minCTR: null, batchSize: null };
        }
        return {
          found: true,
          accessToken: token.accessToken,
          catalogId: token.catalogId,
          adAccountId: token.adAccountId,
          minSpend: token.minSpend,
          minCTR: token.minCTR,
          batchSize: token.batchSize,
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
    
    // Batch update products with history recording
    batchUpdate: protectedProcedure
      .input(z.object({
        catalogId: z.string(),
        requests: z.array(z.object({
          method: z.enum(['UPDATE', 'DELETE', 'CREATE']),
          retailer_id: z.string(),
          data: z.record(z.string(), z.any()),
        })),
        accessToken: z.string(),
        // Optional metadata for history recording
        updateCriteria: z.object({
          sourceField: z.string().optional(),
          targetField: z.string().optional(),
          condition: z.string().optional(),
          description: z.string().optional(),
        }).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { catalogId, requests, accessToken, updateCriteria } = input;
        const userId = ctx.user.id;
        const startTime = Date.now();
        
        // Determine operation type (use first request's method, or 'UPDATE' as default)
        const operationType = requests.length > 0 ? requests[0].method : 'UPDATE';
        
        // Extract updated fields from the first request's data
        const updatedFields = requests.length > 0 
          ? Object.keys(requests[0].data).filter(key => key !== 'id')
          : [];
        
        // Create initial history record
        let historyId: number | null = null;
        try {
          historyId = await createBatchHistoryRecord({
            userId,
            catalogId,
            operationType,
            totalItems: requests.length,
            batchCount: Math.ceil(requests.length / 3000), // Estimated based on batch size
            updatedFields,
            updateCriteria: updateCriteria || null,
            status: 'processing',
            startedAt: new Date(),
          });
          console.log(`[Catalog Batch] Created history record: ${historyId}`);
        } catch (err) {
          console.error('[Catalog Batch] Failed to create history record:', err);
          // Continue with the batch update even if history recording fails
        }
        
        try {
          console.log(`[Catalog Batch] Updating ${requests.length} products...`);
          
          // Transform requests to match Facebook API format
          const formattedRequests: BatchRequestItem[] = requests.map(req => ({
            method: req.method,
            data: {
              id: req.retailer_id,
              ...req.data,
            },
          }));
          
          const response = await batchUpdateProducts(catalogId, formattedRequests, accessToken);
          
          // Count errors and warnings
          let errorCount = 0;
          let warningCount = 0;
          const errorDetails: Array<{ retailerId: string; message: string }> = [];
          
          if (response.validation_status) {
            response.validation_status.forEach(status => {
              if (status.errors && status.errors.length > 0) {
                status.errors.forEach(err => {
                  console.error(`[Catalog Batch Error] ID ${status.retailer_id}: ${err.message}`);
                  errorCount++;
                  errorDetails.push({ retailerId: status.retailer_id, message: err.message });
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
          
          const endTime = Date.now();
          const durationMs = endTime - startTime;
          
          // Update history record with results
          if (historyId) {
            try {
              await updateBatchHistoryRecord(historyId, {
                status: 'completed',
                successCount: response.totalProcessed - errorCount,
                errorCount,
                warningCount,
                handles: response.handles,
                errors: errorDetails.length > 0 ? errorDetails : null,
                completedAt: new Date(),
                durationMs,
                batchCount: response.batchCount,
              });
              console.log(`[Catalog Batch] Updated history record: ${historyId}`);
            } catch (err) {
              console.error('[Catalog Batch] Failed to update history record:', err);
            }
          }
          
          return {
            success: true,
            handles: response.handles,
            validation_status: response.validation_status || [],
            totalProcessed: response.totalProcessed,
            batchCount: response.batchCount,
            historyId,
            durationMs,
          };
        } catch (error: any) {
          console.error('[Catalog Batch] Error:', error.message);
          
          // Update history record with failure
          if (historyId) {
            try {
              await updateBatchHistoryRecord(historyId, {
                status: 'failed',
                errors: [{ retailerId: 'N/A', message: error.message }],
                completedAt: new Date(),
                durationMs: Date.now() - startTime,
              });
            } catch (err) {
              console.error('[Catalog Batch] Failed to update history record on error:', err);
            }
          }
          
          throw new Error(`Failed to batch update: ${error.message}`);
        }
      }),
    
    // Check batch request status
    checkBatchStatus: publicProcedure
      .input(z.object({
        catalogId: z.string(),
        handle: z.string(),
        accessToken: z.string(),
        loadInvalidIds: z.boolean().optional().default(false),
      }))
      .query(async ({ input }) => {
        const { catalogId, handle, accessToken, loadInvalidIds } = input;
        
        try {
          console.log(`[Catalog Batch Status] Checking status for handle: ${handle}`);
          const response = await checkBatchRequestStatus(catalogId, handle, accessToken, loadInvalidIds);
          
          console.log(`[Catalog Batch Status] Response:`, JSON.stringify(response, null, 2));
          
          return {
            success: true,
            data: response.data || [],
          };
        } catch (error: any) {
          console.error('[Catalog Batch Status] Error:', error.message);
          throw new Error(`Failed to check batch status: ${error.message}`);
        }
      }),
  }),

  // Batch History API
  batchHistory: router({
    // Get batch history for current user
    getMyHistory: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(50),
      }))
      .query(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        const history = await getBatchHistoryByUser(userId, input.limit);
        return { success: true, history };
      }),
    
    // Get batch history by catalog ID
    getByCatalog: protectedProcedure
      .input(z.object({
        catalogId: z.string(),
        limit: z.number().optional().default(50),
      }))
      .query(async ({ input }) => {
        const history = await getBatchHistoryByCatalog(input.catalogId, input.limit);
        return { success: true, history };
      }),
    
    // Get all batch history (admin only or for dashboard)
    getAll: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(100),
      }))
      .query(async ({ input }) => {
        const history = await getAllBatchHistory(input.limit);
        return { success: true, history };
      }),
  }),

  // Background Jobs API
  jobs: router({
    // Submit a new background job
    submit: protectedProcedure
      .input(z.object({
        jobType: z.enum(["catalog_update", "catalog_delete", "report_generation"]),
        config: z.object({
          catalogId: z.string(),
          accessToken: z.string(),
          retailerIds: z.array(z.string()),
          customLabel4: z.string().optional(),
          customNumberField: z.string().optional(),
          customNumberValue: z.string().optional(),
          updateCriteria: z.object({
            sourceField: z.string().optional(),
            targetField: z.string().optional(),
            condition: z.string().optional(),
            description: z.string().optional(),
          }).optional(),
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        
        console.log(`[Jobs] Creating new ${input.jobType} job for user ${userId}`);
        console.log(`[Jobs] Config: ${input.config.retailerIds.length} items`);
        
        const jobId = await createBatchJob({
          userId,
          jobType: input.jobType,
          config: input.config,
          totalItems: input.config.retailerIds.length,
        });
        
        if (!jobId) {
          throw new Error("Failed to create job");
        }
        
        console.log(`[Jobs] Created job ${jobId}`);
        
        return {
          success: true,
          jobId,
          message: `Job queued with ${input.config.retailerIds.length} items`,
        };
      }),
    
    // Get job status
    getStatus: protectedProcedure
      .input(z.object({
        jobId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        const job = await getBatchJob(input.jobId);
        
        if (!job) {
          return { found: false, job: null };
        }
        
        // Only allow users to see their own jobs
        if (job.userId !== ctx.user.id) {
          return { found: false, job: null };
        }
        
        return {
          found: true,
          job: {
            id: job.id,
            jobType: job.jobType,
            status: job.status,
            progress: job.progress,
            currentBatch: job.currentBatch,
            totalBatches: job.totalBatches,
            processedItems: job.processedItems,
            totalItems: job.totalItems,
            successCount: job.successCount,
            errorCount: job.errorCount,
            warningCount: job.warningCount,
            statusMessage: job.statusMessage,
            queuedAt: job.queuedAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            historyId: job.historyId,
            errors: job.errors?.slice(-10), // Only return last 10 errors
          },
        };
      }),
    
    // Get all jobs for current user
    getMyJobs: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(20),
      }))
      .query(async ({ ctx, input }) => {
        const jobs = await getBatchJobsByUser(ctx.user.id, input.limit);
        
        return {
          success: true,
          jobs: jobs.map(job => ({
            id: job.id,
            jobType: job.jobType,
            status: job.status,
            progress: job.progress,
            totalItems: job.totalItems,
            successCount: job.successCount,
            errorCount: job.errorCount,
            statusMessage: job.statusMessage,
            queuedAt: job.queuedAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
          })),
        };
      }),
    
    // Cancel a job
    cancel: protectedProcedure
      .input(z.object({
        jobId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const job = await getBatchJob(input.jobId);
        
        if (!job) {
          throw new Error("Job not found");
        }
        
        // Only allow users to cancel their own jobs
        if (job.userId !== ctx.user.id) {
          throw new Error("Not authorized to cancel this job");
        }
        
        // Only allow cancelling queued or running jobs
        if (job.status !== "queued" && job.status !== "running") {
          throw new Error(`Cannot cancel job with status: ${job.status}`);
        }
        
        await updateBatchJob(input.jobId, {
          status: "cancelled",
          statusMessage: "Cancelled by user",
          completedAt: new Date(),
        });
        
        console.log(`[Jobs] Job ${input.jobId} cancelled by user ${ctx.user.id}`);
        
        return { success: true };
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

  // Saved Reports API
  reports: router({
    // Submit a report generation job
    generate: protectedProcedure
      .input(z.object({
        adAccountId: z.string(),
        accessToken: z.string(),
        dateStart: z.string(),
        dateEnd: z.string(),
        level: z.string().optional().default('account'),
        breakdown: z.string().optional().default('product_id'),
        minSpend: z.string().optional(),
        minCTR: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        
        console.log(`[Reports] Creating report generation job for user ${userId}`);
        
        const jobId = await createBatchJob({
          userId,
          jobType: 'report_generation',
          config: {
            adAccountId: input.adAccountId,
            accessToken: input.accessToken,
            dateStart: input.dateStart,
            dateEnd: input.dateEnd,
            level: input.level,
            breakdown: input.breakdown,
            minSpend: input.minSpend,
            minCTR: input.minCTR,
          },
        });
        
        if (!jobId) {
          throw new Error('Failed to create report generation job');
        }
        
        console.log(`[Reports] Created job ${jobId}`);
        
        return { success: true, jobId };
      }),
    
    // Get a saved report by ID
    get: protectedProcedure
      .input(z.object({
        reportId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        const report = await getSavedReport(input.reportId);
        
        if (!report) {
          throw new Error('Report not found');
        }
        
        // Check ownership
        if (report.userId !== ctx.user.id) {
          throw new Error('Access denied');
        }
        
        return { success: true, report };
      }),
    
    // Get all reports for current user
    getMyReports: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(50),
      }))
      .query(async ({ ctx, input }) => {
        const reports = await getSavedReportsByUser(ctx.user.id, input.limit);
        
        // Return reports without full data (for list view)
        return {
          success: true,
          reports: reports.map(r => ({
            id: r.id,
            name: r.name,
            adAccountId: r.adAccountId,
            dateStart: r.dateStart,
            dateEnd: r.dateEnd,
            totalItems: r.totalItems,
            totalSpend: r.totalSpend,
            status: r.status,
            source: r.source,
            generatedAt: r.generatedAt,
            createdAt: r.createdAt,
          })),
        };
      }),
    
    // Delete a report
    delete: protectedProcedure
      .input(z.object({
        reportId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const report = await getSavedReport(input.reportId);
        
        if (!report) {
          throw new Error('Report not found');
        }
        
        if (report.userId !== ctx.user.id) {
          throw new Error('Access denied');
        }
        
        await deleteSavedReport(input.reportId);
        
        return { success: true };
      }),
  }),

  // Scheduled Jobs API
  schedules: router({
    // Create a new scheduled job
    create: protectedProcedure
      .input(z.object({
        name: z.string(),
        description: z.string().optional(),
        jobType: z.enum(['report_generation', 'catalog_update', 'report_and_catalog']),
        cronExpression: z.string(), // e.g., "0 0 9 * * 1" for Monday 9 AM
        timezone: z.string().optional().default('Asia/Taipei'),
        config: z.object({
          adAccountId: z.string().optional(),
          dateRangeType: z.string().optional(), // "last_7_days", "last_week", etc.
          level: z.string().optional(),
          breakdown: z.string().optional(),
          minSpend: z.string().optional(),
          minCTR: z.string().optional(),
          catalogId: z.string().optional(),
          customLabel4: z.string().optional(),
          // For combined workflow (report_and_catalog)
          updateToCatalog: z.boolean().optional(),
          catalogAccessToken: z.string().optional(),
        }),
        // Multi-account configurations
        reportConfigs: z.array(z.object({
          name: z.string().optional(),
          adAccountId: z.string(),
          accessToken: z.string().optional(),
          dateRangeType: z.string().optional(),
          minSpend: z.string().optional(),
          minCTR: z.string().optional(),
          level: z.string().optional(),
          breakdown: z.string().optional(),
        })).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        
        // Calculate next run time based on cron expression
        const now = new Date();
        const nextRunAt = new Date(now);
        nextRunAt.setDate(nextRunAt.getDate() + 7); // Default to next week
        
        const scheduleId = await createScheduledJob({
          userId,
          name: input.name,
          description: input.description || null,
          jobType: input.jobType,
          cronExpression: input.cronExpression,
          timezone: input.timezone,
          config: input.config,
          reportConfigs: input.reportConfigs || null,
          enabled: true,
          nextRunAt,
        });
        
        if (!scheduleId) {
          throw new Error('Failed to create scheduled job');
        }
        
        console.log(`[Schedules] Created schedule ${scheduleId} for user ${userId}`);
        
        return { success: true, scheduleId };
      }),
    
    // Get a scheduled job by ID
    get: protectedProcedure
      .input(z.object({
        scheduleId: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        const schedule = await getScheduledJob(input.scheduleId);
        
        if (!schedule) {
          throw new Error('Schedule not found');
        }
        
        if (schedule.userId !== ctx.user.id) {
          throw new Error('Access denied');
        }
        
        return { success: true, schedule };
      }),
    
    // Get all schedules for current user
    getMySchedules: protectedProcedure
      .input(z.object({
        limit: z.number().optional().default(50),
      }))
      .query(async ({ ctx, input }) => {
        const schedules = await getScheduledJobsByUser(ctx.user.id, input.limit);
        
        return { success: true, schedules };
      }),
    
    // Update a scheduled job
    update: protectedProcedure
      .input(z.object({
        scheduleId: z.number(),
        enabled: z.boolean().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        jobType: z.enum(['report_generation', 'catalog_update', 'report_and_catalog']).optional(),
        cronExpression: z.string().optional(),
        timezone: z.string().optional(),
        config: z.object({
          adAccountId: z.string().optional(),
          dateRangeType: z.string().optional(),
          level: z.string().optional(),
          breakdown: z.string().optional(),
          minSpend: z.string().optional(),
          minCTR: z.string().optional(),
          catalogId: z.string().optional(),
          customLabel4: z.string().optional(),
          updateToCatalog: z.boolean().optional(),
          catalogAccessToken: z.string().optional(),
          customNumbers: z.record(z.string(), z.string()).optional(),
        }).optional(),
        // Multi-account configurations
        reportConfigs: z.array(z.object({
          name: z.string().optional(),
          adAccountId: z.string(),
          accessToken: z.string().optional(),
          dateRangeType: z.string().optional(),
          minSpend: z.string().optional(),
          minCTR: z.string().optional(),
          level: z.string().optional(),
          breakdown: z.string().optional(),
        })).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const schedule = await getScheduledJob(input.scheduleId);
        
        if (!schedule) {
          throw new Error('Schedule not found');
        }
        
        if (schedule.userId !== ctx.user.id) {
          throw new Error('Access denied');
        }
        
        const updates: any = {};
        if (input.enabled !== undefined) updates.enabled = input.enabled;
        if (input.name !== undefined) updates.name = input.name;
        if (input.description !== undefined) updates.description = input.description;
        if (input.jobType !== undefined) updates.jobType = input.jobType;
        if (input.cronExpression !== undefined) updates.cronExpression = input.cronExpression;
        if (input.timezone !== undefined) updates.timezone = input.timezone;
        if (input.config !== undefined) updates.config = input.config;
        if (input.reportConfigs !== undefined) updates.reportConfigs = input.reportConfigs;
        
        await updateScheduledJob(input.scheduleId, updates);
        
        console.log(`[Schedules] Updated schedule ${input.scheduleId}`);
        
        return { success: true };
      }),
    
    // Delete a scheduled job
    delete: protectedProcedure
      .input(z.object({
        scheduleId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const schedule = await getScheduledJob(input.scheduleId);
        
        if (!schedule) {
          throw new Error('Schedule not found');
        }
        
        if (schedule.userId !== ctx.user.id) {
          throw new Error('Access denied');
        }
        
        await deleteScheduledJob(input.scheduleId);
        
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
