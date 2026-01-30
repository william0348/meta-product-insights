import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AsyncJobStatus, ProductInsightData, ReportConfig, FilterCondition } from '../types';
import { facebookApiService } from '@/lib/api';
import { ReportConfigForm } from '@/components/ReportConfigForm';
import { StatusBadge } from '@/components/StatusBadge';
import { InsightsCharts } from '@/components/InsightsCharts';
import { ProductTable } from '@/components/ProductTable';
import { FilterBar } from '@/components/FilterBar';

import { LayoutDashboard, Download, ShieldCheck, FileSpreadsheet, Loader2, BarChart2 } from 'lucide-react';
import { utils, writeFile } from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

export default function Home() {
  // State for the Async Job Flow
  const [reportId, setReportId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<AsyncJobStatus>(AsyncJobStatus.NOT_STARTED);
  const [jobPercent, setJobPercent] = useState<number>(0);
  const [reportData, setReportData] = useState<ProductInsightData[] | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [apiError, setApiError] = useState<string | null>(null);
  
  // Filtering
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>([]);

  // Store the access token used for the current job so we can use it during polling
  const [activeAccessToken, setActiveAccessToken] = useState<string | undefined>(undefined);

  // Poll Ref to clear intervals
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleStartReport = async (config: ReportConfig) => {
    try {
      // Reset State
      setReportId(null);
      setJobStatus(AsyncJobStatus.NOT_STARTED);
      setJobPercent(0);
      setReportData(null);
      setApiError(null);
      setIsRequesting(true);
      setActiveAccessToken(config.accessToken);
      // We do not reset filters automatically, user might want to keep them

      // 1. Create Report Run
      const response = await facebookApiService.createReportRun(
        config.accountId, 
        config.dateStart, 
        config.dateEnd,
        config.accessToken,
        config.level,
        config.breakdown // Pass the selected breakdown
      );
      
      setReportId(response.report_run_id);
      setIsRequesting(false);
      toast.success("Report run initiated successfully");

      // Start Polling
      startPolling(response.report_run_id, config.accessToken);

    } catch (err: any) {
      setApiError(err.message || "Failed to start report run. Please try again.");
      toast.error("Failed to start report run");
      setIsRequesting(false);
    }
  };

  const startPolling = (id: string, token?: string) => {
    if (pollInterval.current) clearInterval(pollInterval.current);

    pollInterval.current = setInterval(async () => {
      try {
        // 2. Poll Status
        const status = await facebookApiService.pollReportStatus(id, token);
        setJobStatus(status.async_status);
        setJobPercent(status.async_percent_completion);

        if (status.async_status === AsyncJobStatus.COMPLETED) {
           if (pollInterval.current) clearInterval(pollInterval.current);
           toast.success("Report generation completed. Fetching data...");
           fetchResults(id, token);
        } else if (status.async_status === AsyncJobStatus.FAILED || status.async_status === AsyncJobStatus.SKIPPED) {
           if (pollInterval.current) clearInterval(pollInterval.current);
           setApiError(`Job ended with status: ${status.async_status}`);
           toast.error(`Job failed: ${status.async_status}`);
        }

      } catch (err: any) {
        // Stop polling on critical errors
        if (err.message) {
           if (pollInterval.current) clearInterval(pollInterval.current);
           setApiError(`Error: ${err.message}`);
           toast.error("Polling error occurred");
        }
        console.error("Polling error", err);
      }
    }, 2000); // Poll every 2s
  };

  const handleStopReport = () => {
    if (pollInterval.current) clearInterval(pollInterval.current);
    setJobStatus(AsyncJobStatus.NOT_STARTED);
    setIsRequesting(false);
    toast.info("Report generation stopped by user");
  };

  const fetchResults = async (id: string, token?: string) => {
    try {
      setIsFetchingMore(true);
      setDownloadProgress(0);
      // 3. Download and Parse CSV with progress tracking
      const results = await facebookApiService.downloadReportCSV(
        id, 
        token, 
        (parsedData) => {
          setReportData(parsedData); 
        },
        (progress) => {
          setDownloadProgress(progress);
        }
      );
      
      // Ensure final state is set
      console.log('[fetchResults] CSV parsed successfully:', results.data.length, 'records');
      console.log('[fetchResults] First 3 records:', results.data.slice(0, 3));
      setReportData(results.data);
      setDownloadProgress(100);
      toast.success(`Loaded all ${results.data.length} records`);
    } catch (err: any) {
      setApiError(err.message || "Failed to fetch final report results.");
      toast.error("Failed to fetch results");
    } finally {
      setIsFetchingMore(false);
      setDownloadProgress(0);
      setJobStatus(AsyncJobStatus.COMPLETED);
    }
  };

  // Filter Logic
  const filteredData = useMemo(() => {
    if (!reportData) return null;
    if (activeFilters.length === 0) return reportData;

    return reportData.filter(item => {
      // AND Logic: Must pass all filters
      return activeFilters.every(filter => {
        const itemValue = item[filter.field];
        // Only filter numeric values for now as per current list
        if (typeof itemValue !== 'number') return true;

        switch (filter.operator) {
          case '>': return itemValue > filter.value;
          case '<': return itemValue < filter.value;
          case '>=': return itemValue >= filter.value;
          case '<=': return itemValue <= filter.value;
          case '=': return itemValue === filter.value;
          default: return true;
        }
      });
    });
  }, [reportData, activeFilters]);

  // Preview Data (Limit table display to 100 as requested)
  const previewData = useMemo(() => {
    if (!filteredData) return [];
    return filteredData.slice(0, 100);
  }, [filteredData]);

  const handleDownloadXlsx = () => {
    if (!filteredData) return;

    // Format data for Excel mapping all requested fields (Uses full filtered list)
    const exportData = filteredData.map(row => ({
      'Product Name': row.product_name,
      'Content ID': row.product_retailer_id,
      'Brand': row.product_brand || 'N/A',
      'Impressions': row.impressions,
      'Spend': row.spend,
      'Link Clicks': row.link_clicks,
      'Link Click CTR (%)': row.inline_link_click_ctr || 0,
      'CVR (%)': row.cvr || 0,
      'CPM': row.cpm,
      'Cost Per Link Click': row.cost_per_inline_link_click || 0,
      'Ad Purchases (Omni)': row.purchases,
      'Adds to Cart (Omni)': row.adds_to_cart || 0,
      'Catalog Purchases': row.catalog_purchases || 0,
      'Product Set Purchases': row.product_set_purchases || 0,
      'Product Views': row.product_views || 0,
    }));

    // Create Worksheet and Workbook
    const ws = utils.json_to_sheet(exportData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Product Insights");

    // Save File
    writeFile(wb, `meta_product_insights_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Excel file downloaded");
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Toaster position="top-right" />
      
      {/* Swiss Style Header: Clean, minimal, authoritative */}
      <header className="border-b border-border bg-background sticky top-0 z-20">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="bg-primary text-primary-foreground w-8 h-8 flex items-center justify-center font-bold text-lg">
              M
            </div>
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest">Meta Product Insights</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Explorer v2.0</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex items-center text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-3 py-1 border border-emerald-100">
              <ShieldCheck className="w-3 h-3 mr-1.5" />
              Secure API Connection
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="flex-1 container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Sidebar: Controls (3 cols) */}
          <div className="lg:col-span-3 space-y-6">
            <ReportConfigForm 
              onSubmit={handleStartReport} 
              isProcessing={isRequesting || (jobStatus !== AsyncJobStatus.NOT_STARTED && jobStatus !== AsyncJobStatus.COMPLETED && jobStatus !== AsyncJobStatus.FAILED)} 
              defaultToken="EAANLrF5ZBRkEBPJSaKYUM1MOEUfxzNNkC7YiEauZCJNZBdTHMlh6BrAfOR0dY6O3kchrrMnCDHHo6E8K6R3s3abZBIFEwxS6TeuQo4g0g3kIVGYi4LIbwb4olq9NgyvZAeotDnwNxX0i4R6nTq3c477HkvTEsJu7B3IZChjYZCjiZAYW9L1dAOqK7tTjUaeDsaoZAqMfxBDKv1EfNO4id"
            />
            
            {/* Job Status Card */}
            {(reportId || isRequesting) && (
              <Card className="border-0 shadow-none bg-background border border-border rounded-none">
                <CardContent className="p-4 space-y-4">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">Status</span>
                    <div className="flex justify-between items-center">
                      <StatusBadge status={jobStatus} percent={jobPercent} />
                    </div>
                  </div>

                  {reportId && (
                    <div>
                      <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">Report ID</span>
                      <code className="block bg-secondary p-1.5 text-[10px] font-mono break-all text-secondary-foreground border border-border/50">
                        {reportId}
                      </code>
                    </div>
                  )}

                  {/* Progress Bar - Swiss Style (Sharp, no rounded corners) */}
                  {jobStatus === AsyncJobStatus.RUNNING && (
                    <div className="h-1 w-full bg-secondary mt-2">
                      <div 
                        className="h-full bg-primary transition-all duration-500 ease-out" 
                        style={{ width: `${jobPercent}%` }}
                      />
                    </div>
                  )}
                  
                  {/* Download Progress Indicator */}
                  {isFetchingMore && downloadProgress > 0 && (
                    <div>
                      <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                        Downloading CSV: {downloadProgress}%
                      </span>
                      <div className="h-1 w-full bg-secondary mt-2">
                        <div 
                          className="h-full bg-emerald-600 transition-all duration-300 ease-out" 
                          style={{ width: `${downloadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Content: Data & Charts (9 cols) */}
          <div className="lg:col-span-9 space-y-8">
            
            {/* Error Message */}
            {apiError && (
              <div className="bg-destructive/10 border border-destructive/20 p-4 text-destructive text-sm font-medium">
                {apiError}
              </div>
            )}

            {/* Empty State */}
            {!reportData && !isRequesting && !apiError && (
              <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground border border-dashed border-border/50 bg-secondary/10">
                <BarChart2 className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-sm font-medium uppercase tracking-widest">Ready to Analyze</p>
                <p className="text-xs mt-2 max-w-xs text-center opacity-70">
                  Configure your report parameters on the left to generate real-time product insights.
                </p>
              </div>
            )}

            {/* Loading State */}
            {isRequesting && !reportData && !apiError && (
              <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground border border-dashed border-border/50 bg-secondary/10">
                <Loader2 className="w-8 h-8 animate-spin mb-4 opacity-50" />
                <p className="text-xs font-medium uppercase tracking-widest animate-pulse">Connecting to Meta API...</p>
              </div>
            )}

            {/* Data View */}
            {reportData && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
                
                {/* Filter Bar */}
                <FilterBar 
                  activeFilters={activeFilters} 
                  onFiltersChange={setActiveFilters} 
                />

                {/* Filter Summary & Actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <LayoutDashboard className="w-4 h-4 text-primary" />
                    <h2 className="text-lg font-bold uppercase tracking-tight">Product Performance</h2>
                    <span className="text-xs font-mono text-muted-foreground ml-2 bg-secondary px-2 py-0.5">
                      Showing {filteredData ? filteredData.length : 0} of {reportData.length} items
                    </span>
                  </div>
                  
                  <div className="flex space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleDownloadXlsx}
                      className="h-8 text-xs uppercase font-bold tracking-wide rounded-none border-border hover:bg-secondary"
                    >
                      <FileSpreadsheet className="w-3 h-3 mr-2" />
                      Download Excel
                    </Button>
                  </div>
                </div>

                {/* Charts */}
                <InsightsCharts data={previewData} />

                {/* Data Table */}
                <ProductTable data={previewData} totalCount={filteredData ? filteredData.length : 0} />
                
                {filteredData && filteredData.length > 100 && (
                   <p className="text-center text-xs text-muted-foreground py-4 italic">
                     Table preview limited to top 100 items. Download Excel to view full filtered dataset.
                   </p>
                )}
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
