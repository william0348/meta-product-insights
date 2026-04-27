import React, { useState } from 'react';
import { Link, useParams, useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  ArrowLeft, 
  Clock,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Play,
  Timer,
  Database,
  TrendingUp,
  Package,
  Hash,
  History,
  Zap,
  CalendarClock,
  RefreshCw,
  ShieldAlert,
  Wifi,
  Ban,
  StopCircle,
  FileText,
  Search,
  ChevronDown,
  ChevronUp,
  Layers,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

/**
 * Unified Reports & History page.
 * - /reports → shows ALL execution history across all schedules (global view)
 *   with two main tabs: "Schedule Runs" and "Catalog Operations"
 * - /schedule-history/:id → shows history for a specific schedule (filtered view, schedule runs only)
 */
export default function ScheduleHistory() {
  const params = useParams<{ id: string }>();
  const scheduleId = params.id ? parseInt(params.id) : 0;
  const isGlobalView = scheduleId === 0;
  const [, setLocation] = useLocation();
  
  // Main section tab (only for global view)
  const [mainTab, setMainTab] = useState<string>('schedule-runs');
  
  // Schedule Runs state
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [viewingReportId, setViewingReportId] = useState<number | null>(null);
  const [dialogTab, setDialogTab] = useState<string>('overview');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  // Catalog Operations state
  const [catalogFilter, setCatalogFilter] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  
  const queryClient = useQueryClient();

  // ── Schedule Runs queries ──
  const { data: allHistoryData, isLoading: isLoadingAll, error: allHistoryError } = useQuery({
    queryKey: ['schedules', 'allHistory'],
    queryFn: () => apiClient.schedules.getAllHistory(100),
    enabled: isGlobalView,
    retry: false,
  });

  const { data: scheduleHistoryData, isLoading: isLoadingSchedule, error: scheduleHistoryError } = useQuery({
    queryKey: ['schedules', 'history', scheduleId],
    queryFn: () => apiClient.schedules.getHistory(scheduleId, 50),
    enabled: !isGlobalView && scheduleId > 0,
    retry: false,
  });

  const { data: runDetailData, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['schedules', 'runs', selectedRunId],
    queryFn: () => apiClient.schedules.getRunDetail(selectedRunId!),
    enabled: selectedRunId !== null,
  });

  const { data: reportData, isLoading: isLoadingReport } = useQuery({
    queryKey: ['reports', viewingReportId],
    queryFn: () => apiClient.reports.get(viewingReportId!),
    enabled: viewingReportId !== null,
  });

  // ── Cancel mutation ──
  const [cancellingJobId, setCancellingJobId] = useState<number | null>(null);
  const cancelJobMutation = useMutation({
    mutationFn: (data: { jobId: number }) => apiClient.schedules.cancelJob(data.jobId),
    onSuccess: () => {
      toast.success('Job cancelled successfully');
      setCancellingJobId(null);
      queryClient.invalidateQueries({ queryKey: ['schedules', 'allHistory'] });
      queryClient.invalidateQueries({ queryKey: ['schedules', 'history'] });
      if (selectedRunId) queryClient.invalidateQueries({ queryKey: ['schedules', 'runs', selectedRunId] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to cancel job: ${err.message}`);
      setCancellingJobId(null);
    },
  });

  const handleCancelJob = (jobId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCancellingJobId(jobId);
    cancelJobMutation.mutate({ jobId });
  };

  // ── Catalog Operations query ──
  const { data: batchData, isLoading: isLoadingBatch } = useQuery({
    queryKey: ['batchHistory'],
    queryFn: () => apiClient.batchHistory.getMyHistory(100),
    enabled: isGlobalView,
    retry: false,
  });
  
  const isLoading = isGlobalView ? isLoadingAll : isLoadingSchedule;
  const historyError = isGlobalView ? allHistoryError : scheduleHistoryError;
  const runs = isGlobalView 
    ? (allHistoryData?.runs || []) 
    : (scheduleHistoryData?.runs || []);
  const scheduleName = isGlobalView ? 'All Schedules' : (scheduleHistoryData?.scheduleName || 'Schedule');
  
  // Schedule Runs stats
  const completedRuns = runs.filter(r => r.status === 'completed');
  const failedRuns = runs.filter(r => r.status === 'failed');
  const runningRuns = runs.filter(r => r.status === 'running');
  const avgDuration = completedRuns.length > 0
    ? completedRuns.reduce((sum, r) => sum + (r.durationMs || 0), 0) / completedRuns.length
    : 0;
  
  const filteredRuns = statusFilter === 'all' 
    ? runs 
    : runs.filter(r => r.status === statusFilter);
  
  // Catalog Operations data
  const batchHistory = batchData?.history || [];
  const filteredBatchHistory = catalogFilter
    ? batchHistory.filter((r: any) => r.catalogId?.toLowerCase().includes(catalogFilter.toLowerCase()))
    : batchHistory;
  const batchCompleted = batchHistory.filter((r: any) => r.status === 'completed').length;
  const batchFailed = batchHistory.filter((r: any) => r.status === 'failed').length;
  const batchTotalItems = batchHistory.reduce((sum: number, r: any) => sum + (r.totalItems || 0), 0);
  
  // ── Helper functions ──
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
            <CheckCircle className="w-3 h-3 mr-1" /> Completed
          </Badge>
        );
      case 'running':
        return (
          <Badge className="bg-blue-100 text-blue-700 border-blue-200">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Running
          </Badge>
        );
      case 'partial':
        return (
          <Badge className="bg-amber-100 text-amber-700 border-amber-200">
            <AlertTriangle className="w-3 h-3 mr-1" /> Partial
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-red-100 text-red-700 border-red-200">
            <XCircle className="w-3 h-3 mr-1" /> Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };
  
  const getTriggerBadge = (triggerType: string) => {
    if (triggerType === 'manual') {
      return (
        <Badge variant="outline" className="text-xs">
          <Play className="w-2.5 h-2.5 mr-1" /> Manual
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs">
        <CalendarClock className="w-2.5 h-2.5 mr-1" /> Auto
      </Badge>
    );
  };
  
  const getOperationBadge = (type: string) => {
    switch (type) {
      case 'UPDATE': return <Badge variant="secondary" className="bg-blue-100 text-blue-800">UPDATE</Badge>;
      case 'DELETE': return <Badge variant="secondary" className="bg-red-100 text-red-800">DELETE</Badge>;
      case 'CREATE': return <Badge variant="secondary" className="bg-green-100 text-green-800">CREATE</Badge>;
      default: return <Badge variant="secondary">{type}</Badge>;
    }
  };
  
  const formatDuration = (ms: number | null | undefined) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };
  
  const formatSpend = (cents: number | null | undefined) => {
    if (!cents) return '$0.00';
    return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  
  const toggleBatchRow = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Render ──
  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="border-b border-border bg-background sticky top-0 z-20">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href={isGlobalView ? "/" : "/schedules"}>
              <Button variant="ghost" size="sm" className="h-8">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <div className="bg-primary text-primary-foreground w-8 h-8 flex items-center justify-center font-bold text-lg">
              {isGlobalView ? 'R' : 'H'}
            </div>
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest">
                {isGlobalView ? 'Reports & History' : 'Execution History'}
              </h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{scheduleName}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!isGlobalView && (
              <Button variant="ghost" size="sm" onClick={() => setLocation('/reports')} className="text-xs gap-1">
                <History className="w-3.5 h-3.5" />
                All History
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setLocation('/schedules')} className="text-xs gap-1">
              <CalendarClock className="w-3.5 h-3.5" />
              Schedules
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8">
        {/* Global view: main section tabs */}
        {isGlobalView && (
          <Tabs value={mainTab} onValueChange={setMainTab} className="mb-6">
            <TabsList className="w-full max-w-md">
              <TabsTrigger value="schedule-runs" className="flex-1 gap-1.5">
                <Zap className="w-3.5 h-3.5" />
                Schedule Runs
              </TabsTrigger>
              <TabsTrigger value="catalog-ops" className="flex-1 gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                Catalog Operations
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* ═══════════════════════════════════════════════ */}
        {/* SCHEDULE RUNS TAB (or the only view for per-schedule) */}
        {/* ═══════════════════════════════════════════════ */}
        {(mainTab === 'schedule-runs' || !isGlobalView) && (
          <>
            {historyError && (
              <div className="text-sm text-red-600 mb-4 p-3 bg-red-50 rounded border border-red-200">
                Error loading history: {historyError.message}
              </div>
            )}
            {isLoading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : runs.length === 0 ? (
              <Card className="border-dashed max-w-md mx-auto">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">No Execution History</p>
                  <p className="text-sm mb-4">
                    {isGlobalView 
                      ? 'No reports have been generated yet. Create a schedule or run a report to get started.'
                      : 'This schedule hasn\'t been executed yet. Use "Run Now" to trigger it.'}
                  </p>
                  <Link href={isGlobalView ? "/" : "/schedules"}>
                    <Button variant="outline">
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      {isGlobalView ? 'Back to Dashboard' : 'Back to Schedules'}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                        <Hash className="w-4 h-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Total Runs</span>
                      </div>
                      <p className="text-2xl font-bold">{runs.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Successful</span>
                      </div>
                      <p className="text-2xl font-bold text-emerald-600">{completedRuns.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                        <XCircle className="w-4 h-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Failed</span>
                      </div>
                      <p className="text-2xl font-bold text-red-600">{failedRuns.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                        <Loader2 className="w-4 h-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Running</span>
                      </div>
                      <p className="text-2xl font-bold text-blue-600">{runningRuns.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                        <Timer className="w-4 h-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Avg Duration</span>
                      </div>
                      <p className="text-2xl font-bold">{formatDuration(avgDuration)}</p>
                    </CardContent>
                  </Card>
                </div>
                
                {/* Filter Tabs */}
                <Tabs value={statusFilter} onValueChange={setStatusFilter}>
                  <TabsList>
                    <TabsTrigger value="all">All ({runs.length})</TabsTrigger>
                    <TabsTrigger value="completed">Completed ({completedRuns.length})</TabsTrigger>
                    <TabsTrigger value="failed">Failed ({failedRuns.length})</TabsTrigger>
                    <TabsTrigger value="running">Running ({runningRuns.length})</TabsTrigger>
                  </TabsList>
                </Tabs>
                
                {/* Run History List */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <History className="w-4 h-4" />
                      {isGlobalView ? 'All Execution History' : 'Execution History'}
                      <span className="text-xs font-normal text-muted-foreground ml-2">
                        {filteredRuns.length} {filteredRuns.length === 1 ? 'run' : 'runs'}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {filteredRuns.length === 0 ? (
                      <div className="py-12 text-center text-muted-foreground">
                        <p className="text-sm">No runs match this filter.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {filteredRuns.map((run) => (
                          <div
                            key={run.id}
                            className="w-full text-left px-6 py-4 hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => { setSelectedRunId(run.id); setDialogTab('overview'); setViewingReportId(null); }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 flex-wrap">
                                {getStatusBadge(run.status)}
                                {getTriggerBadge(run.triggerType)}
                                {isGlobalView && 'scheduleName' in run && (run as any).scheduleName && (
                                  <Badge variant="secondary" className="text-xs">
                                    {(run as any).scheduleName}
                                  </Badge>
                                )}
                                {(run.retryCount > 0 || run.nextRetryAt) && (
                                  <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                                    <RefreshCw className="w-2.5 h-2.5 mr-1" />
                                    Retry {run.retryCount}/{run.maxRetries}
                                  </Badge>
                                )}
                                {run.nextRetryAt && (
                                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                                    <Clock className="w-2.5 h-2.5 mr-1" />
                                    Next retry {formatDistanceToNow(new Date(run.nextRetryAt), { addSuffix: true })}
                                  </Badge>
                                )}
                                {run.lastErrorType && (
                                  <Badge variant="outline" className="text-xs">
                                    {run.lastErrorType === 'rate_limit' && <ShieldAlert className="w-2.5 h-2.5 mr-1" />}
                                    {run.lastErrorType === 'timeout' && <Clock className="w-2.5 h-2.5 mr-1" />}
                                    {run.lastErrorType === 'transient' && <Wifi className="w-2.5 h-2.5 mr-1" />}
                                    {run.lastErrorType === 'permanent' && <Ban className="w-2.5 h-2.5 mr-1" />}
                                    {run.lastErrorType}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            
                            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-0.5">Started</span>
                                <span className="font-medium">
                                  {format(new Date(run.startedAt), 'MMM d, HH:mm:ss')}
                                </span>
                                <span className="text-xs text-muted-foreground block">
                                  {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-0.5">Duration</span>
                                <span className="font-medium flex items-center gap-1">
                                  <Timer className="w-3 h-3 text-muted-foreground" />
                                  {run.status === 'running' ? (
                                    <span className="text-blue-600 animate-pulse">In progress...</span>
                                  ) : (
                                    formatDuration(run.durationMs)
                                  )}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-0.5">Products</span>
                                <span className="font-medium flex items-center gap-1">
                                  <Package className="w-3 h-3 text-muted-foreground" />
                                  {(run.totalItems || 0).toLocaleString()}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-0.5">Jobs</span>
                                <span className="font-medium flex items-center gap-1">
                                  <Zap className="w-3 h-3 text-muted-foreground" />
                                  {run.completedJobs || 0}/{run.totalJobs || 0}
                                  {(run.failedJobs || 0) > 0 && (
                                    <span className="text-red-500 text-xs">({run.failedJobs} failed)</span>
                                  )}
                                </span>
                              </div>
                            </div>
                            
                            {run.errorMessage && (
                              <div className="mt-2 text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">
                                {run.errorMessage}
                              </div>
                            )}

                            {/* Cancel button for running jobs */}
                            {run.status === 'running' && run.jobIds && run.jobIds.length > 0 && (
                              <div className="mt-3 flex justify-end">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                                  disabled={cancellingJobId !== null}
                                  onClick={(e) => handleCancelJob(run.jobIds![0], e)}
                                >
                                  {cancellingJobId === run.jobIds![0] ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <StopCircle className="w-3 h-3" />
                                  )}
                                  Cancel Job
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════ */}
        {/* CATALOG OPERATIONS TAB */}
        {/* ═══════════════════════════════════════════════ */}
        {isGlobalView && mainTab === 'catalog-ops' && (
          <>
            {isLoadingBatch ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : batchHistory.length === 0 ? (
              <Card className="border-dashed max-w-md mx-auto">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Layers className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">No Catalog Operations</p>
                  <p className="text-sm mb-4">
                    Run a catalog batch update to see history here.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Catalog Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                        <Hash className="w-4 h-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Total Ops</span>
                      </div>
                      <p className="text-2xl font-bold">{batchHistory.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Completed</span>
                      </div>
                      <p className="text-2xl font-bold text-emerald-600">{batchCompleted}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                        <XCircle className="w-4 h-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Failed</span>
                      </div>
                      <p className="text-2xl font-bold text-red-600">{batchFailed}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                        <Package className="w-4 h-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Total Items</span>
                      </div>
                      <p className="text-2xl font-bold">{batchTotalItems.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                </div>
                
                {/* Filter */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center space-x-4">
                      <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          placeholder="Filter by Catalog ID..."
                          value={catalogFilter}
                          onChange={(e) => setCatalogFilter(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <span className="text-sm text-muted-foreground">
                        Showing {filteredBatchHistory.length} records
                      </span>
                    </div>
                  </CardContent>
                </Card>
                
                {/* Catalog Operations Table */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-bold uppercase tracking-wider">Operation Log</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {filteredBatchHistory.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Layers className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p>No batch operations match this filter</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-8"></TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Catalog ID</TableHead>
                              <TableHead>Operation</TableHead>
                              <TableHead className="text-right">Items</TableHead>
                              <TableHead className="text-right">Success/Error</TableHead>
                              <TableHead>Duration</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredBatchHistory.map((record: any) => (
                              <React.Fragment key={record.id}>
                                <TableRow 
                                  className="cursor-pointer hover:bg-secondary/50"
                                  onClick={() => toggleBatchRow(record.id)}
                                >
                                  <TableCell>
                                    {expandedRows.has(record.id) ? (
                                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                    )}
                                  </TableCell>
                                  <TableCell className="font-mono text-xs">
                                    {format(new Date(record.startedAt), 'yyyy-MM-dd HH:mm')}
                                  </TableCell>
                                  <TableCell className="font-mono text-xs">
                                    {record.catalogId}
                                  </TableCell>
                                  <TableCell>
                                    {getOperationBadge(record.operationType)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {record.totalItems?.toLocaleString() || 0}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <span className="text-emerald-600 font-mono">{record.successCount || 0}</span>
                                    {' / '}
                                    <span className="text-red-600 font-mono">{record.errorCount || 0}</span>
                                  </TableCell>
                                  <TableCell className="font-mono text-xs">
                                    {formatDuration(record.durationMs)}
                                  </TableCell>
                                  <TableCell>
                                    {getStatusBadge(record.status)}
                                  </TableCell>
                                </TableRow>
                                {expandedRows.has(record.id) && (
                                  <TableRow className="bg-secondary/30">
                                    <TableCell colSpan={8} className="p-4">
                                      <div className="space-y-3">
                                        {record.handles && record.handles.length > 0 && (
                                          <div>
                                            <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">Batch Handles</span>
                                            <div className="flex flex-wrap gap-1">
                                              {record.handles.map((h: string, idx: number) => (
                                                <Badge key={idx} variant="outline" className="text-xs font-mono">{h}</Badge>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        {record.fields && record.fields.length > 0 && (
                                          <div>
                                            <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">Updated Fields</span>
                                            <div className="flex flex-wrap gap-1">
                                              {record.fields.map((field: string, idx: number) => (
                                                <Badge key={idx} variant="outline" className="text-xs">{field}</Badge>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        {record.errors && record.errors.length > 0 && (
                                          <div>
                                            <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">Errors</span>
                                            <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 max-h-32 overflow-y-auto">
                                              {record.errors.slice(0, 10).map((err: string, idx: number) => (
                                                <div key={idx} className="mb-1">{err}</div>
                                              ))}
                                              {record.errors.length > 10 && (
                                                <div className="text-muted-foreground mt-1">...and {record.errors.length - 10} more</div>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                        {record.statusMessage && (
                                          <div>
                                            <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">Status</span>
                                            <p className="text-xs text-muted-foreground">{record.statusMessage}</p>
                                          </div>
                                        )}
                                        {/* Verification Results */}
                                        {record.updateCriteria?.verification && (
                                          <div>
                                            <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">Catalog Verification</span>
                                            <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
                                              <div className="text-xs text-blue-700">
                                                Total catalog products: {(record.updateCriteria.verification.total_catalog_products || 0).toLocaleString()}
                                              </div>
                                              {Object.entries(record.updateCriteria.verification.fields || {}).map(([fieldName, info]: [string, any]) => (
                                                <div key={fieldName} className="flex items-center justify-between text-xs">
                                                  <span className="font-mono text-blue-800">{fieldName} = {info.value}</span>
                                                  {info.matched_count >= 0 ? (
                                                    <span className="font-medium text-blue-700">
                                                      {info.matched_count.toLocaleString()} / {info.total_count.toLocaleString()} matched
                                                      <span className="ml-1 text-blue-500">({info.total_count > 0 ? ((info.matched_count / info.total_count) * 100).toFixed(1) : 0}%)</span>
                                                    </span>
                                                  ) : (
                                                    <span className="text-red-500">Verification failed</span>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </React.Fragment>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </main>
      
      {/* ═══════════════════════════════════════════════ */}
      {/* Run Detail Dialog */}
      {/* ═══════════════════════════════════════════════ */}
      <Dialog open={selectedRunId !== null} onOpenChange={(open) => { if (!open) { setSelectedRunId(null); setDialogTab('overview'); setViewingReportId(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Run Detail
              {runDetailData?.run && getStatusBadge(runDetailData.run.status)}
              {runDetailData?.run?.status === 'running' && runDetailData?.jobDetails && runDetailData.jobDetails.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                  disabled={cancellingJobId !== null}
                  onClick={() => {
                    const runningJob = runDetailData.jobDetails?.find(j => j.status === 'running') || runDetailData.jobDetails?.[0];
                    if (runningJob) handleCancelJob(runningJob.id);
                  }}
                >
                  {cancellingJobId !== null ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <StopCircle className="w-3 h-3" />
                  )}
                  Cancel
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {/* Tabs: Overview vs Report Data */}
          {runDetailData?.jobDetails?.some(j => j.reportId) && (
            <Tabs value={dialogTab} onValueChange={(val) => {
              setDialogTab(val);
              if (val === 'report' && !viewingReportId) {
                const firstReportJob = runDetailData?.jobDetails?.find(j => j.reportId);
                if (firstReportJob?.reportId) setViewingReportId(firstReportJob.reportId);
              }
            }} className="mt-2">
              <TabsList className="w-full">
                <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
                <TabsTrigger value="report" className="flex-1">
                  <FileText className="w-3.5 h-3.5 mr-1" />
                  Report Data
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          
          {isLoadingDetail ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : runDetailData?.run ? (
            <>
            {/* Report Data Tab */}
            {dialogTab === 'report' && (
              <div className="space-y-4">
                {isLoadingReport ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : reportData?.report ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold">{reportData.report.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          Account: {reportData.report.adAccountId} | {reportData.report.dateStart} → {reportData.report.dateEnd}
                        </p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-3">
                      <Card className="bg-muted/30">
                        <CardContent className="pt-3 pb-3 text-center">
                          <p className="text-lg font-bold">{reportData.report.totalItems || 0}</p>
                          <p className="text-[10px] text-muted-foreground uppercase">Products</p>
                        </CardContent>
                      </Card>
                      <Card className="bg-muted/30">
                        <CardContent className="pt-3 pb-3 text-center">
                          <p className="text-lg font-bold">{formatSpend(reportData.report.totalSpend)}</p>
                          <p className="text-[10px] text-muted-foreground uppercase">Total Spend</p>
                        </CardContent>
                      </Card>
                      <Card className="bg-muted/30">
                        <CardContent className="pt-3 pb-3 text-center">
                          <p className="text-lg font-bold">{(reportData.report.totalImpressions || 0).toLocaleString()}</p>
                          <p className="text-[10px] text-muted-foreground uppercase">Impressions</p>
                        </CardContent>
                      </Card>
                    </div>
                    
                    {reportData.report.data && reportData.report.data.length > 0 ? (
                      <div className="border rounded-lg overflow-hidden">
                        <div className="overflow-x-auto max-h-[400px]">
                          <table className="w-full text-xs">
                            <thead className="bg-secondary sticky top-0">
                              <tr>
                                <th className="text-left p-2 font-medium">Product</th>
                                <th className="text-right p-2 font-medium">Spend</th>
                                <th className="text-right p-2 font-medium">Impressions</th>
                                <th className="text-right p-2 font-medium">Clicks</th>
                                <th className="text-right p-2 font-medium">CTR</th>
                                <th className="text-right p-2 font-medium">Purchases</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reportData.report.data.slice(0, 100).map((item: any, idx: number) => (
                                <tr key={idx} className="border-t hover:bg-secondary/30">
                                  <td className="p-2">
                                    <div className="font-medium truncate max-w-[200px]">{item.product_name}</div>
                                    <div className="text-muted-foreground">{item.product_retailer_id}</div>
                                  </td>
                                  <td className="text-right p-2">{formatSpend(item.spend)}</td>
                                  <td className="text-right p-2">{item.impressions?.toLocaleString()}</td>
                                  <td className="text-right p-2">{item.link_clicks?.toLocaleString()}</td>
                                  <td className="text-right p-2">{(item.inline_link_click_ctr || 0).toFixed(2)}%</td>
                                  <td className="text-right p-2">{item.purchases}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {reportData.report.data.length > 100 && (
                          <div className="text-center py-2 text-xs text-muted-foreground bg-secondary/30">
                            Showing 100 of {reportData.report.data.length} items
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <FileText className="w-8 h-8 mx-auto mb-4 opacity-50" />
                        <p className="text-sm">No data available for this report</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-4 opacity-50" />
                    <p className="text-sm">Select a job with a linked report to view data</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => setDialogTab('overview')}>
                      Back to Overview
                    </Button>
                  </div>
                )}
              </div>
            )}
            
            {/* Overview Tab */}
            {dialogTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Trigger</span>
                  <div>{getTriggerBadge(runDetailData.run.triggerType)}</div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Duration</span>
                  <p className="text-sm font-medium">{formatDuration(runDetailData.run.durationMs)}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Started</span>
                  <p className="text-sm font-medium">
                    {format(new Date(runDetailData.run.startedAt), 'MMM d, yyyy HH:mm:ss')}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Completed</span>
                  <p className="text-sm font-medium">
                    {runDetailData.run.completedAt 
                      ? format(new Date(runDetailData.run.completedAt), 'MMM d, yyyy HH:mm:ss')
                      : '—'
                    }
                  </p>
                </div>
              </div>
              
              {/* Retry Information */}
              {(runDetailData.run.retryCount > 0 || runDetailData.run.nextRetryAt || runDetailData.run.lastErrorType) && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />
                      Retry Information
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Card className="bg-orange-50/50">
                        <CardContent className="pt-3 pb-3">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground block">Retry Attempts</span>
                          <p className="text-lg font-bold text-orange-700">
                            {runDetailData.run.retryCount} / {runDetailData.run.maxRetries}
                          </p>
                        </CardContent>
                      </Card>
                      {runDetailData.run.lastErrorType && (
                        <Card className="bg-muted/30">
                          <CardContent className="pt-3 pb-3">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground block">Error Type</span>
                            <p className="text-lg font-bold flex items-center gap-1.5">
                              {runDetailData.run.lastErrorType === 'rate_limit' && <ShieldAlert className="w-4 h-4 text-amber-600" />}
                              {runDetailData.run.lastErrorType === 'timeout' && <Clock className="w-4 h-4 text-blue-600" />}
                              {runDetailData.run.lastErrorType === 'transient' && <Wifi className="w-4 h-4 text-orange-600" />}
                              {runDetailData.run.lastErrorType === 'permanent' && <Ban className="w-4 h-4 text-red-600" />}
                              <span className="capitalize">{runDetailData.run.lastErrorType.replace('_', ' ')}</span>
                            </p>
                          </CardContent>
                        </Card>
                      )}
                      {runDetailData.run.nextRetryAt && (
                        <Card className="bg-blue-50/50">
                          <CardContent className="pt-3 pb-3">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground block">Next Retry</span>
                            <p className="text-sm font-bold text-blue-700">
                              {format(new Date(runDetailData.run.nextRetryAt), 'MMM d, HH:mm:ss')}
                            </p>
                            <p className="text-xs text-blue-500">
                              {formatDistanceToNow(new Date(runDetailData.run.nextRetryAt), { addSuffix: true })}
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                </>
              )}
              
              <Separator />
              
              {/* Results Summary */}
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Results Summary
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Card className="bg-muted/30">
                    <CardContent className="pt-3 pb-3">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground block">Products</span>
                      <p className="text-lg font-bold">{(runDetailData.run.totalItems || 0).toLocaleString()}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-muted/30">
                    <CardContent className="pt-3 pb-3">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground block">Total Spend</span>
                      <p className="text-lg font-bold">{formatSpend(runDetailData.run.totalSpend)}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-muted/30">
                    <CardContent className="pt-3 pb-3">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground block">Impressions</span>
                      <p className="text-lg font-bold">{(runDetailData.run.totalImpressions || 0).toLocaleString()}</p>
                    </CardContent>
                  </Card>
                  {(runDetailData.run.catalogItemsUpdated || 0) > 0 && (
                    <Card className="bg-muted/30">
                      <CardContent className="pt-3 pb-3">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground block">Catalog Updated</span>
                        <p className="text-lg font-bold text-emerald-600">
                          {(runDetailData.run.catalogItemsUpdated || 0).toLocaleString()}
                        </p>
                      </CardContent>
                    </Card>
                  )}
                  {(runDetailData.run.catalogErrors || 0) > 0 && (
                    <Card className="bg-muted/30">
                      <CardContent className="pt-3 pb-3">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground block">Catalog Errors</span>
                        <p className="text-lg font-bold text-red-600">
                          {(runDetailData.run.catalogErrors || 0).toLocaleString()}
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
              
              {/* Error Message */}
              {runDetailData.run.errorMessage && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider mb-2 text-red-600">Error</h3>
                    <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                      {runDetailData.run.errorMessage}
                    </div>
                  </div>
                </>
              )}
              
              {/* Linked Batch Jobs */}
              {runDetailData.jobDetails && runDetailData.jobDetails.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      Linked Jobs
                    </h3>
                    <div className="space-y-2">
                      {runDetailData.jobDetails.map((job) => (
                        <Card key={job.id} className="bg-muted/20">
                          <CardContent className="py-3 px-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-muted-foreground">Job #{job.id}</span>
                                <Badge variant="outline" className="text-xs">
                                  {job.jobType === 'report_generation' ? 'Report' : 
                                   (job.jobType as string) === 'report_and_catalog' ? 'Report + Catalog' : 'Catalog'}
                                </Badge>
                                {getStatusBadge(job.status)}
                              </div>
                              {job.reportId && (
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-7 text-xs gap-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setViewingReportId(job.reportId!);
                                    setDialogTab('report');
                                  }}
                                >
                                  <FileText className="w-3 h-3" />
                                  View Report
                                </Button>
                              )}
                            </div>
                            
                            <div className="grid grid-cols-3 gap-3 text-xs">
                              <div>
                                <span className="text-muted-foreground">Account:</span>
                                <span className="ml-1 font-mono">{(job.config as any)?.accountId || '—'}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Items:</span>
                                <span className="ml-1 font-medium">
                                  {job.processedItems?.toLocaleString() || 0}/{job.totalItems?.toLocaleString() || 0}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Success/Error:</span>
                                <span className="ml-1">
                                  <span className="text-emerald-600 font-medium">{job.successCount || 0}</span>
                                  /
                                  <span className="text-red-600 font-medium">{job.errorCount || 0}</span>
                                </span>
                              </div>
                            </div>
                            
                            {job.statusMessage && (
                              <p className="text-xs text-muted-foreground mt-2 break-words">
                                {job.statusMessage}
                              </p>
                            )}
                            
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              {job.startedAt && (
                                <span>
                                  <Clock className="w-3 h-3 inline mr-1" />
                                  {format(new Date(job.startedAt), 'HH:mm:ss')}
                                </span>
                              )}
                              {job.completedAt && (
                                <span>
                                  → {format(new Date(job.completedAt), 'HH:mm:ss')}
                                </span>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
