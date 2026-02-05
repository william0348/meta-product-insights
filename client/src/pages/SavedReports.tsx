import { useState } from 'react';
import { Link } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  ArrowLeft, 
  FileText, 
  Calendar, 
  DollarSign, 
  Package,
  Trash2,
  Eye,
  Clock,
  CheckCircle,
  XCircle,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';

export default function SavedReports() {
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  
  const { data: reportsData, isLoading, refetch } = trpc.reports.getMyReports.useQuery({ limit: 50 });
  const { data: reportDetail, isLoading: isLoadingDetail } = trpc.reports.get.useQuery(
    { reportId: selectedReportId! },
    { enabled: !!selectedReportId }
  );
  
  const deleteMutation = trpc.reports.delete.useMutation({
    onSuccess: () => {
      refetch();
      setSelectedReportId(null);
    },
  });
  
  const reports = reportsData?.reports || [];
  
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><CheckCircle className="w-3 h-3 mr-1" /> Completed</Badge>;
      case 'generating':
        return <Badge className="bg-blue-100 text-blue-700 border-blue-200"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Generating</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-700 border-red-200"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };
  
  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="border-b border-border bg-background sticky top-0 z-20">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="h-8">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <div className="bg-primary text-primary-foreground w-8 h-8 flex items-center justify-center font-bold text-lg">
              R
            </div>
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest">Saved Reports</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">View Generated Reports</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Reports List */}
          <div className="lg:col-span-4 space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold uppercase tracking-tight flex items-center">
                <FileText className="w-4 h-4 mr-2" />
                Reports
              </h2>
              <span className="text-xs text-muted-foreground bg-secondary px-2 py-1">
                {reports.length} total
              </span>
            </div>
            
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : reports.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">No saved reports yet</p>
                  <p className="text-xs mt-2">Generate a report from the main page</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {reports.map((report) => (
                  <Card 
                    key={report.id}
                    className={`cursor-pointer transition-all hover:border-primary/50 ${
                      selectedReportId === report.id ? 'border-primary bg-primary/5' : ''
                    }`}
                    onClick={() => setSelectedReportId(report.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-medium text-sm truncate flex-1">{report.name}</h3>
                        {getStatusBadge(report.status)}
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div className="flex items-center">
                          <Calendar className="w-3 h-3 mr-1" />
                          {report.dateStart} → {report.dateEnd}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center">
                            <Package className="w-3 h-3 mr-1" />
                            {report.totalItems || 0} items
                          </span>
                          <span className="flex items-center">
                            <DollarSign className="w-3 h-3 mr-1" />
                            {formatCurrency(report.totalSpend)}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          {report.generatedAt ? format(new Date(report.generatedAt), 'MMM d, yyyy HH:mm') : 'Pending'}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Report Detail */}
          <div className="lg:col-span-8">
            {selectedReportId ? (
              isLoadingDetail ? (
                <div className="flex items-center justify-center py-24">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : reportDetail?.report ? (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{reportDetail.report.name}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        Account: {reportDetail.report.adAccountId} | {reportDetail.report.dateStart} → {reportDetail.report.dateEnd}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this report?')) {
                            deleteMutation.mutate({ reportId: selectedReportId });
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* Report Statistics */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div className="bg-secondary/50 p-4 text-center">
                        <p className="text-2xl font-bold">{reportDetail.report.totalItems || 0}</p>
                        <p className="text-xs text-muted-foreground uppercase">Total Items</p>
                      </div>
                      <div className="bg-secondary/50 p-4 text-center">
                        <p className="text-2xl font-bold">{formatCurrency(reportDetail.report.totalSpend)}</p>
                        <p className="text-xs text-muted-foreground uppercase">Total Spend</p>
                      </div>
                      <div className="bg-secondary/50 p-4 text-center">
                        <p className="text-2xl font-bold">{reportDetail.report.totalImpressions?.toLocaleString() || 0}</p>
                        <p className="text-xs text-muted-foreground uppercase">Impressions</p>
                      </div>
                    </div>
                    
                    {/* Report Data Table */}
                    {reportDetail.report.data && reportDetail.report.data.length > 0 ? (
                      <div className="border rounded-lg overflow-hidden">
                        <div className="overflow-x-auto max-h-[500px]">
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
                              {reportDetail.report.data.slice(0, 100).map((item, idx) => (
                                <tr key={idx} className="border-t hover:bg-secondary/30">
                                  <td className="p-2">
                                    <div className="font-medium truncate max-w-[200px]">{item.product_name}</div>
                                    <div className="text-muted-foreground">{item.product_retailer_id}</div>
                                  </td>
                                  <td className="text-right p-2">{formatCurrency(item.spend)}</td>
                                  <td className="text-right p-2">{item.impressions?.toLocaleString()}</td>
                                  <td className="text-right p-2">{item.link_clicks?.toLocaleString()}</td>
                                  <td className="text-right p-2">{(item.inline_link_click_ctr || 0).toFixed(2)}%</td>
                                  <td className="text-right p-2">{item.purchases}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {reportDetail.report.data.length > 100 && (
                          <div className="text-center py-2 text-xs text-muted-foreground bg-secondary/30">
                            Showing 100 of {reportDetail.report.data.length} items
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <Eye className="w-8 h-8 mx-auto mb-4 opacity-50" />
                        <p>No data available for this report</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : null
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
                <Eye className="w-12 h-12 mb-4 opacity-30" />
                <p className="text-sm">Select a report to view details</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
