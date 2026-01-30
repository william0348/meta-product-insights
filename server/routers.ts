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
            timeout: 60000, // 60 second timeout for large files
          });
          
          return {
            success: true,
            csvData: response.data,
          };
        } catch (error: any) {
          console.error('[Facebook CSV Proxy] Error downloading CSV:', error.message);
          throw new Error(`Failed to download CSV: ${error.message}`);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
