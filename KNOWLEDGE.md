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

*Last updated: 2026-02-05*
