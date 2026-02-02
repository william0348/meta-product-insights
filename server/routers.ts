import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { fileURLToPath } from "url";
import { dirname } from "path";
import axios from "axios";
import { createReadStream, createWriteStream } from "fs";
import csvParser from "csv-parser";
import { pipeline } from "stream/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure storage directory exists
const STORAGE_DIR = path.join(__dirname, '../storage/csv_cache');

// Initialize storage directory
(async () => {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
})();

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
          // First, get the report status to extract the CSV download URL
          const statusUrl = `https://graph.facebook.com/v22.0/${reportRunId}?access_token=${accessToken}`;
          console.log('[Facebook CSV] Fetching report status from:', statusUrl.replace(accessToken, 'TOKEN_HIDDEN'));
          
          const statusResponse = await axios.get(statusUrl);
          const reportData = statusResponse.data;
          
          if (!reportData.async_status || reportData.async_status !== 'Job Completed') {
            throw new Error(`Report not ready. Status: ${reportData.async_status || 'unknown'}`);
          }
          
          // For async reports with CSV format, use the /insights endpoint
          // This returns the CSV data directly
          const downloadUrl = `https://graph.facebook.com/v22.0/${reportRunId}/insights?access_token=${accessToken}`;
          
          console.log('[Facebook CSV] Downloading from:', downloadUrl.replace(accessToken, 'TOKEN_HIDDEN'));
          
          // Download CSV file with retry logic for 503 errors
          let response;
          let retryCount = 0;
          const maxRetries = 3;
          const retryDelays = [5000, 10000, 15000]; // 5s, 10s, 15s
          
          while (retryCount <= maxRetries) {
            try {
              // Add initial delay after report completion
              if (retryCount === 0) {
                console.log('[Facebook CSV] Waiting 3 seconds for CDN to prepare file...');
                await new Promise(resolve => setTimeout(resolve, 3000));
              }
              
              response = await axios.get(downloadUrl, {
                responseType: 'stream',
                timeout: 120000, // 120 second timeout
                maxContentLength: 500 * 1024 * 1024, // 500MB
                maxBodyLength: 500 * 1024 * 1024,
              });
              
              console.log('[Facebook CSV] Download successful, status:', response.status);
              break; // Success, exit retry loop
              
            } catch (error: any) {
              if (error.response?.status === 503 && retryCount < maxRetries) {
                const delay = retryDelays[retryCount];
                console.log(`[Facebook CSV] Got 503, retrying in ${delay/1000}s (attempt ${retryCount + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                retryCount++;
              } else {
                throw error; // Non-503 error or max retries reached
              }
            }
          }
          
          if (!response) {
            throw new Error('Failed to download CSV after all retries');
          }
          
          // Save CSV to file
          const fileName = `${reportRunId}_${Date.now()}.csv`;
          const filePath = path.join(STORAGE_DIR, fileName);
          const writeStream = createWriteStream(filePath);
          
          await pipeline(response.data, writeStream);
          
          console.log('[Facebook CSV] File saved to:', filePath);
          
          // Parse first 100 rows for preview
          const previewData: any[] = [];
          const columns: string[] = [];
          let totalRows = 0;
          
          await new Promise<void>((resolve, reject) => {
            createReadStream(filePath)
              .pipe(csvParser())
              .on('headers', (headers) => {
                columns.push(...headers);
                console.log('[Facebook CSV] Detected columns:', headers);
              })
              .on('data', (row) => {
                totalRows++;
                if (previewData.length < 100) {
                  // Convert numeric strings to numbers
                  const processedRow: any = {};
                  for (const [key, value] of Object.entries(row)) {
                    if (typeof value === 'string' && value.trim() !== '') {
                      const numValue = parseFloat(value);
                      processedRow[key] = isNaN(numValue) ? value : numValue;
                    } else {
                      processedRow[key] = value || null;
                    }
                  }
                  previewData.push(processedRow);
                }
              })
              .on('end', () => {
                console.log(`[Facebook CSV] Parsed ${totalRows} total rows, returning ${previewData.length} preview rows`);
                resolve();
              })
              .on('error', reject);
          });
          
          return {
            success: true,
            filePath: fileName, // Return relative filename only
            previewData,
            totalRows,
            previewRows: previewData.length,
            columns,
          };
        } catch (error: any) {
          console.error('[Facebook CSV Proxy] Error:', error.message);
          if (error.response) {
            console.error('[Facebook CSV Proxy] Response status:', error.response.status);
            console.error('[Facebook CSV Proxy] Response data:', error.response.data);
          }
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
          // Construct full path
          const fullPath = path.join(STORAGE_DIR, filePath);
          
          // Check if file exists
          await fs.access(fullPath);
          
          // Read CSV with offset and limit
          const data: any[] = [];
          let currentRow = 0;
          
          await new Promise<void>((resolve, reject) => {
            createReadStream(fullPath)
              .pipe(csvParser())
              .on('data', (row) => {
                currentRow++;
                if (currentRow > offset && data.length < limit) {
                  // Convert numeric strings to numbers
                  const processedRow: any = {};
                  for (const [key, value] of Object.entries(row)) {
                    if (typeof value === 'string' && value.trim() !== '') {
                      const numValue = parseFloat(value);
                      processedRow[key] = isNaN(numValue) ? value : numValue;
                    } else {
                      processedRow[key] = value || null;
                    }
                  }
                  data.push(processedRow);
                }
              })
              .on('end', resolve)
              .on('error', reject);
          });
          
          return {
            success: true,
            data,
            hasMore: data.length === limit, // If we got full limit, there might be more
          };
        } catch (error: any) {
          console.error('[CSV Chunk Reader] Error:', error.message);
          throw new Error(`Failed to read CSV data: ${error.message}`);
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
