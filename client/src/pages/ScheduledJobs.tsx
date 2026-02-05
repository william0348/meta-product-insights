import { useState } from 'react';
import { Link } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  ArrowLeft, 
  Calendar, 
  Clock,
  Plus,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Building2,
  Copy
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

// Type for report configuration
interface ReportConfig {
  name?: string;
  adAccountId: string;
  minSpend?: string;
  minCTR?: string;
  dateRangeType?: string;
}

export default function ScheduledJobs() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    name: '',
    jobType: 'report_generation' as 'report_generation' | 'catalog_update',
    dayOfWeek: '1', // Monday
    hour: '9',
    minute: '0',
    dateRangeType: 'last_7_days',
  });
  
  // Multi-account configurations
  const [reportConfigs, setReportConfigs] = useState<ReportConfig[]>([
    { name: '', adAccountId: '', minSpend: '', minCTR: '' }
  ]);
  
  const { data: schedulesData, isLoading, refetch } = trpc.schedules.getMySchedules.useQuery({ limit: 50 });
  const { data: tokenData } = trpc.tokens.get.useQuery({ tokenType: 'ads_management' });
  
  const createMutation = trpc.schedules.create.useMutation({
    onSuccess: () => {
      refetch();
      setIsCreateOpen(false);
      // Reset form
      setReportConfigs([{ name: '', adAccountId: '', minSpend: '', minCTR: '' }]);
      setNewSchedule({
        name: '',
        jobType: 'report_generation',
        dayOfWeek: '1',
        hour: '9',
        minute: '0',
        dateRangeType: 'last_7_days',
      });
      toast.success('Schedule created successfully');
    },
    onError: (error) => {
      toast.error(`Failed to create schedule: ${error.message}`);
    },
  });
  
  const updateMutation = trpc.schedules.update.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('Schedule updated');
    },
  });
  
  const deleteMutation = trpc.schedules.delete.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('Schedule deleted');
    },
  });
  
  const schedules = schedulesData?.schedules || [];
  
  // Add a new report configuration
  const addReportConfig = () => {
    setReportConfigs([...reportConfigs, { name: '', adAccountId: '', minSpend: '', minCTR: '' }]);
  };
  
  // Remove a report configuration
  const removeReportConfig = (index: number) => {
    if (reportConfigs.length > 1) {
      setReportConfigs(reportConfigs.filter((_, i) => i !== index));
    }
  };
  
  // Update a report configuration
  const updateReportConfig = (index: number, field: keyof ReportConfig, value: string) => {
    const updated = [...reportConfigs];
    updated[index] = { ...updated[index], [field]: value };
    setReportConfigs(updated);
  };
  
  // Copy default values from saved token to a config
  const copyDefaultsToConfig = (index: number) => {
    if (tokenData) {
      const updated = [...reportConfigs];
      updated[index] = {
        ...updated[index],
        adAccountId: tokenData.adAccountId || updated[index].adAccountId,
        minSpend: tokenData.minSpend || updated[index].minSpend,
        minCTR: tokenData.minCTR || updated[index].minCTR,
      };
      setReportConfigs(updated);
      toast.success('Copied default values');
    }
  };
  
  const handleCreateSchedule = () => {
    // Validate at least one config has adAccountId
    const validConfigs = reportConfigs.filter(c => c.adAccountId.trim());
    if (validConfigs.length === 0) {
      toast.error('Please add at least one Ad Account ID');
      return;
    }
    
    // Build cron expression: "second minute hour dayOfMonth month dayOfWeek"
    const cronExpression = `0 ${newSchedule.minute} ${newSchedule.hour} * * ${newSchedule.dayOfWeek}`;
    
    // Prepare report configs with dateRangeType
    const configsWithDateRange = validConfigs.map((c, i) => ({
      name: c.name || `Account ${i + 1}`,
      adAccountId: c.adAccountId.trim(),
      minSpend: c.minSpend?.trim() || undefined,
      minCTR: c.minCTR?.trim() || undefined,
      dateRangeType: c.dateRangeType || newSchedule.dateRangeType,
    }));
    
    createMutation.mutate({
      name: newSchedule.name || `Weekly Report - ${getDayName(parseInt(newSchedule.dayOfWeek))}`,
      jobType: newSchedule.jobType,
      cronExpression,
      config: {
        dateRangeType: newSchedule.dateRangeType,
        // Legacy single config (use first config)
        adAccountId: validConfigs[0].adAccountId,
        minSpend: validConfigs[0].minSpend || undefined,
        minCTR: validConfigs[0].minCTR || undefined,
      },
      reportConfigs: configsWithDateRange,
    });
  };
  
  const getDayName = (day: number) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[day];
  };
  
  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'success':
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><CheckCircle className="w-3 h-3 mr-1" /> Success</Badge>;
      case 'running':
        return <Badge className="bg-blue-100 text-blue-700 border-blue-200"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Running</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-700 border-red-200"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
      default:
        return <Badge variant="outline"><AlertCircle className="w-3 h-3 mr-1" /> Never Run</Badge>;
    }
  };
  
  const parseCronExpression = (cron: string) => {
    const parts = cron.split(' ');
    if (parts.length < 6) return { day: 'Unknown', time: 'Unknown' };
    
    const [, minute, hour, , , dayOfWeek] = parts;
    const day = dayOfWeek !== '*' ? getDayName(parseInt(dayOfWeek)) : 'Daily';
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    
    return { day, time };
  };
  
  // Get report configs count from schedule
  const getConfigCount = (schedule: any) => {
    if (schedule.reportConfigs && Array.isArray(schedule.reportConfigs)) {
      return schedule.reportConfigs.length;
    }
    return schedule.config?.adAccountId ? 1 : 0;
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
              S
            </div>
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest">Scheduled Jobs</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Automated Weekly Reports</p>
            </div>
          </div>
          
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8">
                <Plus className="w-4 h-4 mr-2" />
                New Schedule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Scheduled Job</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Schedule Name</Label>
                  <Input
                    placeholder="Weekly Product Report"
                    value={newSchedule.name}
                    onChange={(e) => setNewSchedule({ ...newSchedule, name: e.target.value })}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Job Type</Label>
                  <Select
                    value={newSchedule.jobType}
                    onValueChange={(v) => setNewSchedule({ ...newSchedule, jobType: v as any })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="report_generation">Report Generation</SelectItem>
                      <SelectItem value="catalog_update">Catalog Update</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Day of Week</Label>
                    <Select
                      value={newSchedule.dayOfWeek}
                      onValueChange={(v) => setNewSchedule({ ...newSchedule, dayOfWeek: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Sunday</SelectItem>
                        <SelectItem value="1">Monday</SelectItem>
                        <SelectItem value="2">Tuesday</SelectItem>
                        <SelectItem value="3">Wednesday</SelectItem>
                        <SelectItem value="4">Thursday</SelectItem>
                        <SelectItem value="5">Friday</SelectItem>
                        <SelectItem value="6">Saturday</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Hour</Label>
                    <Select
                      value={newSchedule.hour}
                      onValueChange={(v) => setNewSchedule({ ...newSchedule, hour: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, i) => (
                          <SelectItem key={i} value={i.toString()}>{i.toString().padStart(2, '0')}:00</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Minute</Label>
                    <Select
                      value={newSchedule.minute}
                      onValueChange={(v) => setNewSchedule({ ...newSchedule, minute: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">:00</SelectItem>
                        <SelectItem value="15">:15</SelectItem>
                        <SelectItem value="30">:30</SelectItem>
                        <SelectItem value="45">:45</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>Default Date Range</Label>
                  <Select
                    value={newSchedule.dateRangeType}
                    onValueChange={(v) => setNewSchedule({ ...newSchedule, dateRangeType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="last_7_days">Last 7 Days</SelectItem>
                      <SelectItem value="last_week">Last Week (Mon-Sun)</SelectItem>
                      <SelectItem value="last_14_days">Last 14 Days</SelectItem>
                      <SelectItem value="last_30_days">Last 30 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Multi-Account Configurations */}
                <div className="space-y-3 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">Account Configurations</Label>
                    <Button variant="outline" size="sm" onClick={addReportConfig}>
                      <Plus className="w-4 h-4 mr-1" />
                      Add Account
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Add multiple Ad Account IDs with different filter parameters. Each account will generate a separate report.
                  </p>
                  
                  {reportConfigs.map((config, index) => (
                    <Card key={index} className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Account {index + 1}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyDefaultsToConfig(index)}
                            title="Copy from saved settings"
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          {reportConfigs.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeReportConfig(index)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Config Name (Optional)</Label>
                          <Input
                            placeholder="e.g., Main Account, Brand A"
                            value={config.name || ''}
                            onChange={(e) => updateReportConfig(index, 'name', e.target.value)}
                          />
                        </div>
                        
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Ad Account ID *</Label>
                          <Input
                            placeholder="act_123456789"
                            value={config.adAccountId}
                            onChange={(e) => updateReportConfig(index, 'adAccountId', e.target.value)}
                          />
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Min Spend ($)</Label>
                          <Input
                            placeholder="e.g., 10"
                            value={config.minSpend || ''}
                            onChange={(e) => updateReportConfig(index, 'minSpend', e.target.value)}
                          />
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Min CTR (%)</Label>
                          <Input
                            placeholder="e.g., 1.0"
                            value={config.minCTR || ''}
                            onChange={(e) => updateReportConfig(index, 'minCTR', e.target.value)}
                          />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                
                <Button 
                  className="w-full" 
                  onClick={handleCreateSchedule}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4 mr-2" />
                  )}
                  Create Schedule ({reportConfigs.filter(c => c.adAccountId.trim()).length} account{reportConfigs.filter(c => c.adAccountId.trim()).length !== 1 ? 's' : ''})
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="container py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : schedules.length === 0 ? (
          <Card className="border-dashed max-w-md mx-auto">
            <CardContent className="py-12 text-center text-muted-foreground">
              <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No Scheduled Jobs</p>
              <p className="text-sm mb-4">Create a schedule to automatically generate reports weekly</p>
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Schedule
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {schedules.map((schedule) => {
              const { day, time } = parseCronExpression(schedule.cronExpression);
              const configCount = getConfigCount(schedule);
              
              return (
                <Card key={schedule.id} className="relative">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{schedule.name}</CardTitle>
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={(enabled) => {
                          updateMutation.mutate({ scheduleId: schedule.id, enabled });
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {schedule.jobType === 'report_generation' ? 'Report Generation' : 'Catalog Update'}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Schedule Time */}
                    <div className="flex items-center text-sm">
                      <Clock className="w-4 h-4 mr-2 text-muted-foreground" />
                      <span className="font-medium">{day}</span>
                      <span className="mx-2 text-muted-foreground">at</span>
                      <span className="font-medium">{time}</span>
                    </div>
                    
                    {/* Account Count */}
                    <div className="flex items-center text-sm">
                      <Building2 className="w-4 h-4 mr-2 text-muted-foreground" />
                      <span>{configCount} account{configCount !== 1 ? 's' : ''}</span>
                    </div>
                    
                    {/* Last Run Status */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Last Run:</span>
                      {getStatusBadge(schedule.lastRunStatus)}
                    </div>
                    
                    {/* Next Run */}
                    {schedule.nextRunAt && (
                      <div className="text-xs text-muted-foreground">
                        Next: {format(new Date(schedule.nextRunAt), 'MMM d, yyyy HH:mm')}
                      </div>
                    )}
                    
                    {/* Run Count */}
                    <div className="text-xs text-muted-foreground">
                      Total runs: {schedule.runCount || 0}
                    </div>
                    
                    {/* Actions */}
                    <div className="flex items-center justify-end space-x-2 pt-2 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this schedule?')) {
                            deleteMutation.mutate({ scheduleId: schedule.id });
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
