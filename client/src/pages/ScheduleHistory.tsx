import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  ChevronRight,
  History,
  Zap,
  CalendarClock,
  RefreshCw,
  ShieldAlert,
  Wifi,
  Ban,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

export default function ScheduleHistory() {
  const params = useParams<{ id: string }>();
  const scheduleId = params.id ? parseInt(params.id) : 0;
  
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  
  const { data: historyData, isLoading, error: historyError } = trpc.schedules.getHistory.useQuery(
    { scheduleId, limit: 50 },
    { enabled: scheduleId > 0, retry: false }
  );
  
  const { data: runDetailData, isLoading: isLoadingDetail } = trpc.schedules.getRunDetail.useQuery(
    { runId: selectedRunId! },
    { enabled: selectedRunId !== null }
  );
  
  const runs = historyData?.runs || [];
  const scheduleName = historyData?.scheduleName || 'Schedule';
  
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

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="border-b border-border bg-background sticky top-0 z-20">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/schedules">
              <Button variant="ghost" size="sm" className="h-8">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <div className="bg-primary text-primary-foreground w-8 h-8 flex items-center justify-center font-bold text-lg">
              H
            </div>
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest">Execution History</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{scheduleName}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8">
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
              <p className="text-sm mb-4">This schedule hasn't been executed yet. Use "Run Now" to trigger it.</p>
              <Link href="/schedules">
                <Button variant="outline">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Schedules
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                  <p className="text-2xl font-bold text-emerald-600">
                    {runs.filter(r => r.status === 'completed').length}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                    <XCircle className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wider">Failed</span>
                  </div>
                  <p className="text-2xl font-bold text-red-600">
                    {runs.filter(r => r.status === 'failed').length}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center space-x-2 text-muted-foreground mb-1">
                    <Timer className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wider">Avg Duration</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {formatDuration(
                      runs.filter(r => r.durationMs).reduce((sum, r) => sum + (r.durationMs || 0), 0) / 
                      Math.max(runs.filter(r => r.durationMs).length, 1)
                    )}
                  </p>
                </CardContent>
              </Card>
            </div>
            
            {/* Run History List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="w-4 h-4" />
                  Execution History
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {runs.map((run) => (
                    <button
                      key={run.id}
                      className="w-full text-left px-6 py-4 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-wrap">
                          {getStatusBadge(run.status)}
                          {getTriggerBadge(run.triggerType)}
                          {/* Retry info */}
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
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                      
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        {/* Start Time */}
                        <div>
                          <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-0.5">Started</span>
                          <span className="font-medium">
                            {format(new Date(run.startedAt), 'MMM d, HH:mm:ss')}
                          </span>
                          <span className="text-xs text-muted-foreground block">
                            {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                          </span>
                        </div>
                        
                        {/* Duration */}
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
                        
                        {/* Items */}
                        <div>
                          <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-0.5">Products</span>
                          <span className="font-medium flex items-center gap-1">
                            <Package className="w-3 h-3 text-muted-foreground" />
                            {(run.totalItems || 0).toLocaleString()}
                          </span>
                        </div>
                        
                        {/* Jobs */}
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
                      
                      {/* Error Message */}
                      {run.errorMessage && (
                        <div className="mt-2 text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">
                          {run.errorMessage}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
      
      {/* Run Detail Dialog */}
      <Dialog open={selectedRunId !== null} onOpenChange={(open) => { if (!open) setSelectedRunId(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Run Detail
              {runDetailData?.run && getStatusBadge(runDetailData.run.status)}
            </DialogTitle>
          </DialogHeader>
          
          {isLoadingDetail ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : runDetailData?.run ? (
            <div className="space-y-6">
              {/* Overview */}
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
              
              {/* Aggregated Results */}
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
                      Batch Jobs ({runDetailData.jobDetails.length})
                    </h3>
                    <div className="space-y-2">
                      {runDetailData.jobDetails.map((job) => (
                        <Card key={job.id} className="bg-muted/20">
                          <CardContent className="py-3 px-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-muted-foreground">Job #{job.id}</span>
                                <Badge variant="outline" className="text-xs">
                                  {job.jobType === 'report_generation' ? 'Report' : 'Catalog'}
                                </Badge>
                                {getStatusBadge(job.status)}
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-3 gap-3 text-xs">
                              <div>
                                <span className="text-muted-foreground">Account:</span>
                                <span className="ml-1 font-mono">{job.config?.adAccountId || job.config?.catalogId || '—'}</span>
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
                              <p className="text-xs text-muted-foreground mt-2 truncate">
                                {job.statusMessage}
                              </p>
                            )}
                            
                            {/* Timing */}
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
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
