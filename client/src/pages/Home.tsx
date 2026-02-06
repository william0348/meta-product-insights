import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AsyncJobStatus, ProductInsightData, ReportConfig, FilterCondition } from '../types';
import { facebookApiService } from '@/lib/api';
import { ReportConfigForm } from '@/components/ReportConfigForm';
import { StatusBadge } from '@/components/StatusBadge';
import { InsightsCharts } from '@/components/InsightsCharts';
import { ProductTable } from '@/components/ProductTable';
import { FilterBar } from '@/components/FilterBar';
import { SummaryMetrics } from '@/components/SummaryMetrics';
import { CatalogUploadModal, CatalogUploadConfig } from '@/components/CatalogUploadModal';
import { BackgroundJobProgress } from '@/components/BackgroundJobProgress';
import { trpc } from '@/lib/trpc';

import { LayoutDashboard, Download, ShieldCheck, FileSpreadsheet, Loader2, BarChart2, Upload, Settings, History, FileText, Calendar } from 'lucide-react';
import { useLocation } from 'wouter';
import { utils, writeFile } from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

export default function Home() {
  const [, setLocation] = useLocation();
  
  // State for the Async Job Flow
  const [reportId, setReportId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<AsyncJobStatus>(AsyncJobStatus.NOT_STARTED);
  const [jobPercent, setJobPercent] = useState<number>(0);
  const [reportData, setReportData] = useState<ProductInsightData[] | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [loadedRowCount, setLoadedRowCount] = useState<number>(0);
  const [isLoadingComplete, setIsLoadingComplete] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  
  // Filtering
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>([]);

  // Store the access token used for the current job so we can use it during polling
  const [activeAccessToken, setActiveAccessToken] = useState<string | undefined>(undefined);
  
  // Catalog Upload State
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [catalogUploading, setCatalogUploading] = useState(false);
  const trpcUtils = trpc.useUtils();
  
  // Background Job State
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [useBackgroundJob, setUseBackgroundJob] = useState(true); // Default to background processing
  
  // Job submission mutation
  const submitJobMutation = trpc.jobs.submit.useMutation();
  
  // Saved token state
  const [savedAdsToken, setSavedAdsToken] = useState<string | null>(null);
  const [savedCatalogToken, setSavedCatalogToken] = useState<string | null>(null);
  const [savedCatalogId, setSavedCatalogId] = useState<string | null>(null);
  const [savedAdAccountId, setSavedAdAccountId] = useState<string | null>(null);
  const [savedMinSpend, setSavedMinSpend] = useState<string | null>(null);
  const [savedMinCTR, setSavedMinCTR] = useState<string | null>(null);
  const [savedBatchSize, setSavedBatchSize] = useState<number>(2000); // Default 2000
  
  // Token mutations
  const saveTokenMutation = trpc.tokens.save.useMutation();
  
  // Load saved tokens on mount
  const { data: adsTokenData } = trpc.tokens.get.useQuery(
    { tokenType: "ads_management" },
    { refetchOnWindowFocus: false }
  );
  const { data: catalogTokenData } = trpc.tokens.get.useQuery(
    { tokenType: "catalog_management" },
    { refetchOnWindowFocus: false }
  );
  
  // Update local state when token data loads
  useEffect(() => {
    if (adsTokenData?.found) {
      setSavedAdsToken(adsTokenData.accessToken);
      setSavedAdAccountId(adsTokenData.adAccountId);
      setSavedMinSpend(adsTokenData.minSpend);
      setSavedMinCTR(adsTokenData.minCTR);
    }
  }, [adsTokenData]);
  
  useEffect(() => {
    if (catalogTokenData?.found) {
      setSavedCatalogToken(catalogTokenData.accessToken);
      setSavedCatalogId(catalogTokenData.catalogId);
      setSavedBatchSize(catalogTokenData.batchSize || 2000);
    }
  }, [catalogTokenData]);

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

      // 1. Build API filters from form data
      const apiFilters: Array<{field: string, operator: string, value: any}> = [];
      
      // Add spend filter if provided
      if (config.minSpend && parseFloat(config.minSpend) > 0) {
        apiFilters.push({
          field: 'spend',
          operator: 'GREATER_THAN',
          value: parseFloat(config.minSpend)
        });
      }
      
      // Add CTR filter if provided
      if (config.minCTR && parseFloat(config.minCTR) > 0) {
        apiFilters.push({
          field: 'inline_link_click_ctr',
          operator: 'GREATER_THAN',
          value: parseFloat(config.minCTR)
        });
      }
      
      // 2. Create Report Run with filters
      const response = await facebookApiService.createReportRun(
        config.accountId, 
        config.dateStart, 
        config.dateEnd,
        config.accessToken,
        config.level,
        config.breakdown,
        apiFilters.length > 0 ? apiFilters : undefined // Pass filters if any
      );
      
      setReportId(response.report_run_id);
      setIsRequesting(false);
      toast.success("Report run initiated successfully");
      
      // Save ads token to database for future use
      try {
        await saveTokenMutation.mutateAsync({
          tokenType: "ads_management",
          accessToken: config.accessToken,
          adAccountId: config.accountId,
        });
        setSavedAdsToken(config.accessToken);
        setSavedAdAccountId(config.accountId);
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
    if (pollInterval.current) clearInterval(pollInterval.current);

    pollInterval.current = setInterval(async () => {
      try {
        // 2. Poll Status
        const status = await facebookApiService.pollReportStatus(id, token);
        setJobStatus(status.async_status);
        setJobPercent(status.async_percent_completion);

        if (status.async_status === AsyncJobStatus.COMPLETED) {
           if (pollInterval.current) clearInterval(pollInterval.current);
           toast.success("Report generation completed. Preparing download...");
           // Add a small delay to ensure Facebook's CDN has the file ready
           setTimeout(() => {
             fetchResults(id, token);
           }, 10000); // 10 second delay to allow Facebook CDN to prepare file
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
      setLoadedRowCount(0);
      setIsLoadingComplete(false);
      
      let hasShownInitialResults = false;
      
      // 3. Download and Parse CSV with progress tracking
      const results = await facebookApiService.downloadReportCSV(
        id, 
        token, 
        (parsedData) => {
          // Show results immediately after first 1000 rows
          if (!hasShownInitialResults && parsedData.length >= 1000) {
            setReportData(parsedData);
            setLoadedRowCount(parsedData.length);
            setIsFetchingMore(false); // Stop showing "preparing" state
            toast.success(`Loaded first ${parsedData.length} rows. Continuing to load more...`);
            hasShownInitialResults = true;
          } else if (hasShownInitialResults) {
            // Update data and count as more rows come in
            setReportData(parsedData);
            setLoadedRowCount(parsedData.length);
          }
        },
        (progress) => {
          setDownloadProgress(progress);
        }
      );
      
      // Ensure final state is set
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

  // Catalog Upload Handler - Now uses background job processing
  const handleCatalogUpload = async (config: CatalogUploadConfig) => {
    if (!filteredData || filteredData.length === 0) return;
    
    // Extract retailer IDs from filtered data
    const retailerIds = filteredData
      .map(item => item.product_retailer_id)
      .filter(Boolean);
    
    if (retailerIds.length === 0) {
      toast.error('No valid product IDs found');
      return;
    }
    
    // Submit as background job (continues even if browser is closed)
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
        
        // Save catalog token for future use
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
  
  // Legacy synchronous catalog upload (kept for reference, not used)
  const handleCatalogUploadLegacy = async (config: CatalogUploadConfig) => {
    if (!filteredData || filteredData.length === 0) return;
    
    setCatalogUploading(true);
    
    try {
      const FETCH_CHUNK_SIZE = 50;
      const BATCH_SIZE = savedBatchSize;
      
      const retailerIds = filteredData
        .map(item => item.product_retailer_id)
        .filter(Boolean);
      
      if (retailerIds.length === 0) {
        throw new Error('No valid product IDs found');
      }
      
      toast.info(`Preparing to upload ${retailerIds.length} products...`);
      
      const batches: string[][] = [];
      for (let i = 0; i < retailerIds.length; i += BATCH_SIZE) {
        batches.push(retailerIds.slice(i, i + BATCH_SIZE));
      }
      
      toast.info(`Uploading ${retailerIds.length} products in ${batches.length} sequential batches...`);
      
      const handles: string[] = [];
      
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batchIds = batches[batchIndex];
        const actualBatchNum = batchIndex + 1;
          
        let currentProducts: any[] = [];
        for (let j = 0; j < batchIds.length; j += FETCH_CHUNK_SIZE) {
          const chunk = batchIds.slice(j, j + FETCH_CHUNK_SIZE);
          const result = await trpcUtils.catalog.fetchProducts.fetch({
            catalogId: config.catalogId,
            retailerIds: chunk,
            accessToken: config.accessToken,
          });
          currentProducts = currentProducts.concat(result.products);
        }
        
        // Build update requests with merge logic
        const productMap = new Map(currentProducts.map((p: any) => [p.retailer_id, p]));
        const requests = batchIds.map(id => {
          const product = productMap.get(id);
          // Facebook API requires 'id' field in data payload (same as retailer_id)
          const dataPayload: Record<string, any> = {
            id: id,  // Required by Facebook Catalog Batch API
          };
          
          // Custom Label 4 (Merge)
          if (config.customLabel4) {
            let finalVal = config.customLabel4;
            if (product && product.custom_label_4) {
              const existing = product.custom_label_4.split(',').map((s: string) => s.trim()).filter(Boolean);
              if (!existing.includes(config.customLabel4)) {
                existing.push(config.customLabel4);
                finalVal = existing.join(', ');
              } else {
                finalVal = product.custom_label_4;
              }
            }
            dataPayload.custom_label_4 = finalVal;
          }
          
          // Custom Number (Overwrite)
          if (config.customNumberValue) {
            const numValue = parseInt(config.customNumberValue);
            dataPayload[config.customNumberField] = numValue;
          }
          
          return {
            method: 'UPDATE' as const,
            retailer_id: id,
            data: dataPayload,
          };
        });
        
        // Send batch update with history tracking
        const updateCriteria = {
          sourceField: config.customLabel4 ? 'custom_label_4' : undefined,
          targetField: config.customNumberValue ? config.customNumberField : undefined,
          condition: config.customLabel4 ? 'merge' : 'overwrite',
          description: [
            config.customLabel4 ? `Add label "${config.customLabel4}" to custom_label_4` : '',
            config.customNumberValue ? `Set ${config.customNumberField} = ${config.customNumberValue}` : '',
          ].filter(Boolean).join('; ') || 'Batch update',
        };
        
        const response = await trpcUtils.client.catalog.batchUpdate.mutate({
          catalogId: config.catalogId,
          requests,
          accessToken: config.accessToken,
          updateCriteria,
        });
        
        // Check for errors
        if (response.validation_status && response.validation_status.length > 0) {
          const errors = response.validation_status.filter((s: any) => s.errors && s.errors.length > 0);
          if (errors.length > 0) {
            const errorMsg = errors[0].errors![0].message;
            throw new Error(`Batch ${actualBatchNum} validation error: ${errorMsg}`);
          }
        }
        
        toast.success(`Batch ${actualBatchNum}/${batches.length} uploaded successfully`);
        
        // Store handles for status tracking
        if (response.handles && response.handles.length > 0) {
          handles.push(...response.handles);
        }
      }
      
      toast.success(`All ${retailerIds.length} products uploaded to catalog!`);
      
      // Track batch status for all handles with polling until finished
      if (handles.length > 0) {
        toast.info(`Tracking ${handles.length} batch request(s) status...`, { duration: 5000 });
        
        // Poll status for each handle until finished
        const pollBatchStatus = async (handle: string, handleIndex: number): Promise<void> => {
          const maxPolls = 60; // Max 60 polls (5 minutes with 5s interval)
          const pollInterval = 5000; // 5 seconds between polls
          
          for (let pollCount = 0; pollCount < maxPolls; pollCount++) {
            try {
              const statusResponse = await trpcUtils.client.catalog.checkBatchStatus.query({
                catalogId: config.catalogId,
                handle,
                accessToken: config.accessToken,
                loadInvalidIds: true,
              });
              
              if (statusResponse.data && statusResponse.data.length > 0) {
                const status = statusResponse.data[0];
                const handleShort = handle.substring(0, 8);
                
                console.log(`[Batch Status ${handleIndex + 1}] Poll ${pollCount + 1}:`, status);
                
                // Check if finished
                if (status.status === 'finished') {
                  // Show final status
                  if (status.errors_total_count && status.errors_total_count > 0) {
                    toast.warning(
                      `Batch ${handleShort}... completed with ${status.errors_total_count} invalid entries`,
                      { duration: 8000 }
                    );
                    
                    // Log invalid IDs for debugging
                    if (status.ids_of_invalid_requests && status.ids_of_invalid_requests.length > 0) {
                      console.log(`[Batch ${handleShort}] Invalid IDs:`, status.ids_of_invalid_requests.slice(0, 20));
                    }
                  } else {
                    toast.success(`Batch ${handleShort}... processed successfully`, { duration: 5000 });
                  }
                  return; // Exit polling loop
                }
                
                // Show progress for in_progress status
                if (status.status === 'in_progress' || !status.status) {
                  if (pollCount % 3 === 0) { // Show update every 15 seconds
                    toast.info(`Batch ${handleShort}... still processing (${pollCount * 5}s elapsed)`, { duration: 3000 });
                  }
                }
              }
              
              // Wait before next poll
              await new Promise(resolve => setTimeout(resolve, pollInterval));
              
            } catch (error) {
              console.warn(`[Batch Status ${handleIndex + 1}] Poll error:`, error);
              // Continue polling on error, might be temporary
              await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
          }
          
          // Max polls reached
          toast.warning(`Batch ${handle.substring(0, 8)}... status check timed out after 5 minutes`, { duration: 8000 });
        };
        
        // Poll all handles in parallel
        await Promise.all(handles.map((handle, index) => pollBatchStatus(handle, index)));
        
        toast.success('All batch status checks completed!');
      }
      
      // Verify by fetching a sample of updated products
      try {
        const sampleIds = retailerIds.slice(0, 5); // Get first 5 for verification
        const verifyResponse = await trpcUtils.client.catalog.fetchProducts.query({
          catalogId: config.catalogId,
          retailerIds: sampleIds,
          accessToken: config.accessToken,
        });
        
        if (verifyResponse.products && verifyResponse.products.length > 0) {
          const sample = verifyResponse.products[0];
          const customLabel = sample.custom_label_4 || 'N/A';
          const customNum = sample[config.customNumberField] || 'N/A';
          toast.info(
            `Verification: Sample product "${sample.name || sample.retailer_id}" - Label: ${customLabel}, ${config.customNumberField}: ${customNum}`,
            { duration: 10000 }
          );
        }
      } catch (verifyError) {
        console.warn('[Catalog Verify] Could not verify update:', verifyError);
      }
      
      // Save catalog token to database for future use
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
    } catch (error: any) {
      console.error('[Catalog Upload] Error:', error);
      toast.error(error.message || 'Failed to upload to catalog');
      throw error;
    } finally {
      setCatalogUploading(false);
    }
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
              onClick={() => setLocation('/batch-history')}
              className="gap-2"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">History</span>
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setLocation('/saved-reports')}
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
              onClick={() => setLocation('/settings')}
              className="gap-2"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
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
