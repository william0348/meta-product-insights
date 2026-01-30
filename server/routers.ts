import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import axios from "axios";
import { z } from "zod";

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

  // Facebook CSV Proxy Router
  facebook: router({
    downloadReportCSV: publicProcedure
      .input(z.object({
        reportRunId: z.string(),
        accessToken: z.string(),
      }))
      .query(async ({ input }) => {
        const { reportRunId, accessToken } = input;
        
        // Download CSV from Facebook's lookaside URL server-side (no CORS)
        const downloadUrl = `https://lookaside.facebook.com/ads/ads_insights/download_report/business/?report_run_id=${reportRunId}&access_token=${accessToken}`;
        
        try {
          const response = await axios.get(downloadUrl, {
            responseType: 'text',
            timeout: 120000, // 120 second timeout for large files (398MB can take 10-15s)
            maxContentLength: 500 * 1024 * 1024, // 500MB max
            maxBodyLength: 500 * 1024 * 1024, // 500MB max
          });
          
          return {
            success: true,
            csvData: response.data,
          };
        } catch (error: any) {
          console.error('[Facebook CSV Proxy] Error downloading CSV:', error.message);
          console.error('[Facebook CSV Proxy] Error details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            reportRunId,
          });
          
          // Provide more specific error messages
          if (error.response) {
            const status = error.response.status;
            if (status === 503) {
              throw new Error(`Facebook API temporarily unavailable (503). The report may still be processing. Please wait a moment and try again.`);
            } else if (status === 400) {
              throw new Error(`Invalid report request (400). Check that the report run ID and access token are correct.`);
            } else if (status === 404) {
              throw new Error(`Report not found (404). The report may have expired or the ID is incorrect.`);
            }
            throw new Error(`Facebook API error (${status}): ${error.response.statusText}`);
          }
          
          throw new Error(`Network error: ${error.message}`);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
