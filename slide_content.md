# Meta Product Insights Explorer — How It Works & How to Use It

Visual style: Clean, modern, professional. Use a white/light background with Meta blue (#0668E1) as the primary accent color and dark charcoal (#1C1E21) for text. Swiss-inspired typography with generous whitespace.

---

## Slide 1: Title Slide
**Heading:** Meta Product Insights Explorer
**Subheading:** Automate Product-Level Ad Reporting & Catalog Management
**Details:** A powerful internal tool that connects directly to the Meta Marketing API to pull product-level performance data, visualize insights, and batch-update your Facebook Product Catalog — all from one unified dashboard.

---

## Slide 2: The Problem This Tool Solves
**Heading:** Manual product reporting wastes 5+ hours per week
**Key Points:**
- Extracting product-level performance data from Meta Ads Manager requires multiple manual exports and complex pivot tables
- Identifying top-performing and underperforming products across 70,000+ SKUs is nearly impossible without automation
- Updating catalog labels (custom_label_4, custom_number fields) for audience segmentation requires tedious manual CSV uploads
- No built-in way to schedule recurring reports or automate catalog updates based on performance thresholds
- Teams need real-time visibility into product metrics like CTR, CVR, ROAS, and spend at the individual product level

---

## Slide 3: System Architecture Overview
**Heading:** End-to-end pipeline from Meta API to actionable insights
**Key Points:**
- Frontend: React 19 + Tailwind CSS 4 dashboard with real-time status updates and interactive charts (Recharts)
- Backend: Node.js + Express + tRPC for type-safe API communication with full-stack TypeScript
- Data Pipeline: Asynchronous report generation via Meta Marketing API → paginated data fetching → S3 storage → database caching
- Catalog Integration: Facebook Catalog Batch API with 5,000 items/request, 5 concurrent requests for ~25,000 items per 5 seconds throughput
- Scheduler: Built-in cron-based job scheduler for automated weekly/daily report generation and catalog updates

---

## Slide 4: Core Feature — Real-Time Report Generation
**Heading:** Generate product insights reports in 3 clicks
**Key Points:**
- Step 1: Enter your Access Token and Ad Account ID (saved securely for future sessions)
- Step 2: Select date range, reporting level (Account/Campaign/Ad Set), and breakdown (Product ID/Product Group)
- Step 3: Optionally set API-level filters (minimum spend, minimum CTR) to reduce data volume at source
- Click "Generate Report" — the system creates an async report run via Meta API, polls for completion, then fetches all paginated results automatically
- Real-time progress tracking: status badge shows Job Started → Running (with %) → Completed, with live row count updates as data loads

---

## Slide 5: Data Visualization & Analysis
**Heading:** Interactive charts and tables reveal product performance patterns instantly
**Key Points:**
- Summary Metrics Dashboard: Total products, total spend, average CTR, and conversion rate displayed as KPI cards at the top
- Performance Charts: Bar charts for top products by spend, scatter plots for CTR vs. CVR correlation, and distribution histograms
- Product Data Table: Sortable columns showing Product Name, Content ID, Brand, Impressions, Spend, Link Clicks, CTR, CVR, CPM, Purchases, ROAS, and more
- Client-Side Filtering: Add multiple filter conditions (e.g., Spend > 100, CTR >= 2%) with AND logic — filters apply instantly without re-fetching data
- Table preview shows top 100 rows for performance; full filtered dataset available via one-click Excel download

---

## Slide 6: Catalog Batch Update — Automate Product Labeling
**Heading:** Update 70,000+ catalog products in minutes, not hours
**Key Points:**
- After generating a report and applying filters, click "Upload to Catalog" to batch-update matching products in your Facebook Product Catalog
- Supported update fields: custom_label_4 (merge mode — appends new labels without overwriting existing ones) and custom_number_0 through custom_number_4 (overwrite mode)
- Background job processing: Updates run server-side so you can close the browser — the job continues automatically
- Throughput: 5,000 items per API request × 5 concurrent batches = ~25,000 products processed every 5 seconds
- Full audit trail: Every batch update is logged with timestamp, product count, success/error counts, and update criteria in the Batch History page

---

## Slide 7: Scheduled Automation — Set It and Forget It
**Heading:** Automate weekly reports and catalog updates with built-in scheduling
**Key Points:**
- Create scheduled jobs from the Schedules page: choose job type (Report Only, Catalog Update Only, or Report + Catalog combined)
- Configure schedule: select day of week, hour, and minute — jobs run automatically via server-side cron
- Date range options: Last 7 Days, Last 14 Days, Last 30 Days, or Last 60 Days — dates are calculated dynamically at execution time
- Each scheduled run generates a full report, saves it to S3, and optionally applies catalog updates — all tracked in the Reports/History page
- Enable/disable schedules with a single toggle; duplicate existing schedules to create variations quickly

---

## Slide 8: Reports & History — Full Audit Trail
**Heading:** Every report and update is tracked and downloadable
**Key Points:**
- The Reports page shows all completed report runs with date range, product count, file size, and download links
- Each report's data is cached in the database — revisiting a report loads instantly from cache without re-fetching from Meta API
- Batch History tab shows all catalog update operations with detailed status: products processed, success count, error count, and update criteria
- Schedule History shows each automated run with execution time, duration, status (success/failed/retrying), and error details if any
- Download any historical report as Excel (.xlsx) with all product metrics for offline analysis

---

## Slide 9: Settings & Security
**Heading:** Secure token management with encrypted storage
**Key Points:**
- Settings page allows you to save and manage your Meta API tokens (Ads Management and Catalog Management) separately
- Tokens are encrypted and stored server-side — they auto-populate in forms so you don't need to re-enter them each time
- Ad Account ID and Catalog ID are saved alongside tokens for quick access
- Default filter preferences (minimum spend, minimum CTR) can be saved globally and applied automatically to new reports
- Token visibility toggle (show/hide) prevents accidental exposure; delete buttons allow clean token rotation

---

## Slide 10: Quick Start Guide — Get Running in 5 Minutes
**Heading:** From zero to your first product insights report in 5 minutes
**Key Points:**
- Step 1: Open the app and navigate to Settings — enter your Meta Ads API Access Token and Ad Account ID, then click Save
- Step 2: (Optional) Enter your Catalog Access Token and Catalog ID if you plan to use batch catalog updates
- Step 3: Go to the Home dashboard — your saved credentials auto-populate. Select a date range and click "Generate Report"
- Step 4: Once the report completes, explore the charts, apply filters, and download Excel. Use "Upload to Catalog" to update product labels
- Step 5: Set up a recurring schedule on the Schedules page to automate the entire workflow weekly

---

## Slide 11: Key Metrics Tracked
**Heading:** 30+ product-level metrics captured from Meta Marketing API
**Key Points:**
- Performance: Impressions, Clicks, Link Clicks, Outbound Clicks, CTR, Link Click CTR, Outbound CTR
- Cost: Spend, CPM, CPC, Cost per Link Click, Cost per Outbound Click, Cost per Result
- Conversions: Ad Purchases (Omni), Website Purchases, Mobile App Purchases, Offline Purchases, Catalog Purchases, Product Set Purchases
- Revenue: Purchase Value, Average Purchase Value, Purchase ROAS, Website ROAS, Mobile App ROAS
- Engagement: Adds to Cart, Website Adds to Cart, Mobile App Adds to Cart, Product Views, Total Card Views

---

## Slide 12: Summary & Next Steps
**Heading:** Transform raw Meta ad data into automated product intelligence
**Key Points:**
- Meta Product Insights Explorer eliminates manual reporting by automating the entire pipeline: data extraction → analysis → catalog updates
- The tool handles datasets of 70,000+ products with background processing, pagination, and retry logic for reliability
- Scheduled automation ensures your team always has fresh, up-to-date product performance data without manual intervention
- Next steps: Set up your first scheduled job, define performance thresholds for catalog labeling, and share reports with your team
- For support or feature requests, contact the development team or submit feedback through the app
