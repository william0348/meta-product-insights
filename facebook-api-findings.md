# Facebook Ads Insights API - Key Findings

## Async Job Status
From: https://developers.facebook.com/docs/marketing-api/insights/best-practices/

### Job Status Values:
- `Job Not Started` - Job has not started yet
- `Job Started` - Job has been started, but is not yet running
- `Job Running` - Job has started running
- **`Job Completed` - Job has successfully completed**
- `Job Failed` - Job has failed
- `Job Skipped` - Job has expired and skipped

### Key Insight:
When status shows "Job Completed", the report processing is done, but **the CSV file may not be immediately available on Facebook's CDN** (lookaside.facebook.com).

## Timeout Recommendations:
- `/POST` or asynchronous requests can return timeout errors
- For asynchronous requests, **it can take up to an hour to complete a request including retry attempts**
- If a query tries to fetch a large volume of data for many ad level objects, it may timeout

## Rate Limiting:
- During periods of elevated global load, the system can throttle requests to protect the backend
- Recommendation: Reduce calls, wait a short period, and query again
- Use the rate-limit information in HTTP response header to moderate calls

## Best Practices:
1. Use async jobs for large data requests
2. Add back-off mechanism to slow down or pause queries when approaching rate limits
3. Spread queries by pacing them with wait time

## Export Reports Section:
Need to scroll further to find specific documentation about CSV export file availability timing.


## Export Reports
From: https://developers.facebook.com/docs/marketing-api/insights/best-practices/#export-reports

### Export Endpoint:
```
curl -G \
  -d 'report_run_id=<AD_REPORT_RUN_ID>' \
  -d 'name=myreport' \
  -d 'format=xls' \
  'https://www.facebook.com/ads/ads_insights/export_report/'
```

### Parameters:
- `name` (string) - Name of downloaded file
- `format` (enum{csv,xls}) - Format of file
- `report_run_id` (integer) - ID of report to run
- `access_token` (string) - Permissions granted by the logged-in user

### Important Note:
**"Note: this endpoint is not part of our versioned Graph API and therefore does not conform to its breaking-change policy. Scripts and programs should not rely on the format of the result as it may change unexpectedly."**

## Key Takeaway:
The documentation does NOT specify how long to wait after "Job Completed" status before the file is available on the CDN. The 503 errors suggest Facebook's internal systems need additional time to propagate the file to their lookaside CDN after the job completes.

## Recommended Solution:
Since Facebook doesn't provide a "file ready" status, we should:
1. Increase the initial delay after "Job Completed" (currently 10s)
2. Increase retry delays (currently 5s, 10s, 15s)
3. Add more retry attempts
4. Total wait time should be at least 60-90 seconds
