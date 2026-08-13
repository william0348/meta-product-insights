import { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
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
  Copy,
  Pencil,
  Play,
  History
} from 'lucide-react';
import { toast } from 'sonner';
import { formatTaipei } from '@/lib/utils';

// Type for report configuration
interface ReportConfig {
  name?: string;
  adAccountId: string;
  minSpend?: string;
  minCTR?: string;
  maxSpend?: string;
  maxCVR?: string;
  dateRangeType?: string;
}

// Type for custom number field
interface CustomNumberField {
  enabled: boolean;
  value: string;
}

interface CustomLabelField {
  enabled: boolean;
  value: string;
}

// Type for schedule form data
interface ScheduleFormData {
  name: string;
  jobType: 'report_generation' | 'catalog_update' | 'report_and_catalog';
  dayOfWeek: string;
  hour: string;
  minute: string;
  dateRangeType: string;
  topConversionLimit: string; // 'all' | '5000' | '10000'
}

const defaultFormData: ScheduleFormData = {
  name: '',
  jobType: 'report_generation',
  dayOfWeek: '1',
  hour: '9',
  minute: '0',
  dateRangeType: 'last_7_days',
  topConversionLimit: 'all',
};

const defaultCustomNumbers: CustomNumberField[] = [
  { enabled: false, value: '' },
  { enabled: false, value: '' },
  { enabled: false, value: '' },
  { enabled: false, value: '' },
  { enabled: false, value: '' },
];

const defaultCustomLabels: CustomLabelField[] = [
  { enabled: false, value: '' },
  { enabled: false, value: '' },
  { enabled: false, value: '' },
  { enabled: false, value: '' },
  { enabled: false, value: '' },
];

export default function ScheduledJobs() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ScheduleFormData>(defaultFormData);
  const [customNumbers, setCustomNumbers] = useState<CustomNumberField[]>(defaultCustomNumbers);
  const [customLabels, setCustomLabels] = useState<CustomLabelField[]>(defaultCustomLabels);
  const [reportConfigs, setReportConfigs] = useState<ReportConfig[]>([
    { name: '', adAccountId: '', minSpend: '', minCTR: '', maxSpend: '', maxCVR: '' }
  ]);
  
  const queryClient = useQueryClient();

  const { data: schedulesData, isLoading } = useQuery({ queryKey: ['schedules'], queryFn: () => apiClient.schedules.getMySchedules(50) });
  const { data: tokenData } = useQuery({ queryKey: ['tokens', 'ads_management'], queryFn: () => apiClient.tokens.get('ads_management') });
  const { data: catalogTokenData } = useQuery({ queryKey: ['tokens', 'catalog_management'], queryFn: () => apiClient.tokens.get('catalog_management') });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.schedules.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      closeDialog();
      toast.success('Schedule created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create schedule: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { scheduleId: number; [key: string]: any }) => apiClient.schedules.update(vars.scheduleId, vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      if (editingScheduleId) {
        closeDialog();
        toast.success('Schedule updated successfully');
      } else {
        toast.success('Schedule updated');
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update schedule: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (data: { scheduleId: number }) => apiClient.schedules.delete(data.scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('Schedule deleted');
    },
  });

  const runNowMutation = useMutation({
    mutationFn: (data: { scheduleId: number }) => apiClient.schedules.runNow(data.scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('Schedule triggered! Check Reports page for results.');
    },
    onError: (error: Error) => {
      toast.error(`Failed to run schedule: ${error.message}`);
    },
  });
  
  const schedules = schedulesData?.schedules || [];
  
  // Reset form to defaults
  const resetForm = () => {
    setFormData(defaultFormData);
    setCustomNumbers(defaultCustomNumbers);
    setCustomLabels(defaultCustomLabels);
    setReportConfigs([{ name: '', adAccountId: '', minSpend: '', minCTR: '', maxSpend: '', maxCVR: '' }]);
    setEditingScheduleId(null);
  };
  
  // Close dialog and reset
  const closeDialog = () => {
    setIsDialogOpen(false);
    resetForm();
  };
  
  // Open dialog for creating new schedule
  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };
  
  // Open dialog for editing existing schedule
  const openEditDialog = (schedule: any) => {
    setEditingScheduleId(schedule.id);
    
    // Parse cron expression to get day, hour, minute
    const cronParts = schedule.cronExpression.split(' ');
    const [, minute, hour, , , dayOfWeek] = cronParts;
    
    // Set form data
    setFormData({
      name: schedule.name || '',
      jobType: schedule.jobType || 'report_generation',
      dayOfWeek: dayOfWeek || '1',
      hour: hour || '9',
      minute: minute || '0',
      dateRangeType: schedule.config?.dateRangeType || 'last_7_days',
      topConversionLimit: schedule.config?.topConversionLimit ? String(schedule.config.topConversionLimit) : 'all',
    });
    
    // Set custom numbers
    const configCustomNumbers = schedule.config?.customNumbers || {};
    const newCustomNumbers = defaultCustomNumbers.map((_, index) => {
      const key = `custom_number_${index}`;
      const value = configCustomNumbers[key];
      return {
        enabled: value !== undefined && value !== '',
        value: value?.toString() || '',
      };
    });
    setCustomNumbers(newCustomNumbers);
    
    // Set custom labels
    const configCustomLabels = schedule.config?.customLabels || {};
    const newCustomLabels = defaultCustomLabels.map((_, index) => {
      const key = `custom_label_${index}`;
      const value = configCustomLabels[key];
      return {
        enabled: value !== undefined && value !== '',
        value: value?.toString() || '',
      };
    });
    setCustomLabels(newCustomLabels);
    
    // Set report configs
    if (schedule.reportConfigs && Array.isArray(schedule.reportConfigs) && schedule.reportConfigs.length > 0) {
      setReportConfigs(schedule.reportConfigs.map((c: any) => ({
        name: c.name || '',
        adAccountId: c.adAccountId || '',
        minSpend: c.minSpend || '',
        minCTR: c.minCTR || '',
        maxSpend: c.maxSpend || '',
        maxCVR: c.maxCVR || '',
        dateRangeType: c.dateRangeType || '',
      })));
    } else if (schedule.config?.adAccountId) {
      setReportConfigs([{
        name: '',
        adAccountId: schedule.config.adAccountId,
        minSpend: schedule.config.minSpend || '',
        minCTR: schedule.config.minCTR || '',
        maxSpend: schedule.config.maxSpend || '',
        maxCVR: schedule.config.maxCVR || '',
        dateRangeType: schedule.config.dateRangeType || '',
      }]);
    } else {
      setReportConfigs([{ name: '', adAccountId: '', minSpend: '', minCTR: '', maxSpend: '', maxCVR: '' }]);
    }
    
    setIsDialogOpen(true);
  };
  
  // Add a new report configuration
  const addReportConfig = () => {
    setReportConfigs([...reportConfigs, { name: '', adAccountId: '', minSpend: '', minCTR: '', maxSpend: '', maxCVR: '' }]);
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
        maxSpend: tokenData.maxSpend || updated[index].maxSpend,
        maxCVR: tokenData.maxCVR || updated[index].maxCVR,
      };
      setReportConfigs(updated);
      toast.success('Copied default values');
    }
  };
  
  const handleSubmit = () => {
    // Validate at least one config has adAccountId
    const validConfigs = reportConfigs.filter(c => c.adAccountId.trim());
    if (validConfigs.length === 0) {
      toast.error('Please add at least one Ad Account ID');
      return;
    }
    
    // Build cron expression: "second minute hour dayOfMonth month dayOfWeek"
    const cronExpression = `0 ${formData.minute} ${formData.hour} * * ${formData.dayOfWeek}`;
    
    // Prepare report configs with dateRangeType
    const configsWithDateRange = validConfigs.map((c, i) => ({
      name: c.name || `Account ${i + 1}`,
      adAccountId: c.adAccountId.trim(),
      minSpend: c.minSpend?.trim() || undefined,
      minCTR: c.minCTR?.trim() || undefined,
      maxSpend: c.maxSpend?.trim() || undefined,
      maxCVR: c.maxCVR?.trim() || undefined,
      dateRangeType: c.dateRangeType || formData.dateRangeType,
    }));
    
    // Build config object with catalog settings for combined workflow
    const config: Record<string, any> = {
      dateRangeType: formData.dateRangeType,
      adAccountId: validConfigs[0].adAccountId,
      minSpend: validConfigs[0].minSpend || undefined,
      minCTR: validConfigs[0].minCTR || undefined,
      maxSpend: validConfigs[0].maxSpend || undefined,
      maxCVR: validConfigs[0].maxCVR || undefined,
      topConversionLimit: formData.topConversionLimit !== 'all' ? parseInt(formData.topConversionLimit) : undefined,
    };
    
    // Add catalog settings for combined workflow
    if (formData.jobType === 'report_and_catalog') {
      config.updateToCatalog = true;
      config.catalogId = catalogTokenData?.catalogId;
      config.catalogAccessToken = catalogTokenData?.accessToken;

      // Add custom_number fields (0-4)
      const customNumbersConfig: Record<string, string> = {};
      customNumbers.forEach((cn, index) => {
        if (cn.enabled && cn.value.trim()) {
          customNumbersConfig[`custom_number_${index}`] = cn.value.trim();
        }
      });
      config.customNumbers = customNumbersConfig;
      
      // Add custom_label fields (0-4)
      const customLabelsConfig: Record<string, string> = {};
      customLabels.forEach((cl, index) => {
        if (cl.enabled && cl.value.trim()) {
          customLabelsConfig[`custom_label_${index}`] = cl.value.trim();
        }
      });
      config.customLabels = customLabelsConfig;
    }
    
    if (editingScheduleId) {
      // Update existing schedule
      updateMutation.mutate({
        scheduleId: editingScheduleId,
        name: formData.name || (formData.dayOfWeek === '*' ? 'Daily Report' : `Weekly Report - ${getDayName(parseInt(formData.dayOfWeek))}`),
        jobType: formData.jobType,
        cronExpression,
        config,
        reportConfigs: configsWithDateRange,
      });
    } else {
      // Create new schedule
      createMutation.mutate({
        name: formData.name || (formData.dayOfWeek === '*' ? 'Daily Report' : `Weekly Report - ${getDayName(parseInt(formData.dayOfWeek))}`),
        jobType: formData.jobType,
        cronExpression,
        config,
        reportConfigs: configsWithDateRange,
      });
    }
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
  
  const getConfigCount = (schedule: any) => {
    if (schedule.reportConfigs && Array.isArray(schedule.reportConfigs)) {
      return schedule.reportConfigs.length;
    }
    return schedule.config?.adAccountId ? 1 : 0;
  };
  
  const getJobTypeLabel = (jobType: string) => {
    switch (jobType) {
      case 'report_generation':
        return 'Report Generation';
      case 'catalog_update':
        return 'Catalog Update';
      case 'report_and_catalog':
        return 'Report + Catalog Update';
      default:
        return jobType;
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

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
          
          <Button size="sm" className="h-8" onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" />
            New Schedule
          </Button>
        </div>
      </header>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setIsDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingScheduleId ? 'Edit Schedule' : 'Create Scheduled Job'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Schedule Name</Label>
              <Input
                placeholder="Weekly Product Report"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            
            <div className="space-y-2">
              <Label>Job Type</Label>
              <Select
                value={formData.jobType}
                onValueChange={(value: 'report_generation' | 'catalog_update' | 'report_and_catalog') => 
                  setFormData({ ...formData, jobType: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="report_generation">Report Generation Only</SelectItem>
                  <SelectItem value="report_and_catalog">Report + Catalog Update</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Frequency / Day of Week</Label>
                <Select
                  value={formData.dayOfWeek}
                  onValueChange={(value) => setFormData({ ...formData, dayOfWeek: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="*">Daily (every day)</SelectItem>
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
                  value={formData.hour}
                  onValueChange={(value) => setFormData({ ...formData, hour: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={i.toString()}>
                        {i.toString().padStart(2, '0')}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Minute</Label>
                <Select
                  value={formData.minute}
                  onValueChange={(value) => setFormData({ ...formData, minute: value })}
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
              <Label>Date Range</Label>
              <Select
                value={formData.dateRangeType}
                onValueChange={(value) => setFormData({ ...formData, dateRangeType: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last_7_days">Last 7 Days</SelectItem>
                  <SelectItem value="last_14_days">Last 14 Days</SelectItem>
                  <SelectItem value="last_30_days">Last 30 Days</SelectItem>
                  <SelectItem value="last_week">Last Week (Mon-Sun)</SelectItem>
                  <SelectItem value="this_month">This Month</SelectItem>
                  <SelectItem value="last_month">Last Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Top Conversion Limit */}
            <div className="space-y-2">
              <Label>Top Conversion Limit</Label>
              <Select
                value={formData.topConversionLimit}
                onValueChange={(value) => setFormData({ ...formData, topConversionLimit: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Products (No Limit)</SelectItem>
                  <SelectItem value="5000">Top 5,000 by Conversion</SelectItem>
                  <SelectItem value="10000">Top 10,000 by Conversion</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Limit saved report to top N products sorted by total conversions (Ad Purchases + Catalog Purchases) descending
              </p>
            </div>
            
            {/* Catalog Update Settings - only show for combined workflow */}
            {formData.jobType === 'report_and_catalog' && (
              <div className="space-y-4 p-4 bg-secondary/30 rounded-lg border">
                <div>
                  <h4 className="font-medium mb-1">Catalog Update Settings</h4>
                  <p className="text-xs text-muted-foreground">
                    After generating the report, products will be updated in your catalog with the specified label.
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Catalog ID</Label>
                    <Input
                      value={catalogTokenData?.catalogId || ''}
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-[10px] text-muted-foreground">Uses your saved catalog settings</p>
                  </div>
                  
                </div>

                {/* Custom Number Fields */}
                <div className="space-y-3">
                  <Label>Custom Number Fields</Label>
                  <p className="text-xs text-muted-foreground">Enable and set values for custom_number_0 to custom_number_4</p>
                  
                  <div className="grid grid-cols-1 gap-2">
                    {customNumbers.map((cn, index) => (
                      <div key={index} className="flex items-center gap-3 p-2 bg-background rounded border">
                        <Switch
                          checked={cn.enabled}
                          onCheckedChange={(checked) => {
                            const updated = [...customNumbers];
                            updated[index] = { ...updated[index], enabled: checked };
                            setCustomNumbers(updated);
                          }}
                        />
                        <span className="text-sm font-mono w-32">custom_number_{index}</span>
                        <Input
                          type="number"
                          placeholder="Value"
                          value={cn.value}
                          onChange={(e) => {
                            const updated = [...customNumbers];
                            updated[index] = { ...updated[index], value: e.target.value };
                            setCustomNumbers(updated);
                          }}
                          disabled={!cn.enabled}
                          className="flex-1"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Custom Label Fields (0-4) */}
                <div className="space-y-3">
                  <Label>Custom Label Fields</Label>
                  <p className="text-xs text-muted-foreground">Enable and set values for custom_label_0 to custom_label_4</p>
                  
                  <div className="grid grid-cols-1 gap-2">
                    {customLabels.map((cl, index) => (
                      <div key={index} className="flex items-center gap-3 p-2 bg-background rounded border">
                        <Switch
                          checked={cl.enabled}
                          onCheckedChange={(checked) => {
                            const updated = [...customLabels];
                            updated[index] = { ...updated[index], enabled: checked };
                            setCustomLabels(updated);
                          }}
                        />
                        <span className="text-sm font-mono w-32">custom_label_{index}</span>
                        <Input
                          type="text"
                          placeholder="Label value"
                          value={cl.value}
                          onChange={(e) => {
                            const updated = [...customLabels];
                            updated[index] = { ...updated[index], value: e.target.value };
                            setCustomLabels(updated);
                          }}
                          disabled={!cl.enabled}
                          className="flex-1"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            {/* Multi-Account Configurations */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Account Configurations</Label>
                  <p className="text-xs text-muted-foreground">Add multiple accounts to generate reports for each</p>
                </div>
                <Button variant="outline" size="sm" onClick={addReportConfig}>
                  <Plus className="w-3 h-3 mr-1" />
                  Add Account
                </Button>
              </div>
              
              {reportConfigs.map((config, index) => (
                <Card key={index} className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Account {index + 1}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyDefaultsToConfig(index)}
                        title="Copy from saved settings"
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                      {reportConfigs.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeReportConfig(index)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1 col-span-2">
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
                      <Label className="text-xs">Max Spend ($)</Label>
                      <Input
                        placeholder="e.g., 5000"
                        value={config.maxSpend || ''}
                        onChange={(e) => updateReportConfig(index, 'maxSpend', e.target.value)}
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
                    
                    <div className="space-y-1">
                      <Label className="text-xs">Max CVR (%)</Label>
                      <Input
                        placeholder="e.g., 10"
                        value={config.maxCVR || ''}
                        onChange={(e) => updateReportConfig(index, 'maxCVR', e.target.value)}
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            
            <Button 
              className="w-full" 
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : editingScheduleId ? (
                <Pencil className="w-4 h-4 mr-2" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              {editingScheduleId ? 'Update Schedule' : `Create Schedule (${reportConfigs.filter(c => c.adAccountId.trim()).length} account${reportConfigs.filter(c => c.adAccountId.trim()).length !== 1 ? 's' : ''})`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
              <Button onClick={openCreateDialog}>
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
                      {getJobTypeLabel(schedule.jobType)}
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
                        Next: {formatTaipei(schedule.nextRunAt, 'MMM d, yyyy HH:mm', { withTz: true })}
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
                          if (confirm('Run this schedule now? This will create report generation jobs immediately.')) {
                            runNowMutation.mutate({ scheduleId: schedule.id });
                          }
                        }}
                        disabled={runNowMutation.isPending}
                        title="Run Now"
                      >
                        {runNowMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </Button>
                      <Link href={`/schedule-history/${schedule.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="View History"
                        >
                          <History className="w-4 h-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(schedule)}
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this schedule?')) {
                            deleteMutation.mutate({ scheduleId: schedule.id });
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        title="Delete"
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
