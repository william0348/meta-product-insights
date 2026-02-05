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
