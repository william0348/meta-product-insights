import React from 'react';
import { AsyncJobStatus } from '../types';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, CircleDashed, AlertCircle, XCircle, Clock } from 'lucide-react';

interface Props {
  status: AsyncJobStatus;
  percent: number;
}

export const StatusBadge: React.FC<Props> = ({ status, percent }) => {
  switch (status) {
    case AsyncJobStatus.COMPLETED:
      return (
        <Badge variant="outline" className="rounded-none border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400 gap-1.5 py-1 px-2.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wider text-[10px] font-bold">Completed</span>
        </Badge>
      );
    case AsyncJobStatus.RUNNING:
    case AsyncJobStatus.STARTED:
      return (
        <Badge variant="outline" className="rounded-none border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400 gap-1.5 py-1 px-2.5">
          <CircleDashed className="w-3.5 h-3.5 animate-spin" />
          <span className="uppercase tracking-wider text-[10px] font-bold">Running ({percent}%)</span>
        </Badge>
      );
    case AsyncJobStatus.FAILED:
      return (
        <Badge variant="destructive" className="rounded-none gap-1.5 py-1 px-2.5">
          <XCircle className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wider text-[10px] font-bold">Failed</span>
        </Badge>
      );
    case AsyncJobStatus.SKIPPED:
      return (
        <Badge variant="secondary" className="rounded-none gap-1.5 py-1 px-2.5">
          <AlertCircle className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wider text-[10px] font-bold">Skipped</span>
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="rounded-none border-border text-muted-foreground gap-1.5 py-1 px-2.5">
          <Clock className="w-3.5 h-3.5" />
          <span className="uppercase tracking-wider text-[10px] font-bold">Not Started</span>
        </Badge>
      );
  }
};
