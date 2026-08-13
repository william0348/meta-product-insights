import React, { useState, useEffect, useMemo } from 'react';
import { AsyncJobStatus, ProductInsightData, ReportConfig, FilterCondition } from '../types';
import { facebookApiService } from '@/lib/api';
import { mapJsonRowToProductInsightData } from '@/lib/facebook-json-mapper';
import { ReportConfigForm } from '@/components/ReportConfigForm';
import { StatusBadge } from '@/components/StatusBadge';
import { InsightsCharts } from '@/components/InsightsCharts';
import { ProductTable } from '@/components/ProductTable';
import { FilterBar } from '@/components/FilterBar';
import { SummaryMetrics } from '@/components/SummaryMetrics';
import { CatalogUploadModal, CatalogUploadConfig } from '@/components/CatalogUploadModal';
import { BackgroundJobProgress } from '@/components/BackgroundJobProgress';
import { apiClient } from '@/lib/api-client';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useReportState } from '@/contexts/ReportContext';

import { LayoutDashboard, Download, ShieldCheck, FileSpreadsheet, Loader2, BarChart2, Upload, Settings, FileText, Calendar, BookOpen, Trophy, ChevronDown, Eye } from 'lucide-react';
import { useLocation } from 'wouter';
import { utils, writeFile } from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

export default function Home() {
  const [, setLocation] = useLocation();

  // Use persistent report state from context (survives navigation)
  const {
    reportId, setReportId,
    jobStatus, setJobStatus,
    jobPercent, setJobPercent,
    reportData, setReportData,
    isRequesting, setIsRequesting,
    isFetchingMore, setIsFetchingMore,
    downloadProgress, setDownloadProgress,
    loadedRowCount, setLoadedRowCount,
    isLoadingComplete, setIsLoadingComplete,
    apiError, setApiError,
    activeFilters, setActiveFilters,
    activeAccessToken, setActiveAccessToken,
    catalogModalOpen, setCatalogModalOpen,
    catalogUploading, setCatalogUploading,
    activeJobId, setActiveJobId,
    pollIntervalRef,
  } = useReportState();

  // Refilter state
  const [refilterMinSpend, setRefilterMinSpend] = useState('');
  const [refilterMinCTR, setRefilterMinCTR] = useState('');
  const [refilterMaxSpend, setRefilterMaxSpend] = useState('');
  const [refilterMaxCVR, setRefilterMaxCVR] = useState('');
  const [refilterMaxResults, setRefilterMaxResults] = useState('50000');
  const [isRefiltering, setIsRefiltering] = useState(false);
  const [lastReportRunId, setLastReportRunId] = useState<string | null>(null);

  const handleRefilter = async () => {
    if (!lastReportRunId) return;
    setIsRefiltering(true);
    try {
      const result = await apiClient.facebook.refilter({
        reportRunId: lastReportRunId,
        minSpend: refilterMinSpend || undefined,
        minCTR: refilterMinCTR || undefined,
        maxSpend: refilterMaxSpend || undefined,
        maxCVR: refilterMaxCVR || undefined,
        maxResults: refilterMaxResults ? parseInt(refilterMaxResults) : undefined,
      });
      const mapped = result.data.map(mapJsonRowToProductInsightData);
      setReportData(mapped);
      setLoadedRowCount(mapped.length);
      toast.success(`Refiltered: ${result.rawRecords.toLocaleString()} → ${result.totalFiltered.toLocaleString()} rows (showing ${mapped.length.toLocaleString()})`);
    } catch (err: any) {
      toast.error(err.message || 'Refilter failed');
    } finally {
      setIsRefiltering(false);
    }
  };

  // Job submission mutation
  const submitJobMutation = useMutation({
    mutationFn: (data: any) => apiClient.jobs.submit(data),
  });

  // Saved token state
  const [savedAdsToken, setSavedAdsToken] = useState<string | null>(null);
  const [savedCatalogToken, setSavedCatalogToken] = useState<string | null>(null);
  const [savedCatalogId, setSavedCatalogId] = useState<string | null>(null);
  const [savedAdAccountId, setSavedAdAccountId] = useState<string | null>(null);
  const [savedMinSpend, setSavedMinSpend] = useState<string | null>(null);
  const [savedMinCTR, setSavedMinCTR] = useState<string | null>(null);
  const [savedMaxSpend, setSavedMaxSpend] = useState<string | null>(null);
  const [savedMaxCVR, setSavedMaxCVR] = useState<string | null>(null);
  const [savedBatchSize, setSavedBatchSize] = useState<number>(2000);

  // Token mutations
  const saveTokenMutation = useMutation({
    mutationFn: (data: any) => apiClient.tokens.save(data),
  });

  // Load saved tokens on mount
  const { data: adsTokenData } = useQuery({
    queryKey: ['tokens', 'ads_management'],
    queryFn: () => apiClient.tokens.get('ads_management'),
    refetchOnWindowFocus: false,
  });
  const { data: catalogTokenData } = useQuery({
    queryKey: ['tokens', 'catalog_management'],
    queryFn: () => apiClient.tokens.get('catalog_management'),
    refetchOnWindowFocus: false,
  });

  // Update local state when token data loads
  useEffect(() => {
    if (adsTokenData?.found) {
      setSavedAdsToken(adsTokenData.accessToken);
      setSavedAdAccountId(adsTokenData.adAccountId);
      setSavedMinSpend(adsTokenData.minSpend);
      setSavedMinCTR(adsTokenData.minCTR);
      setSavedMaxSpend(adsTokenData.maxSpend);
      setSavedMaxCVR(adsTokenData.maxCVR);
    }
  }, [adsTokenData]);

  useEffect(() => {
    if (catalogTokenData?.found) {
      setSavedCatalogToken(catalogTokenData.accessToken);
      setSavedCatalogId(catalogTokenData.catalogId);
      setSavedBatchSize(catalogTokenData.batchSize || 2000);
    }
  }, [catalogTokenData]);

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

      // Store filters for Python-side filtering during download
      const pythonFilters = {
        minSpend: config.minSpend || undefined,
        minCTR: config.minCTR || undefined,
        maxSpend: config.maxSpend || undefined,
        maxCVR: config.maxCVR || undefined,
      };
      (window as any).__reportFilters = pythonFilters;

      // Create Report Run without API-level filters (filtering done in Python after download)
      const response = await facebookApiService.createReportRun(
        config.accountId,
        config.dateStart,
        config.dateEnd,
        config.accessToken,
        config.level,
        config.breakdown
      );

      setReportId(response.report_run_id);
      setLastReportRunId(response.report_run_id);
      setIsRequesting(false);
      toast.success("Report run initiated successfully");

      // Pre-fill refilter with current config
      setRefilterMinSpend(config.minSpend || '');
      setRefilterMinCTR(config.minCTR || '');
      setRefilterMaxSpend(config.maxSpend || '');
      setRefilterMaxCVR(config.maxCVR || '');

      // Save ads token to database for future use
      try {
        await saveTokenMutation.mutateAsync({
          tokenType: "ads_management",
          accessToken: config.accessToken,
          adAccountId: config.accountId,
          minSpend: config.minSpend || undefined,
          minCTR: config.minCTR || undefined,
          maxSpend: config.maxSpend || undefined,
          maxCVR: config.maxCVR || undefined,
        });
        setSavedAdsToken(config.accessToken);
        setSavedAdAccountId(config.accountId);
        setSavedMaxSpend(config.maxSpend || null);
        setSavedMaxCVR(config.maxCVR || null);
      } catch (e) {
        console.warn("[Token Save] Could not save ads token:", e);
      }

      // Start Polling
      startPolling(response.report_run_id, config.accessToken);

    } catch (err: any) {
      setApiError(err.message || "Failed to start report run. Please try again.");
      toast.error("Failed to start report run");
      setIsRequesting(false);
    }
  };

  const startPolling = (id: string, token?: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await facebookApiService.pollReportStatus(id, token);
        setJobStatus(status.async_status);
        setJobPercent(status.async_percent_completion);

        if (status.async_status === AsyncJobStatus.COMPLETED) {
           if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
           pollIntervalRef.current = null;
           toast.success("Report generation completed. Preparing download...");
           setTimeout(() => {
             fetchResults(id, token);
           }, 10000);
        } else if (status.async_status === AsyncJobStatus.FAILED || status.async_status === AsyncJobStatus.SKIPPED) {
           if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
           pollIntervalRef.current = null;
           setApiError(`Job ended with status: ${status.async_status}`);
           toast.error(`Job failed: ${status.async_status}`);
        }

      } catch (err: any) {
        if (err.message) {
           if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
           pollIntervalRef.current = null;
           setApiError(`Error: ${err.message}`);
           toast.error("Polling error occurred");
        }
        console.error("Polling error", err);
      }
    }, 2000);
  };

  const handleStopReport = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = null;
    setJobStatus(AsyncJobStatus.NOT_STARTED);
    setIsRequesting(false);
    toast.info("Report generation stopped by user");
  };

  const fetchResults = async (id: string, token?: string) => {
    try {
      setIsFetchingMore(true);
      setDownloadProgress(0);
      setLoadedRowCount(0);
      setIsLoadingComplete(false);

      let hasShownInitialResults = false;

      const filters = (window as any).__reportFilters || {};
      const results = await facebookApiService.downloadReportCSV(
        id,
        token,
        (parsedData) => {
          if (!hasShownInitialResults && parsedData.length >= 1000) {
            setReportData(parsedData);
            setLoadedRowCount(parsedData.length);
            setIsFetchingMore(false);
            toast.success(`Loaded first ${parsedData.length} rows. Continuing to load more...`);
            hasShownInitialResults = true;
          } else if (hasShownInitialResults) {
            setReportData(parsedData);
            setLoadedRowCount(parsedData.length);
          }
        },
        (progress) => {
          setDownloadProgress(progress);
        },
        filters
      );

      console.log('[fetchResults] CSV parsed successfully:', results.data.length, 'records');
      console.log('[fetchResults] First 3 records:', results.data.slice(0, 3));
      setReportData(results.data);
      setLoadedRowCount(results.data.length);
      setDownloadProgress(100);
      setIsLoadingComplete(true);
      toast.success(`Loaded all ${results.data.length} records`);
    } catch (err: any) {
      setApiError(err.message || "Failed to fetch final report results.");
      toast.error("Failed to fetch results");
    } finally {
      setIsFetchingMore(false);
      setIsLoadingComplete(true);
      setJobStatus(AsyncJobStatus.COMPLETED);
    }
  };

  // Filter Logic
  const filteredData = useMemo(() => {
    if (!reportData) return null;
    if (activeFilters.length === 0) return reportData;

    return reportData.filter(item => {
      return activeFilters.every(filter => {
        const itemValue = item[filter.field];
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

  // Preview Data (Limit table display to 100)
  const previewData = useMemo(() => {
    if (!filteredData) return [];
    return filteredData.slice(0, 100);
  }, [filteredData]);

  const handleDownloadXlsx = () => {
    if (!filteredData) return;

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

    const ws = utils.json_to_sheet(exportData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Product Insights");
    writeFile(wb, `meta_product_insights_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Excel file downloaded");
  };

  const handleDownloadTopConversion = (limit: number) => {
    if (!filteredData) return;

    // Sort by purchases (Ad Purchases Omni) descending, then take top N
    const sorted = [...filteredData].sort((a, b) => {
      const aPurchases = (a.purchases || 0) + (a.catalog_purchases || 0);
      const bPurchases = (b.purchases || 0) + (b.catalog_purchases || 0);
      return bPurchases - aPurchases;
    });
    const topData = sorted.slice(0, limit);

    const exportData = topData.map((row, idx) => ({
      'Rank': idx + 1,
      'Product Name': row.product_name,
      'Content ID': row.product_retailer_id,
      'Brand': row.product_brand || 'N/A',
      'Ad Purchases (Omni)': row.purchases,
      'Catalog Purchases': row.catalog_purchases || 0,
      'Total Conversions': (row.purchases || 0) + (row.catalog_purchases || 0),
      'Purchase Value': row.purchase_value || 0,
      'ROAS': row.purchase_roas || 0,
      'Spend': row.spend,
      'Impressions': row.impressions,
      'Link Clicks': row.link_clicks,
      'Link Click CTR (%)': row.inline_link_click_ctr || 0,
      'CVR (%)': row.cvr || 0,
      'CPM': row.cpm,
      'Cost Per Link Click': row.cost_per_inline_link_click || 0,
      'Adds to Cart (Omni)': row.adds_to_cart || 0,
      'Product Views': row.product_views || 0,
    }));

    const ws = utils.json_to_sheet(exportData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, `Top ${limit.toLocaleString()} Conversions`);
    writeFile(wb, `top_${limit}_conversions_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success(`Top ${limit.toLocaleString()} conversion products downloaded`);
  };

  // Catalog Upload Handler - Uses background job processing
  const handleCatalogUpload = async (config: CatalogUploadConfig) => {
    if (!filteredData || filteredData.length === 0) return;

    const retailerIds = filteredData
      .map(item => item.product_retailer_id)
      .filter(Boolean);

    if (retailerIds.length === 0) {
      toast.error('No valid product IDs found');
      return;
    }

    try {
      setCatalogUploading(true);

      const updateCriteria = {
        sourceField: config.customLabel4 ? 'custom_label_4' : undefined,
        targetField: config.customNumberValue ? config.customNumberField : undefined,
        condition: config.customLabel4 ? 'merge' : 'overwrite',
        description: [
          config.customLabel4 ? `Add label "${config.customLabel4}" to custom_label_4` : '',
          config.customNumberValue ? `Set ${config.customNumberField} = ${config.customNumberValue}` : '',
        ].filter(Boolean).join('; ') || 'Batch update',
      };

      const result = await submitJobMutation.mutateAsync({
        jobType: 'catalog_update',
        config: {
          catalogId: config.catalogId,
          accessToken: config.accessToken,
          retailerIds,
          customLabel4: config.customLabel4,
          customNumberField: config.customNumberField,
          customNumberValue: config.customNumberValue,
          updateCriteria,
        },
      });

      if (result.success && result.jobId) {
        setActiveJobId(result.jobId);
        toast.success(`Background job started! Processing ${retailerIds.length} products...`);
        toast.info('You can close this window - the job will continue in the background.', { duration: 8000 });

        try {
          await saveTokenMutation.mutateAsync({
            tokenType: "catalog_management",
            accessToken: config.accessToken,
            catalogId: config.catalogId,
          });
          setSavedCatalogToken(config.accessToken);
          setSavedCatalogId(config.catalogId);
        } catch (e) {
          console.warn("[Token Save] Could not save catalog token:", e);
        }
      }
    } catch (error: any) {
      console.error('[Background Job] Error:', error);
      toast.error(error.message || 'Failed to start background job');
    } finally {
      setCatalogUploading(false);
    }
  };

  // NOTE: No cleanup on unmount for pollIntervalRef — it lives in context
  // and continues running even when navigating away. This is intentional.

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Toaster position="top-right" />

      {/* Catalog Upload Modal */}
      <CatalogUploadModal
        open={catalogModalOpen}
        onOpenChange={setCatalogModalOpen}
        productCount={filteredData ? filteredData.length : 0}
        onUpload={handleCatalogUpload}
        defaultCatalogId={savedCatalogId || undefined}
        defaultAccessToken={savedCatalogToken || undefined}
      />

      {/* Swiss Style Header: Clean, minimal, authoritative */}
      <header className="border-b border-border bg-background sticky top-0 z-20">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <img
              src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663317876169/sDXSavaiZprWHKPf.png"
              alt="Meta Product Insights"
              className="w-10 h-10 rounded-lg"
            />
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/reports')}
              className="gap-2"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Reports</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/schedules')}
              className="gap-2"
            >
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Schedules</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/monitors')}
              className="gap-2"
            >
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">Monitors</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/settings')}
              className="gap-2"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/help')}
              className="gap-2"
            >
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Guide</span>
            </Button>
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
              defaultToken={savedAdsToken || undefined}
              defaultAccountId={savedAdAccountId || undefined}
              defaultMinSpend={savedMinSpend || undefined}
              defaultMinCTR={savedMinCTR || undefined}
              defaultMaxSpend={savedMaxSpend || undefined}
              defaultMaxCVR={savedMaxCVR || undefined}
            />

            {/* Background Job Progress */}
            {activeJobId && (
              <BackgroundJobProgress
                jobId={activeJobId}
                onComplete={(success) => {
                  if (success) {
                    toast.success('Background job completed successfully!');
                  } else {
                    toast.error('Background job failed. Check history for details.');
                  }
                }}
                onClose={() => setActiveJobId(null)}
              />
            )}

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

            {/* Refilter Panel - shown after data is loaded */}
            {reportData && lastReportRunId && (
              <Card className="border-0 shadow-none bg-background border border-border rounded-none">
                <CardContent className="p-4 space-y-3">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground block">Quick Refilter</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Min Spend</label>
                      <input
                        type="number" step="0.01" placeholder="10"
                        value={refilterMinSpend}
                        onChange={(e) => setRefilterMinSpend(e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-border bg-background rounded-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Min CTR %</label>
                      <input
                        type="number" step="0.01" placeholder="5"
                        value={refilterMinCTR}
                        onChange={(e) => setRefilterMinCTR(e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-border bg-background rounded-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Max Spend</label>
                      <input
                        type="number" step="0.01" placeholder=""
                        value={refilterMaxSpend}
                        onChange={(e) => setRefilterMaxSpend(e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-border bg-background rounded-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Max CVR %</label>
                      <input
                        type="number" step="0.01" placeholder="1"
                        value={refilterMaxCVR}
                        onChange={(e) => setRefilterMaxCVR(e.target.value)}
                        className="w-full px-2 py-1 text-xs border border-border bg-background rounded-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Max Results</label>
                    <input
                      type="number" step="1000" placeholder="50000"
                      value={refilterMaxResults}
                      onChange={(e) => setRefilterMaxResults(e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-border bg-background rounded-none"
                    />
                  </div>
                  <Button
                    onClick={handleRefilter}
                    disabled={isRefiltering}
                    className="w-full h-8 text-xs uppercase font-bold tracking-wide rounded-none"
                    size="sm"
                  >
                    {isRefiltering ? (
                      <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Refiltering...</>
                    ) : (
                      <>Apply Filter</>
                    )}
                  </Button>
                  <p className="text-[9px] text-muted-foreground text-center">
                    Instant refilter from cached data — no re-download needed
                  </p>
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

                {/* Background Loading Progress */}
                {!isLoadingComplete && loadedRowCount > 0 && (
                  <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-4 rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                          Loading more data... {loadedRowCount.toLocaleString()} rows loaded
                        </span>
                      </div>
                      <span className="text-xs text-blue-700 dark:text-blue-300">
                        {downloadProgress}% complete
                      </span>
                    </div>
                    <div className="h-2 w-full bg-blue-100 dark:bg-blue-900 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all duration-300 ease-out"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!filteredData || filteredData.length === 0}
                          className="h-8 text-xs uppercase font-bold tracking-wide rounded-none border-border hover:bg-secondary"
                        >
                          <Trophy className="w-3 h-3 mr-2" />
                          Top Conversion
                          <ChevronDown className="w-3 h-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-none">
                        <DropdownMenuItem onClick={() => handleDownloadTopConversion(5000)} className="text-xs uppercase font-bold tracking-wide cursor-pointer">
                          <Trophy className="w-3 h-3 mr-2" />
                          Top 5,000 Products
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDownloadTopConversion(10000)} className="text-xs uppercase font-bold tracking-wide cursor-pointer">
                          <Trophy className="w-3 h-3 mr-2" />
                          Top 10,000 Products
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setCatalogModalOpen(true)}
                      disabled={!filteredData || filteredData.length === 0}
                      className="h-8 text-xs uppercase font-bold tracking-wide rounded-none"
                    >
                      <Upload className="w-3 h-3 mr-2" />
                      Upload to Catalog
                    </Button>
                  </div>
                </div>

                {/* Summary Metrics */}
                <SummaryMetrics data={filteredData || []} />

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
