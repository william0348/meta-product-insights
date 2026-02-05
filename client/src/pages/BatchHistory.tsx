import React, { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  History, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronUp,
  ArrowLeft
} from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';

interface BatchHistoryRecord {
  id: number;
  userId: number;
  catalogId: string;
  operationType: 'UPDATE' | 'DELETE' | 'CREATE';
  totalItems: number;
  batchCount: number;
  updatedFields: string[] | null;
  updateCriteria: {
    sourceField?: string;
    targetField?: string;
    condition?: string;
    description?: string;
  } | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  successCount: number | null;
  errorCount: number | null;
  warningCount: number | null;
  handles: string[] | null;
  errors: Array<{ retailerId: string; message: string }> | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
}

const StatusBadge = ({ status }: { status: string }) => {
  switch (status) {
    case 'completed':
      return (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Completed
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          <XCircle className="w-3 h-3 mr-1" />
          Failed
        </Badge>
      );
    case 'processing':
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
          <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
          Processing
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
          <Clock className="w-3 h-3 mr-1" />
          Pending
        </Badge>
      );
  }
};

const OperationBadge = ({ type }: { type: string }) => {
  switch (type) {
    case 'UPDATE':
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800">UPDATE</Badge>;
    case 'DELETE':
      return <Badge variant="secondary" className="bg-red-100 text-red-800">DELETE</Badge>;
    case 'CREATE':
      return <Badge variant="secondary" className="bg-green-100 text-green-800">CREATE</Badge>;
    default:
      return <Badge variant="secondary">{type}</Badge>;
  }
};

const formatDuration = (ms: number | null): string => {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

const ExpandedRow = ({ record }: { record: BatchHistoryRecord }) => {
  return (
    <TableRow className="bg-secondary/30">
      <TableCell colSpan={8} className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {/* Update Criteria */}
          {record.updateCriteria && (
            <div className="space-y-2">
              <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Update Criteria</h4>
              <div className="bg-background p-3 rounded border">
                {record.updateCriteria.description && (
                  <p className="mb-2">{record.updateCriteria.description}</p>
                )}
                {record.updateCriteria.sourceField && (
                  <p><span className="text-muted-foreground">Source:</span> {record.updateCriteria.sourceField}</p>
                )}
                {record.updateCriteria.targetField && (
                  <p><span className="text-muted-foreground">Target:</span> {record.updateCriteria.targetField}</p>
                )}
                {record.updateCriteria.condition && (
                  <p><span className="text-muted-foreground">Condition:</span> {record.updateCriteria.condition}</p>
                )}
              </div>
            </div>
          )}
          
          {/* Updated Fields */}
          {record.updatedFields && record.updatedFields.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Updated Fields</h4>
              <div className="flex flex-wrap gap-1">
                {record.updatedFields.map((field, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">{field}</Badge>
                ))}
              </div>
            </div>
          )}
          
          {/* Handles */}
          {record.handles && record.handles.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">API Handles</h4>
              <div className="bg-background p-2 rounded border font-mono text-xs max-h-20 overflow-y-auto">
                {record.handles.map((handle, idx) => (
                  <div key={idx} className="truncate">{handle}</div>
                ))}
              </div>
            </div>
          )}
          
          {/* Errors */}
          {record.errors && record.errors.length > 0 && (
            <div className="space-y-2 md:col-span-2">
              <h4 className="font-semibold text-xs uppercase tracking-wider text-red-600 flex items-center">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Errors ({record.errors.length})
              </h4>
              <div className="bg-red-50 p-3 rounded border border-red-200 max-h-32 overflow-y-auto">
                {record.errors.slice(0, 10).map((error, idx) => (
                  <div key={idx} className="text-xs text-red-700 mb-1">
                    <span className="font-mono">{error.retailerId}</span>: {error.message}
                  </div>
                ))}
                {record.errors.length > 10 && (
                  <div className="text-xs text-red-500 mt-2">
                    ... and {record.errors.length - 10} more errors
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

export default function BatchHistory() {
  const [catalogFilter, setCatalogFilter] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  
  const { data, isLoading, refetch, isRefetching } = trpc.batchHistory.getMyHistory.useQuery({
    limit: 100,
  });
  
  const toggleRow = (id: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };
  
  const filteredHistory = data?.history?.filter(record => 
    !catalogFilter || record.catalogId.includes(catalogFilter)
  ) || [];
  
  // Calculate summary stats
  const totalOperations = filteredHistory.length;
  const totalItems = filteredHistory.reduce((sum, r) => sum + r.totalItems, 0);
  const successfulOps = filteredHistory.filter(r => r.status === 'completed').length;
  const failedOps = filteredHistory.filter(r => r.status === 'failed').length;
  
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background sticky top-0 z-20">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
            </Link>
            <div className="flex items-center space-x-2">
              <History className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-bold">Batch Operation History</h1>
            </div>
          </div>
          
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </header>
      
      <main className="container py-8 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{totalOperations}</div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Operations</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{totalItems.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Items Processed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-emerald-600">{successfulOps}</div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Successful</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{failedOps}</div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Failed</p>
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
                Showing {filteredHistory.length} records
              </span>
            </div>
          </CardContent>
        </Card>
        
        {/* History Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-wider">Operation Log</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>No batch operations found</p>
                <p className="text-sm mt-2">Run a catalog batch update to see history here</p>
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
                    {filteredHistory.map((record) => (
                      <React.Fragment key={record.id}>
                        <TableRow 
                          className="cursor-pointer hover:bg-secondary/50"
                          onClick={() => toggleRow(record.id)}
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
                            <OperationBadge type={record.operationType} />
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {record.totalItems.toLocaleString()}
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
                            <StatusBadge status={record.status} />
                          </TableCell>
                        </TableRow>
                        {expandedRows.has(record.id) && (
                          <ExpandedRow record={record} />
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
