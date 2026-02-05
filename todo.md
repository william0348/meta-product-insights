# Project TODO

- [x] Update `api.ts` - Change `export_format` to `'csv'`
- [x] Resolve Home.tsx merge conflicts from template upgrade
- [x] Create backend proxy route for CSV download to fix CORS
- [x] Write and pass tests for proxy endpoint
- [x] Fix 400 error when calling backend proxy - correct tRPC API call format
- [x] Add loading progress indicator for CSV download
- [x] Track download progress percentage in backend
- [x] Display progress in UI during fetch
- [x] Remove SavedPresets component from UI
- [x] Fix "Cannot read properties of undefined (reading 'readable')" CSV parsing error
- [ ] Update CSV mapping to use correct field for Catalog Purchases (converted_product_omni_purchase)
- [ ] Test full CSV download and filtering workflow end-to-end
- [x] Debug and fix persistent 'readable' error after CSV download
- [x] Debug why CSV data is not being displayed in UI after download - fixed duplicate error variable
- [x] Fix 503 Service Unavailable error when downloading CSV from Facebook - added retry logic and delay
- [x] Increase initial delay after report completion to 10 seconds
- [ ] Check if Facebook API provides a way to verify file is ready before download
- [ ] Consider alternative: poll report status for longer before attempting download
- [ ] Fix backend proxy bug - direct curl works but proxy returns 503
- [ ] Handle large file downloads (398MB CSV) in backend proxy
- [x] Add filtering parameters to Facebook API createReportRun request
- [x] Support filtering by CTR (inline_link_click_ctr) and spend
- [x] Update UI to allow users to set filter thresholds before generating report
- [x] Fix uncontrolled to controlled input error in form component
- [x] Create Python script for CSV download and parsing with pandas
- [x] Update backend to call Python script instead of axios  
- [x] Test Python implementation - all tests passing (4/4)
- [x] Update CSV field mapping to match Facebook's actual headers (Product Name, Content ID, Link Click CTR (%), etc.)
- [x] Update Python script to save CSV to file storage instead of returning full content
- [x] Create backend endpoint to stream/paginate data from saved CSV file
- [x] Update frontend to fetch data in chunks from file instead of loading all at once
- [x] Test implementation - all tests passing (4/4)
- [x] Fix __dirname is not defined error in ES modules
- [x] Fix Python SRE module mismatch by using python3.11 instead of python3
- [x] Add shebang to Python scripts to force Python 3.11 interpreter
- [x] Use absolute path /usr/bin/python3.11 in backend to avoid environment issues
- [x] Create shell wrapper script to clear Python environment variables
- [x] Add Python isolated mode flags (-I -s -E) to wrapper script
- [x] Test wrapper script solution - Python 3.11 now runs without SRE module mismatch
- [x] Remove Python scripts and wrapper (download_facebook_csv.py, read_csv_chunk.py, run_python311.sh)
- [x] Install csv-parser npm package for Node.js CSV parsing
- [x] Rewrite downloadReportCSV endpoint to use Node.js axios + csv-parser
- [x] Rewrite getCSVData endpoint to use Node.js fs + csv-parser
- [x] Test Node.js implementation - ready for end-to-end testing with real Facebook data
- [x] Fix undefined previewData error - use correct Facebook /insights endpoint for CSV download
- [ ] Add null check and better error handling in frontend API
- [x] Add summary metrics dashboard (total products, total spend, avg CTR, conversion rate)
- [x] Implement automatic CSV cleanup for files older than 24 hours (runs every 6 hours)
- [x] Test complete workflow with real Facebook data - ready for user testing
- [x] Revert to JSON API response parsing instead of CSV download
- [x] Update backend to fetch paginated JSON data from Facebook /insights endpoint
- [x] Update frontend to parse JSON response directly
- [x] Create mapJsonRowToProductInsightData for JSON data mapping
- [x] Fix "Invalid response from backend" error - added comprehensive error handling
- [x] Add better error logging to see actual backend response
- [x] Fix tRPC superjson wrapper - handle backendResult.json.data structure
- [x] Fix product name field mapping - use row.product_name
- [x] Fix content ID field mapping - use row.product_content_id
- [x] Fix brand field mapping - use row.product_brand
- [x] Fix category field mapping - use row.product_category
- [x] Verify correct field names from Facebook API response
- [x] Fix table display for Link Click CTR (%) - now uses inline_link_click_ctr
- [x] Fix table display for CVR (%) - now uses cvr field
- [x] Fix table display for CPM - now uses cpm field
- [x] Fix table display for Cost Per Link Click - now uses cost_per_inline_link_click
- [x] Fix catalog_purchases to use converted_product_omni_purchase field instead of actions:omni_purchase
- [x] Extract and analyze catalog batch API implementation from uploaded file
- [x] Create backend endpoint for catalog batch API integration (catalog.fetchProducts, catalog.batchUpdate)
- [x] Add UI button/modal for uploading selected items to catalog
- [x] Add CatalogUploadModal component with catalog ID, access token, and tag inputs
- [x] Implement batch upload handler with merge logic for labels and tags
- [ ] Test catalog batch upload with real data
- [x] Verify catalog token and ads report token are completely separate
- [x] Update modal description to clarify different token requirements
- [x] Update access token label to "Catalog Access Token" for clarity
- [x] Fix pagination to fetch all items beyond 5000 limit - removed maxPages restriction
- [x] Replace tags input with Custom Number 0-4 dropdown
- [x] Remove tags field from catalog update logic
- [x] Update backend to handle custom number field selection
- [x] Show initial results after first 1000 rows are loaded
- [x] Continue fetching remaining data in background
- [x] Track loaded row count with state variable
- [x] Add progress bar UI component showing current row count and percentage

## New Enhancements
- [x] Optimize product level reporting for faster data fetching (increased batch size from 100 to 500)
- [x] Add user_tokens table to database schema for storing access tokens
- [x] Create backend endpoints to save/retrieve user tokens (tokens.save, tokens.get, tokens.delete)
- [x] Update frontend to save Ads Management access token to database
- [x] Update frontend to save Facebook Catalog access token to database
- [x] Pre-fill forms with saved tokens on page load
- [x] Show catalog update verification results after batch API completes (fetches sample products)
- [x] Set up weekly scheduled task for automatic report generation (every Monday at 9 AM)

## Settings Page
- [x] Create Settings page component with token management forms
- [x] Add Ads Report Token input with save/delete functionality
- [x] Add Catalog Token input with save/delete functionality
- [x] Add navigation menu to header with Settings button
- [x] Add routing for /settings in App.tsx
- [x] Add "Back to Home" button on Settings page

## Token Loading Fix
- [x] Fix tokens saved in Settings not appearing in Home page forms
- [x] Ensure ReportConfigForm receives saved token and account ID (added useEffect to update form)
- [x] Ensure CatalogUploadModal receives saved catalog token and ID (fixed useEffect to always update)

## Filter Defaults in Settings
- [x] Add minSpend and minCTR columns to user_tokens table
- [x] Update backend to save/retrieve filter defaults
- [x] Add Min Spend and Min CTR inputs to Settings page
- [x] Update Home page to load and apply saved filter defaults

## Performance Optimization
- [x] Increase Facebook API batch size from 500 to 1000 items per request for faster data fetching (2x improvement)

## Bug Fixes
- [x] Fix 500 error when requesting 3000 items per batch - reduced to 1000 items (Facebook's safe limit)

## Reliability Improvements
- [x] Add retry logic with exponential backoff to handle network timeouts and temporary Facebook API failures (3 retries with 2s, 4s, 8s delays)

## Catalog Batch API Improvements
- [x] Set allow_upsert to false in catalog batch API calls
- [x] Add check_batch_request_status endpoint to track upload progress
- [x] Implement parallel batch uploads (send up to 5 batches simultaneously for faster processing)
- [x] Update UI to show batch upload status and progress (displays invalid entries count)

## Bug Fixes - Settings
- [x] Fix Min Spend and Min CTR not being saved to database (verified working - values persist and auto-load)

## Bug Fixes - Catalog Upload
- [x] Fix socket hang up error during catalog product fetching by adding retry logic (3 retries with 1s, 2s, 4s delays + 30s timeout)

## Catalog Upload Changes
- [x] Change batch uploads from parallel to sequential processing (one batch at a time)
- [x] Optimize batch size to 2000 items per batch (balanced for reliability)

## Bug Fixes - Catalog Batch Update
- [x] Fix 400 error by reducing batch size from 3000 to 2000 items (more stable for Facebook API)

## Batch Size Configuration
- [x] Add batchSize column to user_tokens table
- [x] Update backend to save/retrieve batch size preference
- [x] Add batch size input (1000-2000) to Settings page
- [x] Update Home page to use saved batch size preference

## Bug Fixes - Catalog Batch Update Format
- [x] Fix 400 error by correcting batch update request format to match Facebook API spec (form data + id field)

## Catalog Batch API Review
- [x] Review and update API implementation to match Facebook's official specification
- [x] Ensure proper form data format with all required parameters
- [x] Verify batch size limits (max 5000, recommended 3000)
- [x] Add helper functions for creating UPDATE/DELETE/CREATE requests
- [x] Improve error logging and response handling

## Bug Fixes - Database Schema
- [x] Fix 500 error: batchSize column missing in user_tokens table - added column manually

## Bug Fixes - Published Site
- [ ] Fix "Service Unavailable" error when saving user settings on published website (works on preview but not published)

## Settings Page Changes
- [x] Remove batch size limit (1000-2000) from Settings page to allow any value

- [x] Completely remove batch size input field from Settings page

## Bug Fixes - Deployment
- [x] Fix deployment failure - bind to 0.0.0.0 and use PORT env directly in production

## Batch Status Polling Feature
- [x] Add checkBatchStatus function to catalog.ts using check_batch_request_status API (already exists)
- [x] Add backend endpoint for polling batch status with handle (already exists at catalog.checkBatchStatus)
- [x] Update frontend to poll batch status and display real-time progress during uploads
- [x] Show batch processing status (pending/processing/finished) with error details

## Bug Fixes - Published Site Database
- [x] Fix 500 error on published website - removed batchSize validation constraint and synced database schema

## Bug Fixes - Truncated Response
- [x] Fix "Unexpected end of JSON input" error on published website - server response being truncated or empty
- [x] Debug production database connection issue causing 500 errors on tokens.get/tokens.save
- [x] Root cause: CSV cleanup scheduled task with file system operations caused server crash in production
- [x] Solution: Removed CSV cleanup from server startup (see KNOWLEDGE.md for details)

## Bug Fixes - Catalog API 502 Error
- [x] Fix catalog.fetchProducts API returning 502 error on published website
- [x] Investigate timeout/performance issues with batch product fetching
- [x] Solution: Split large requests into smaller batches (25 IDs per batch), increased timeout to 60s, added concurrency limit

## Performance Optimization - Catalog Batch API
- [x] Optimize batch update to use 3000 items per request
- [x] Enable 5 concurrent parallel requests for maximum throughput
- [x] Target: ~15,000 items per batch cycle
- [x] Added automatic batch splitting and parallel processing
- [x] Added progress logging with items/sec metrics

## Feature - Catalog Batch History
- [x] Create database table for batch operation history (catalog_batch_history)
- [x] Fields: date, total count, updated fields, status, errors, warnings, handles, duration
- [x] Update batchUpdate router to save records automatically
- [x] Create frontend UI to display batch history (/batch-history page)
- [x] Add History button to main page header
- [x] Track updateCriteria in batch operations
- [x] Add summary statistics (total operations, items processed, success/failed counts)

## Feature - Background Batch Processing
- [x] Create batch_jobs database table for job queue
- [x] Implement background job processor that runs independently (job-processor.ts)
- [x] Create API endpoints: jobs.submit, jobs.getStatus, jobs.getMyJobs, jobs.cancel
- [x] Update frontend to submit jobs and poll progress (BackgroundJobProgress component)
- [x] Handle browser close - jobs continue in background
- [x] Added real-time progress tracking with 2-second polling
- [x] Added job cancellation support

## Feature - Background Report Generation with Weekly Schedule
- [x] Create saved_reports database table for storing generated reports
- [x] Create scheduled_jobs database table for recurring job schedules
- [x] Implement report generation logic in job processor (report-generator.ts)
- [x] Store report data in database after generation
- [x] Create weekly schedule system for automatic report generation (scheduler.ts)
- [x] Add API endpoints for viewing saved reports (reports.generate, reports.get, reports.getMyReports, reports.delete)
- [x] Update frontend to submit report generation jobs
- [x] Create Reports page to view historical reports (/saved-reports)
- [x] Create Schedules page for schedule configuration (/schedules)
- [x] Add navigation links to Home page header (Reports, Schedules)
