import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import axios from "axios";

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

  // Facebook Insights API Proxy
  facebook: router({
    // Fetch insights data directly as JSON (paginated)
    getInsightsData: publicProcedure
      .input(z.object({
        reportRunId: z.string(),
        accessToken: z.string(),
        limit: z.number().default(100),
        after: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const { reportRunId, accessToken, limit, after } = input;
        
        try {
          // Build the insights URL with pagination
          let insightsUrl = `https://graph.facebook.com/v22.0/${reportRunId}/insights?access_token=${accessToken}&limit=${limit}`;
          
          if (after) {
            insightsUrl += `&after=${after}`;
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
          console.error('[Facebook Insights] Error:', error.message);
          if (error.response) {
            console.error('[Facebook Insights] Response status:', error.response.status);
            console.error('[Facebook Insights] Response data:', error.response.data);
          }
          throw new Error(`Failed to fetch insights: ${error.message}`);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
