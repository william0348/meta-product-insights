import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);
import { z } from "zod";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
        
        try {
          // Call Python script to download and save CSV
          const scriptPath = path.join(__dirname, 'download_facebook_csv.py');
          const { stdout, stderr } = await execAsync(
            `python3 "${scriptPath}" "${reportRunId}" "${accessToken}"`,
            { maxBuffer: 50 * 1024 * 1024 } // 50MB buffer for JSON output
          );
          
          if (stderr) {
            console.error('[Facebook CSV] Python stderr:', stderr);
          }
          
          const result = JSON.parse(stdout);
          
          if (!result.success) {
            throw new Error(result.error || 'Unknown error from Python script');
          }
          
          return {
            success: true,
            filePath: result.file_path,
            previewData: result.preview_data,
            totalRows: result.total_rows,
            previewRows: result.preview_rows,
            columns: result.columns,
          };
        } catch (error: any) {
          console.error('[Facebook CSV Proxy] Error:', error.message);
          throw new Error(`Failed to download CSV: ${error.message}`);
        }
      }),

    // Get more data from saved CSV file (pagination)
    getCSVData: publicProcedure
      .input(z.object({
        filePath: z.string(),
        offset: z.number().default(0),
        limit: z.number().default(100),
      }))
      .query(async ({ input }) => {
        const { filePath, offset, limit } = input;
        
        try {
          // Read and parse CSV file with pandas
          const scriptPath = path.join(__dirname, 'read_csv_chunk.py');
          const { stdout } = await execAsync(
            `python3 "${scriptPath}" "${filePath}" ${offset} ${limit}`,
            { maxBuffer: 50 * 1024 * 1024 }
          );
          
          const result = JSON.parse(stdout);
          
          if (!result.success) {
            throw new Error(result.error || 'Failed to read CSV chunk');
          }
          
          return {
            success: true,
            data: result.data,
            hasMore: result.has_more,
          };
        } catch (error: any) {
          console.error('[CSV Chunk Reader] Error:', error.message);
          throw new Error(`Failed to read CSV data: ${error.message}`);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
