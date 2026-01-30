import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AsyncJobStatus, ProductInsightData, ReportConfig, FilterCondition } from '../types';
import { facebookApiService } from '@/lib/api';
import { ReportConfigForm } from '@/components/ReportConfigForm';
import { StatusBadge } from '@/components/StatusBadge';
import { InsightsCharts } from '@/components/InsightsCharts';
import { ProductTable } from '@/components/ProductTable';
import { FilterBar } from '@/components/FilterBar';
import { SavedPresets } from '@/components/SavedPresets';
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
  const [error, setError] = useState<string | null>(null);
  
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
      setError(null);
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
      setError(err.message || "Failed to start report run. Please try again.");
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
           setError(`Job ended with status: ${status.async_status}`);
           toast.error(`Job failed: ${status.async_status}`);
        }

      } catch (err: any) {
        // Stop polling on critical errors
        if (err.message) {
           if (pollInterval.current) clearInterval(pollInterval.current);
           setError(`Error: ${err.message}`);
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
      // 3. Get Data with progressive loading
      const results = await facebookApiService.getReportResults(id, token, (interimData) => {
        // Update state progressively as chunks arrive
        setReportData(interimData);
      });
      // Ensure final state is set
      setReportData(results.data);
      toast.success(`Loaded ${results.data.length} records`);
    } catch (err: any) {
      setError(err.message || "Failed to fetch final report results.");
      toast.error("Failed to fetch results");
    } finally {
      setIsFetchingMore(false);
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

  // Preview Data (Limit table display to 500)
  const previewData = useMemo(() => {
    if (!filteredData) return [];
    return filteredData.slice(0, 500);
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
            
            {/* Saved Presets */}
            <SavedPresets 
              currentFilters={activeFilters} 
              onLoadPreset={(filters) => {
                setActiveFilters(filters);
                toast.success("Filters applied");
              }} 
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
                  {(jobStatus === AsyncJobStatus.STARTED || jobStatus === AsyncJobStatus.RUNNING) && (
                    <div className="space-y-2">
                      <div className="w-full bg-secondary h-1 mt-2">
                        <div 
                          className="bg-primary h-1 transition-all duration-500 ease-out" 
                          style={{ width: `${jobPercent}%` }}
                        ></div>
                      </div>
                      <p className="text-[10px] text-muted-foreground italic">
                        {jobPercent === 0 ? "Initializing report on Meta servers..." : `Processing: ${jobPercent}%`}
                      </p>
                      <Button 
                        variant="destructive" 
                        size="sm" 
                        className="w-full h-7 text-xs mt-2 rounded-none"
                        onClick={handleStopReport}
                      >
                        Stop Generation
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Documentation Note */}
            <div className="bg-blue-50/50 p-4 border-l-2 border-blue-500 text-xs text-blue-900 space-y-2">
              <h4 className="font-bold uppercase tracking-wide text-blue-700">API Constraints</h4>
              <ul className="list-disc list-inside space-y-1 opacity-80">
                <li>Max 60 queries / 6 hours</li>
                <li>Limit: 10M products</li>
                <li>Async polling required</li>
              </ul>
            </div>
          </div>

          {/* Right Content: Data & Viz (9 cols) */}
          <div className="lg:col-span-9">
            {!filteredData && !error && (
              <div className="h-[400px] flex flex-col items-center justify-center text-center p-8 border border-dashed border-border bg-secondary/10">
                <div className="bg-secondary p-4 rounded-full mb-4">
                  <BarChart2 className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-bold text-foreground">Ready to Analyze</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                  Configure your report parameters on the left to generate real-time product insights.
                </p>
              </div>
            )}

            {error && (
              <div className="bg-destructive/5 border-l-4 border-destructive text-destructive px-6 py-4 mb-6">
                <h3 className="font-bold text-sm uppercase tracking-wide mb-1">Error Encountered</h3>
                <p className="text-sm font-mono">{error}</p>
              </div>
            )}

            {filteredData && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                
                {/* Results Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-border">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Report Results</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Analysis from <span className="font-mono text-foreground">{filteredData[0]?.date_start}</span> to <span className="font-mono text-foreground">{filteredData[0]?.date_stop}</span>
                    </p>
                  </div>
                  <Button 
                    onClick={handleDownloadXlsx}
                    variant="outline"
                    className="rounded-none border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors uppercase text-xs font-bold tracking-wide h-10 px-4"
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Export XLSX
                  </Button>
                </div>

                {/* KPI Cards - Big Typography */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border">
                  <div className="bg-background p-6 hover:bg-secondary/20 transition-colors">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Total Spend</p>
                    <p className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
                      ${filteredData.reduce((acc, curr) => acc + curr.spend, 0).toLocaleString(undefined, {maximumFractionDigits: 0})}
                    </p>
                  </div>
                  <div className="bg-background p-6 hover:bg-secondary/20 transition-colors">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Total Clicks</p>
                    <p className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
                      {filteredData.reduce((acc, curr) => acc + curr.clicks, 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-background p-6 hover:bg-secondary/20 transition-colors">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Avg. CTR</p>
                    <p className="text-2xl lg:text-3xl font-bold text-emerald-600 tracking-tight">
                      {(filteredData.length > 0 ? filteredData.reduce((acc, curr) => acc + curr.ctr, 0) / filteredData.length : 0).toFixed(2)}%
                    </p>
                  </div>
                  <div className="bg-background p-6 hover:bg-secondary/20 transition-colors">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Purchases</p>
                    <p className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
                      {filteredData.reduce((acc, curr) => acc + curr.purchases, 0).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Filter Bar */}
                <FilterBar activeFilters={activeFilters} onFiltersChange={setActiveFilters} />

                {/* Charts */}
                <InsightsCharts data={filteredData} />

                {/* Data Table */}
                <ProductTable data={previewData} totalCount={filteredData.length} />

                {/* Loading State for More Data */}
                {isFetchingMore && (
                  <div className="fixed bottom-8 right-8 bg-background border border-border shadow-2xl p-4 flex items-center space-x-3 z-50 animate-in slide-in-from-right">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    <div>
                      <p className="text-sm font-bold">Fetching more data...</p>
                      <p className="text-xs text-muted-foreground">{reportData?.length.toLocaleString()} rows loaded</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
