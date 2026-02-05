# Project Knowledge Base

## Production Environment Issues & Solutions

### Issue: HTTP 500 Error on Published Website (2026-02-05)

**Symptoms:**
- Development server (Preview) works perfectly
- Published website returns HTTP 500 errors on all API endpoints
- Error message: "Unexpected end of JSON input" or "Service Unavailable" (503)
- No error logs visible in Dashboard

**Root Cause:**
The server startup code included a **scheduled task for CSV file cleanup** that attempted to:
1. Access the file system (`fs.mkdir`, `fs.readdir`, `fs.stat`, `fs.unlink`)
2. Create directories and read/delete files on startup
3. Run periodic cleanup using `setInterval`

In the Manus production environment (containerized deployment), these file system operations may:
- Not have proper permissions
- Cause the server to crash silently before it can respond to requests
- Result in the container being marked as unhealthy

**Solution:**
Removed the CSV cleanup scheduled task from `server/_core/index.ts`:

```typescript
// REMOVED - This caused production crashes:
// import { cleanupOldCSVFiles } from "../cleanup-csv";

// REMOVED from startServer():
// const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000;
// setInterval(async () => {
//   await cleanupOldCSVFiles();
// }, CLEANUP_INTERVAL);
// cleanupOldCSVFiles().catch(console.error);
```

**Key Learnings:**
1. **Avoid file system operations in production server startup** - The Manus production environment may have restricted file system access
2. **Keep server startup minimal** - Only essential middleware and route registration should happen during startup
3. **Test production builds locally** - Use `NODE_ENV=production node dist/index.js` to catch issues before deployment
4. **Use S3 for file storage** - Instead of local file system, use the provided `storagePut`/`storageGet` helpers for file operations

**Prevention:**
- For scheduled tasks that require file system access, consider:
  - Using external cron services
  - Storing temporary files in S3 instead of local storage
  - Making cleanup operations optional and triggered via API endpoints instead of automatic startup

---

## Best Practices for Manus Production Deployment

1. **No local file storage** - Use S3 for all file operations
2. **No scheduled file system tasks** - Avoid `setInterval` with file operations
3. **Minimal server startup** - Keep `startServer()` simple and fast
4. **Environment-aware code** - Check `process.env.NODE_ENV` before running development-only features
5. **Error handling** - Wrap all async operations in try-catch to prevent silent crashes

---

### Issue: Catalog API 502 Error (2026-02-05)

**Symptoms:**
- `catalog.fetchProducts` API returns HTTP 502 error
- Error message: "Unexpected token '<', "<!DOCTYPE "... is not valid JSON"
- Only happens with large numbers of retailer IDs (50+)

**Root Cause:**
The `fetchProductsByRetailerIds` function was trying to fetch all retailer IDs in a single request with a 30-second timeout. When fetching 50+ products, the Facebook API response time exceeded the timeout, causing the request to fail.

**Solution:**
1. **Batch splitting**: Split large requests into smaller batches of 25 IDs each
2. **Increased timeout**: Changed from 30s to 60s per request
3. **Concurrency control**: Process 2 batches at a time with 500ms delay between groups
4. **Better error handling**: Added `ECONNABORTED` to retryable errors

**Code Changes in `server/catalog.ts`:**
```typescript
// New constant for batch size
const MAX_FETCH_BATCH_SIZE = 25;

// Split large requests into batches
if (retailerIds.length > MAX_FETCH_BATCH_SIZE) {
  // Process in batches with limited concurrency
  const CONCURRENCY = 2;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const results = await Promise.all(batchPromises);
    // Small delay between batch groups
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
```

**Key Learnings:**
1. Always implement batch processing for APIs that accept arrays
2. Set appropriate timeouts based on expected response times
3. Use concurrency limits to avoid rate limiting
4. Add delays between batch groups for API stability

---

## Catalog Batch History Feature (2026-02-05)

### Overview
The batch history feature tracks all catalog batch operations with detailed metadata for auditing and debugging.

### Database Schema (catalog_batch_history)
- `id`: Auto-increment primary key
- `userId`: Foreign key to users table
- `catalogId`: Facebook Catalog ID
- `operationType`: UPDATE, DELETE, or CREATE
- `totalItems`: Total number of items in the batch
- `batchCount`: Number of API batches sent
- `updatedFields`: Array of field names that were updated
- `updateCriteria`: JSON object with source/target fields and conditions
- `status`: pending, processing, completed, or failed
- `successCount`, `errorCount`, `warningCount`: Result counts
- `handles`: Array of Facebook API handles for status tracking
- `errors`: Array of error details with retailerId and message
- `startedAt`, `completedAt`: Timestamps
- `durationMs`: Total processing time in milliseconds

### API Endpoints
- `batchHistory.getMyHistory`: Get batch history for current user
- `batchHistory.getByCatalog`: Get batch history by catalog ID
- `batchHistory.getAll`: Get all batch history (admin dashboard)

### Frontend
- `/batch-history` page with expandable rows showing full details
- Summary statistics: total operations, items processed, success/failed counts
- Filter by catalog ID
- Expandable rows showing update criteria, fields, handles, and errors

---

## Background Batch Processing Feature (2026-02-05)

### Overview
The background batch processing feature allows catalog batch operations to continue running even if the user closes their browser. Jobs are queued in the database and processed by a background worker.

### Architecture
1. **Job Queue (batch_jobs table)**: Stores job configuration, status, and progress
2. **Job Processor (job-processor.ts)**: Background worker that polls for queued jobs every 5 seconds
3. **API Endpoints**: Submit, status, list, and cancel jobs
4. **Frontend Component (BackgroundJobProgress)**: Real-time progress display with 2-second polling

### Database Schema (batch_jobs)
- `id`: Auto-increment primary key
- `userId`: Foreign key to users table
- `jobType`: catalog_update, catalog_delete, report_generation
- `config`: JSON object with job parameters (catalogId, accessToken, retailerIds, etc.)
- `status`: queued, running, completed, failed, cancelled
- `progress`: 0-100 percentage
- `currentBatch`, `totalBatches`: Batch tracking
- `processedItems`, `totalItems`: Item counts
- `successCount`, `errorCount`, `warningCount`: Result counts
- `handles`: Array of Facebook API handles
- `errors`: Array of error details
- `statusMessage`: Human-readable status
- `historyId`: Link to catalog_batch_history record
- `queuedAt`, `startedAt`, `completedAt`: Timestamps

### API Endpoints
- `jobs.submit`: Create a new background job
- `jobs.getStatus`: Get status of a specific job
- `jobs.getMyJobs`: Get all jobs for current user
- `jobs.cancel`: Cancel a queued or running job

### Job Processing Flow
1. User submits catalog update via UI
2. Frontend calls `jobs.submit` with job configuration
3. Job is created in database with status "queued"
4. Job processor picks up job and sets status to "running"
5. Job processor splits items into batches (3000 items each)
6. Batches are processed with 5 concurrent requests
7. Progress is updated in database after each batch group
8. Frontend polls `jobs.getStatus` every 2 seconds to show progress
9. Job completes and status is set to "completed" or "failed"
10. Batch history record is created/updated for auditing

### Key Features
- **Browser-independent**: Jobs continue even if browser is closed
- **Real-time progress**: Frontend polls every 2 seconds
- **Cancellation**: Users can cancel queued or running jobs
- **Error tracking**: Errors are stored and displayed
- **History integration**: Completed jobs create batch history records

### Configuration
- `PROCESSOR_INTERVAL_MS`: 5000 (check for new jobs every 5 seconds)
- `MAX_CONCURRENT_JOBS`: 1 (process one job at a time)
- `BATCH_SIZE`: 3000 (items per Facebook API request)
- `CONCURRENT_BATCHES`: 5 (parallel batch requests)

---

*Last updated: 2026-02-05*


---

## Background Report Generation with Weekly Scheduling (2026-02-05)

### Overview
This feature moves Product Level Reporting data fetching to background processing, allowing reports to be generated even when the browser is closed. Additionally, reports can be scheduled to run automatically on a weekly basis.

### Architecture

**New Database Tables:**
1. **saved_reports**: Stores generated reports with all product data
   - `id`, `userId`, `name`, `adAccountId`, `dateStart`, `dateEnd`
   - `level`, `breakdown`, `minSpend`, `minCTR`
   - `status`: pending, generating, completed, failed
   - `totalItems`, `totalSpend`, `totalImpressions`, `totalClicks`, `totalPurchases`
   - `data`: JSON array of product insight data
   - `generatedAt`, `generationDurationMs`
   - `jobId`: Link to batch_jobs record
   - `isScheduled`, `scheduleId`: For scheduled reports

2. **scheduled_jobs**: Stores recurring job schedules
   - `id`, `userId`, `name`, `jobType`
   - `cronExpression`: 6-field cron format (second minute hour dayOfMonth month dayOfWeek)
   - `config`: JSON object with job parameters
   - `enabled`: Boolean to enable/disable schedule
   - `lastRunAt`, `lastRunStatus`, `nextRunAt`
   - `runCount`: Total number of executions

**New Backend Components:**
1. **report-generator.ts**: Handles Facebook API calls to generate reports
   - Creates async report run on Facebook
   - Polls for completion
   - Downloads and parses CSV data
   - Saves to database

2. **scheduler.ts**: Checks scheduled jobs every minute
   - Parses cron expressions
   - Creates batch jobs when schedules are due
   - Updates next run time after execution

3. **job-processor.ts**: Extended to handle `report_generation` job type
   - Calls report generator
   - Updates job progress
   - Saves report to database

### API Endpoints

**Reports:**
- `reports.generate`: Create a new report generation job
- `reports.get`: Get a specific report with data
- `reports.getMyReports`: Get all reports for current user
- `reports.delete`: Delete a report

**Schedules:**
- `schedules.create`: Create a new scheduled job
- `schedules.update`: Update schedule (enable/disable)
- `schedules.delete`: Delete a schedule
- `schedules.getMySchedules`: Get all schedules for current user

### Frontend Pages

1. **/saved-reports**: View all generated reports
   - List of reports with status badges
   - Click to view report details and data
   - Summary statistics (items, spend, impressions)
   - Delete reports

2. **/schedules**: Manage scheduled jobs
   - Create new schedules with day/time selection
   - Enable/disable schedules with toggle
   - View last run status and next run time
   - Delete schedules

### Cron Expression Format
- 6-field format: `second minute hour dayOfMonth month dayOfWeek`
- Day of week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
- Example: `0 0 9 * * 1` = Every Monday at 9:00 AM
- Example: `0 30 14 * * 5` = Every Friday at 2:30 PM

### Scheduling Flow
1. User creates schedule in `/schedules` page
2. Scheduler runs every minute and checks all enabled schedules
3. When a schedule is due (current time matches cron expression):
   - Creates a batch job with type `report_generation`
   - Updates `lastRunAt` and calculates `nextRunAt`
   - Increments `runCount`
4. Job processor picks up the job and generates the report
5. Report data is saved to `saved_reports` table
6. User can view the report in `/saved-reports` page

### Date Range Types for Scheduled Reports
- `last_7_days`: Previous 7 days from execution date
- `last_week`: Previous Monday to Sunday
- `last_14_days`: Previous 14 days
- `last_30_days`: Previous 30 days

### Best Practices
1. Use UTC timestamps for all scheduling calculations
2. Store report data as JSON in the database for easy querying
3. Limit UI display to 100 items for performance
4. Keep scheduler interval at 60 seconds to balance responsiveness and resource usage
5. Always validate access tokens before scheduling (tokens may expire)

---

*Last updated: 2026-02-05*


---

## Multi-Account Support for Scheduled Reports (2026-02-05)

### Overview
This feature allows a single scheduled job to generate multiple reports for different Ad Account IDs with different filter parameters. When the schedule runs, it creates separate batch jobs for each configured account.

### Database Changes
Added `reportConfigs` column to `scheduled_jobs` table. This is a JSON array containing multiple report configurations, each with its own Ad Account ID and filter parameters.

### Configuration Structure
Each report configuration in the array can include the following fields: `name` (optional label for the config), `adAccountId` (required), `accessToken` (optional override), `dateRangeType` (optional override), `minSpend` (optional filter), `minCTR` (optional filter), `level` (optional), and `breakdown` (optional).

### Scheduler Behavior
When a scheduled job runs, the scheduler performs the following steps. First, it retrieves the user's saved access token from the database. Then, it extracts all report configurations from the `reportConfigs` array, falling back to the legacy single config if the array is empty. For each configuration, it creates a separate batch job with the appropriate parameters. Finally, it updates the schedule with the next run time and run count.

### Frontend Changes
The ScheduledJobs page now includes a multi-account configuration section. Users can add multiple accounts by clicking "Add Account" and filling in the Ad Account ID and optional filter parameters. A "Copy from saved settings" button allows quick population of values from the user's saved token settings.

### Best Practices
1. Use descriptive names for each configuration to easily identify them later
2. Set different minSpend/minCTR filters for different accounts based on their performance characteristics
3. The scheduler creates jobs with a small delay between them to avoid overwhelming the system
4. All jobs from a single schedule run share the same `scheduleId` for tracking purposes

---

*Last updated: 2026-02-05*


---

## Combined Report + Catalog Update Workflow (2026-02-05)

### Overview
The system now supports a combined workflow that automatically:
1. Fetches Product Level Insights from Facebook Ads API
2. Updates the Facebook Catalog with the results

This can be triggered manually or scheduled to run weekly.

### Job Types
- `report_generation` - Only generates and saves the report
- `catalog_update` - Only updates the catalog (requires existing data)
- `report_and_catalog` - **Combined workflow**: Generates report AND updates catalog

### How It Works

1. **Schedule Creation**: User selects "Report + Catalog Update" job type in Schedules page
2. **Configuration**: User provides:
   - Ad Account ID(s) with filter parameters
   - Catalog ID (from saved settings)
   - Custom Label 4 value (e.g., "high_performer")
3. **Execution Flow**:
   - Scheduler triggers the job at scheduled time
   - Report generator fetches data from Facebook Ads API
   - Report is saved to `saved_reports` table
   - If `updateToCatalog` is true, automatically:
     - Extracts retailer IDs from report data
     - Creates batch update requests with custom_label_4 value
     - Sends to Facebook Catalog Batch API
     - Records results in `catalog_batch_history`

### Key Files
- `server/scheduler.ts` - Handles scheduled job execution
- `server/report-generator.ts` - Processes report generation and catalog updates
- `server/job-processor.ts` - Background job queue processor
- `client/src/pages/ScheduledJobs.tsx` - UI for creating schedules

### Configuration Options
```typescript
config: {
  // Report settings
  adAccountId: string;
  dateRangeType: 'last_7_days' | 'last_week' | 'last_14_days' | 'last_30_days';
  minSpend?: string;
  minCTR?: string;
  
  // Catalog update settings (for combined workflow)
  updateToCatalog: boolean;
  catalogId: string;
  catalogAccessToken: string;
  customLabel4: string;  // Value to set for custom_label_4 field
}
```

### Best Practices
1. **Use saved tokens** - The system automatically uses saved catalog tokens from Settings
2. **Set meaningful labels** - Use descriptive customLabel4 values like "top_performer_week_1"
3. **Monitor history** - Check Batch History page to verify catalog updates completed successfully
4. **Test manually first** - Run a manual report + catalog update before scheduling weekly automation
