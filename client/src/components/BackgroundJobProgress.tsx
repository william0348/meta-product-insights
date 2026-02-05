import React, { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, CheckCircle2, XCircle, Clock, X } from 'lucide-react';

interface BackgroundJobProgressProps {
  jobId: number;
  onComplete?: (success: boolean) => void;
  onClose?: () => void;
}

export const BackgroundJobProgress: React.FC<BackgroundJobProgressProps> = ({
  jobId,
  onComplete,
  onClose,
}) => {
  const [isPolling, setIsPolling] = useState(true);
  
  const { data: jobData, refetch } = trpc.jobs.getStatus.useQuery(
    { jobId },
    { 
      refetchInterval: isPolling ? 2000 : false, // Poll every 2 seconds while active
      refetchOnWindowFocus: false,
    }
  );
  
  const cancelMutation = trpc.jobs.cancel.useMutation();
  
  const job = jobData?.job;
  
  // Stop polling when job is complete
  useEffect(() => {
    if (job && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')) {
      setIsPolling(false);
      if (onComplete) {
        onComplete(job.status === 'completed');
      }
    }
  }, [job?.status, onComplete]);
  
  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync({ jobId });
      refetch();
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };
  
  if (!jobData?.found || !job) {
    return (
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading job status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  const getStatusIcon = () => {
    switch (job.status) {
      case 'queued':
        return <Clock className="w-5 h-5 text-muted-foreground" />;
      case 'running':
        return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-destructive" />;
      case 'cancelled':
        return <X className="w-5 h-5 text-muted-foreground" />;
      default:
        return null;
    }
  };
  
  const getStatusText = () => {
    switch (job.status) {
      case 'queued':
        return 'Waiting in queue...';
      case 'running':
        return job.statusMessage || 'Processing...';
      case 'completed':
        return `Completed: ${job.successCount} success, ${job.errorCount} errors`;
      case 'failed':
        return job.statusMessage || 'Job failed';
      case 'cancelled':
        return 'Cancelled by user';
      default:
        return job.status;
    }
  };
  
  const isActive = job.status === 'queued' || job.status === 'running';
  
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {getStatusIcon()}
            <span>Background Job #{job.id}</span>
          </CardTitle>
          {onClose && !isActive && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{getStatusText()}</span>
            <span>{job.progress}%</span>
          </div>
          <Progress value={job.progress} className="h-2" />
        </div>
        
        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="text-center">
            <div className="font-mono text-lg">{job.processedItems || 0}</div>
            <div className="text-muted-foreground">Processed</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-lg">{job.totalItems || 0}</div>
            <div className="text-muted-foreground">Total</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-lg text-green-600">{job.successCount || 0}</div>
            <div className="text-muted-foreground">Success</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-lg text-destructive">{job.errorCount || 0}</div>
            <div className="text-muted-foreground">Errors</div>
          </div>
        </div>
        
        {/* Batch progress */}
        {job.totalBatches && job.totalBatches > 0 && (
          <div className="text-xs text-muted-foreground text-center">
            Batch {job.currentBatch || 0} of {job.totalBatches}
          </div>
        )}
        
        {/* Errors preview */}
        {job.errors && job.errors.length > 0 && (
          <div className="text-xs text-destructive bg-destructive/10 p-2 rounded max-h-20 overflow-y-auto">
            <div className="font-medium mb-1">Recent errors:</div>
            {job.errors.slice(0, 3).map((err, i) => (
              <div key={i} className="truncate">
                {err.retailerId && `[${err.retailerId}] `}{err.message}
              </div>
            ))}
            {job.errors.length > 3 && (
              <div className="text-muted-foreground">...and {job.errors.length - 3} more</div>
            )}
          </div>
        )}
        
        {/* Cancel button */}
        {isActive && (
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full"
            onClick={handleCancel}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Cancelling...
              </>
            ) : (
              'Cancel Job'
            )}
          </Button>
        )}
        
        {/* Timing info */}
        {job.startedAt && (
          <div className="text-xs text-muted-foreground text-center">
            Started: {new Date(job.startedAt).toLocaleTimeString()}
            {job.completedAt && (
              <> • Completed: {new Date(job.completedAt).toLocaleTimeString()}</>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
