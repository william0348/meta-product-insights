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
  Play,
  Pause,
  Settings,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

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
  
  const { data: schedulesData, isLoading, refetch } = trpc.schedules.getMySchedules.useQuery({ limit: 50 });
  const { data: tokenData } = trpc.tokens.get.useQuery({ tokenType: 'ads_management' });
  
  const createMutation = trpc.schedules.create.useMutation({
    onSuccess: () => {
      refetch();
      setIsCreateOpen(false);
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
  
  const handleCreateSchedule = () => {
    // Build cron expression: "second minute hour dayOfMonth month dayOfWeek"
    const cronExpression = `0 ${newSchedule.minute} ${newSchedule.hour} * * ${newSchedule.dayOfWeek}`;
    
    createMutation.mutate({
      name: newSchedule.name || `Weekly Report - ${getDayName(parseInt(newSchedule.dayOfWeek))}`,
      jobType: newSchedule.jobType,
      cronExpression,
      config: {
        adAccountId: tokenData?.adAccountId || undefined,
        dateRangeType: newSchedule.dateRangeType,
        minSpend: tokenData?.minSpend || undefined,
        minCTR: tokenData?.minCTR || undefined,
      },
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
            <DialogContent>
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
                  <Label>Date Range</Label>
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
                  Create Schedule
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
