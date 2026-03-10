import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  Copy, 
  Check,
  BookOpen,
  Webhook,
  Bot,
  Settings,
  BarChart2,
  Calendar,
  FileText,
  Upload,
  Shield,
  Zap,
  ExternalLink,
  ChevronRight,
  Terminal,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

function CopyBlock({ label, content, language = 'bash' }: { label?: string; content: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <div className="relative group my-4">
      {label && (
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      )}
      <div className="bg-zinc-950 text-zinc-100 p-4 font-mono text-sm overflow-x-auto border border-zinc-800">
        <pre className="whitespace-pre-wrap break-all">{content}</pre>
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          title="Copy to clipboard"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function ManusPromptCard({ title, description, prompt }: { title: string; description: string; prompt: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success('Manus prompt copied! Paste it in a new Manus conversation.');
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <Card className="border border-border rounded-none hover:border-primary/30 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-4 h-4 text-primary flex-shrink-0" />
              <h4 className="font-bold text-sm uppercase tracking-wide">{title}</h4>
            </div>
            <p className="text-xs text-muted-foreground mb-3">{description}</p>
            <div className="bg-zinc-950 text-zinc-300 p-3 font-mono text-xs overflow-x-auto border border-zinc-800 max-h-32 overflow-y-auto">
              <pre className="whitespace-pre-wrap">{prompt}</pre>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="flex-shrink-0 gap-1.5 rounded-none border-border h-8 text-xs font-bold uppercase tracking-wide"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-6 mt-10 first:mt-0">
      <div className="bg-primary text-primary-foreground w-8 h-8 flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </div>
      <h2 className="text-lg font-bold uppercase tracking-tight">{title}</h2>
    </div>
  );
}

function StepItem({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-6">
      <div className="flex-shrink-0 w-8 h-8 bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-bold text-sm mb-2">{title}</h4>
        <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export default function Help() {
  const [, setLocation] = useLocation();
  const appDomain = window.location.origin;

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-border bg-background sticky top-0 z-20">
        <div className="container h-16 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setLocation('/')}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              <h1 className="text-sm font-bold uppercase tracking-widest">Usage Guide</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 container py-8 max-w-4xl">
        
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent p-0 h-auto mb-8">
            <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-xs font-bold uppercase tracking-wider">
              Overview
            </TabsTrigger>
            <TabsTrigger value="webhook" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-xs font-bold uppercase tracking-wider">
              Webhook & Scheduling
            </TabsTrigger>
            <TabsTrigger value="prompts" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-xs font-bold uppercase tracking-wider">
              Manus Prompts
            </TabsTrigger>
            <TabsTrigger value="api" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-xs font-bold uppercase tracking-wider">
              API Reference
            </TabsTrigger>
          </TabsList>

          {/* ─── OVERVIEW TAB ─── */}
          <TabsContent value="overview" className="mt-0">
            <SectionTitle icon={BarChart2} title="What is Meta Product Insights?" />
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Meta Product Insights Explorer is a tool that generates product-level performance reports from your Meta (Facebook) Ads account. 
              It fetches insights data via the Marketing API, analyzes product performance metrics (spend, CTR, conversions), 
              and optionally updates your Facebook Product Catalog with custom labels and numbers for dynamic ad targeting.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
              <Card className="border border-border rounded-none">
                <CardContent className="p-4">
                  <BarChart2 className="w-5 h-5 text-primary mb-2" />
                  <h4 className="font-bold text-xs uppercase tracking-wide mb-1">Product Reports</h4>
                  <p className="text-xs text-muted-foreground">Generate product-level insights with spend, CTR, CVR, and purchase data from Meta Ads.</p>
                </CardContent>
              </Card>
              <Card className="border border-border rounded-none">
                <CardContent className="p-4">
                  <Upload className="w-5 h-5 text-primary mb-2" />
                  <h4 className="font-bold text-xs uppercase tracking-wide mb-1">Catalog Updates</h4>
                  <p className="text-xs text-muted-foreground">Batch update custom_label_4 and custom_number fields in your Facebook Product Catalog.</p>
                </CardContent>
              </Card>
              <Card className="border border-border rounded-none">
                <CardContent className="p-4">
                  <Calendar className="w-5 h-5 text-primary mb-2" />
                  <h4 className="font-bold text-xs uppercase tracking-wide mb-1">Scheduled Tasks</h4>
                  <p className="text-xs text-muted-foreground">Automate weekly report generation and catalog updates via cron schedules or webhook triggers.</p>
                </CardContent>
              </Card>
            </div>

            <SectionTitle icon={Zap} title="Quick Start" />
            
            <StepItem number={1} title="Configure Tokens in Settings">
              <p>Go to <strong>Settings</strong> page and save your <strong>Ads Report Token</strong> (for fetching insights) and <strong>Catalog Token</strong> (for batch updates). These are different Facebook access tokens with different permissions.</p>
            </StepItem>

            <StepItem number={2} title="Generate a Report">
              <p>On the <strong>Home</strong> page, configure your Ad Account ID, date range, and optional filters (Min Spend, Min CTR). Click <strong>Generate Report</strong> to start a background job that fetches all product-level insights.</p>
            </StepItem>

            <StepItem number={3} title="Review & Upload to Catalog">
              <p>Once the report is ready, review the data in the table and charts. Click <strong>Upload to Catalog</strong> to batch update your product catalog with custom_number values for the qualifying products.</p>
            </StepItem>

            <StepItem number={4} title="Set Up Scheduled Jobs">
              <p>Go to <strong>Schedules</strong> page to create automated weekly tasks. Each schedule can run a report and optionally update the catalog. Use cron expressions or the Webhook API to trigger jobs externally.</p>
            </StepItem>

            <SectionTitle icon={FileText} title="Page Guide" />
            
            <div className="space-y-3 mb-8">
              <div className="flex items-start gap-3 p-3 border border-border">
                <Badge variant="outline" className="rounded-none font-mono text-[10px] mt-0.5">HOME</Badge>
                <div>
                  <p className="text-sm font-medium">Manual Report Generation</p>
                  <p className="text-xs text-muted-foreground">Run ad-hoc product reports, view charts, filter data, download Excel, and upload to catalog.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 border border-border">
                <Badge variant="outline" className="rounded-none font-mono text-[10px] mt-0.5">REPORTS</Badge>
                <div>
                  <p className="text-sm font-medium">Job History & Monitoring</p>
                  <p className="text-xs text-muted-foreground">View all past and running jobs with progress, status, and detailed results. Cancel running jobs if needed.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 border border-border">
                <Badge variant="outline" className="rounded-none font-mono text-[10px] mt-0.5">SCHEDULES</Badge>
                <div>
                  <p className="text-sm font-medium">Automated Task Management</p>
                  <p className="text-xs text-muted-foreground">Create, edit, enable/disable cron-based scheduled jobs. Configure report parameters and catalog update rules.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 border border-border">
                <Badge variant="outline" className="rounded-none font-mono text-[10px] mt-0.5">SETTINGS</Badge>
                <div>
                  <p className="text-sm font-medium">Token & Filter Configuration</p>
                  <p className="text-xs text-muted-foreground">Save Facebook API tokens, set default filter thresholds (Min Spend, Min CTR).</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ─── WEBHOOK & SCHEDULING TAB ─── */}
          <TabsContent value="webhook" className="mt-0">
            <SectionTitle icon={Webhook} title="Webhook API for Scheduled Tasks" />
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              This tool provides a REST API (Agent API) that allows external services like <strong>Manus Scheduled Tasks</strong> to trigger report generation and catalog updates via HTTP requests. 
              This is the recommended way to automate weekly workflows.
            </p>

            <div className="bg-amber-50 border border-amber-200 p-4 mb-6">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-amber-800">Prerequisites</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Before setting up webhook triggers, make sure you have: (1) Created at least one schedule in the <strong>Schedules</strong> page, 
                    (2) Configured your API tokens in <strong>Settings</strong>, and (3) Set the <strong>AGENT_API_KEY</strong> environment variable in the app's Secrets settings.
                  </p>
                </div>
              </div>
            </div>

            <SectionTitle icon={Terminal} title="Step-by-Step Setup" />

            <StepItem number={1} title="Create a Schedule in the App">
              <p>Go to <strong>Schedules</strong> page and click <strong>Create Schedule</strong>. Configure:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                <li><strong>Name</strong>: e.g., "Weekly CTR 9% Report"</li>
                <li><strong>Ad Account ID</strong>: Your Meta ad account ID</li>
                <li><strong>Date Range</strong>: e.g., "last_30d"</li>
                <li><strong>Filters</strong>: Min Spend, Min CTR thresholds</li>
                <li><strong>Catalog Update</strong>: Enable if you want to auto-update catalog</li>
                <li><strong>Cron Expression</strong>: e.g., <code className="bg-secondary px-1">0 0 6 * * 1</code> (every Monday 6:00 AM)</li>
              </ul>
              <p className="mt-2">Note the <strong>Schedule ID</strong> (shown in the schedule list) — you'll need it for the webhook URL.</p>
            </StepItem>

            <StepItem number={2} title="Get Your Webhook URL">
              <p>Your webhook trigger URL follows this pattern:</p>
              <CopyBlock 
                label="Webhook URL Format"
                content={`POST ${appDomain}/api/agent/trigger/{scheduleId}`}
              />
              <p className="mt-2">For example, if your Schedule ID is <code className="bg-secondary px-1">1</code>:</p>
              <CopyBlock 
                label="Example"
                content={`POST ${appDomain}/api/agent/trigger/1`}
              />
            </StepItem>

            <StepItem number={3} title="Authentication">
              <p>All Agent API requests require a Bearer token. The token is the <strong>AGENT_API_KEY</strong> value set in your app's Secrets settings (accessible via the Management UI → Settings → Secrets).</p>
              <CopyBlock 
                label="Request Header"
                content={`Authorization: Bearer <YOUR_AGENT_API_KEY>`}
              />
            </StepItem>

            <StepItem number={4} title="Set Up Manus Scheduled Task">
              <p>In Manus, create a new <strong>Scheduled Task</strong> that runs at your desired interval. Use the Manus prompt from the <strong>Manus Prompts</strong> tab to configure it. The prompt will instruct Manus to:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                <li>Call the webhook URL to trigger the schedule</li>
                <li>Poll the status endpoint until the job completes</li>
                <li>Report the results back to you</li>
              </ul>
            </StepItem>

            <StepItem number={5} title="Monitor Job Progress">
              <p>After triggering, you can monitor progress via:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                <li><strong>Reports page</strong> in the app UI</li>
                <li><strong>Status API</strong>: <code className="bg-secondary px-1">GET /api/agent/status/{'{runId}'}</code></li>
                <li><strong>Latest run API</strong>: <code className="bg-secondary px-1">GET /api/agent/latest/{'{scheduleId}'}</code></li>
              </ul>
            </StepItem>

            <SectionTitle icon={Clock} title="Testing with cURL" />
            <p className="text-sm text-muted-foreground mb-4">You can test the webhook manually using cURL:</p>

            <CopyBlock 
              label="1. List all schedules"
              content={`curl -s -H "Authorization: Bearer <YOUR_AGENT_API_KEY>" \\\n  ${appDomain}/api/agent/schedules | jq .`}
            />

            <CopyBlock 
              label="2. Trigger schedule ID 1"
              content={`curl -s -X POST -H "Authorization: Bearer <YOUR_AGENT_API_KEY>" \\\n  ${appDomain}/api/agent/trigger/1 | jq .`}
            />

            <CopyBlock 
              label="3. Check run status"
              content={`curl -s -H "Authorization: Bearer <YOUR_AGENT_API_KEY>" \\\n  ${appDomain}/api/agent/status/<runId> | jq .`}
            />

            <CopyBlock 
              label="4. Get latest run for schedule"
              content={`curl -s -H "Authorization: Bearer <YOUR_AGENT_API_KEY>" \\\n  ${appDomain}/api/agent/latest/1 | jq .`}
            />

            <CopyBlock 
              label="5. Cancel a running job"
              content={`curl -s -X POST -H "Authorization: Bearer <YOUR_AGENT_API_KEY>" \\\n  ${appDomain}/api/agent/cancel/<jobId> | jq .`}
            />
          </TabsContent>

          {/* ─── MANUS PROMPTS TAB ─── */}
          <TabsContent value="prompts" className="mt-0">
            <SectionTitle icon={Bot} title="One-Click Manus Prompts" />
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              Copy these prompts and paste them into a <strong>new Manus conversation</strong> to set up automated workflows. 
              Replace the placeholder values (marked with <code className="bg-secondary px-1">&lt;...&gt;</code>) with your actual values before running.
            </p>

            <div className="bg-blue-50 border border-blue-200 p-4 mb-8">
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-blue-800">Before You Start</p>
                  <p className="text-xs text-blue-700 mt-1">
                    You need two values: (1) Your app's published URL (e.g., <code>https://metaproduct-xjmcszvn.manus.space</code>), 
                    and (2) Your <strong>AGENT_API_KEY</strong> (set in the app's Management UI → Settings → Secrets).
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <ManusPromptCard
                title="Weekly Scheduled Trigger (Recommended)"
                description="Set up a recurring Manus scheduled task that triggers your report schedule every week and monitors the result. This is the most common use case."
                prompt={`Please set up a recurring scheduled task for me:

**Task**: Trigger my Meta Product Insights report every Monday at 7:00 AM (Asia/Taipei timezone).

**Webhook Details**:
- URL: ${appDomain}/api/agent/trigger/1
- Method: POST
- Header: Authorization: Bearer <YOUR_AGENT_API_KEY>

**After triggering, please**:
1. Parse the response to get the runId
2. Poll the status every 30 seconds: GET ${appDomain}/api/agent/status/{runId} with the same Authorization header
3. Continue polling until the job status is "completed" or "failed"
4. Report the final result including: total items processed, success count, error count, and duration

**Schedule**: Every Monday at 07:00 AM (Asia/Taipei)

Please confirm the schedule setup and do a test run now.`}
              />

              <ManusPromptCard
                title="One-Time Report Trigger"
                description="Trigger a single report run immediately and get the results. Useful for ad-hoc analysis."
                prompt={`Please trigger my Meta Product Insights report and monitor it until completion.

**Step 1 - Trigger the report**:
POST ${appDomain}/api/agent/trigger/1
Header: Authorization: Bearer <YOUR_AGENT_API_KEY>

**Step 2 - Monitor progress**:
After triggering, use the returned runId to poll status every 30 seconds:
GET ${appDomain}/api/agent/status/{runId}
Header: Authorization: Bearer <YOUR_AGENT_API_KEY>

Keep polling until status is "completed" or "failed".

**Step 3 - Report results**:
When done, tell me:
- Total products analyzed
- Success/error counts
- Duration
- Any errors encountered

Please start now.`}
              />

              <ManusPromptCard
                title="Check Latest Run Status"
                description="Check the status of the most recent run for a schedule. Useful for debugging or verifying that a scheduled task ran correctly."
                prompt={`Please check the latest run status of my Meta Product Insights schedule.

**API Call**:
GET ${appDomain}/api/agent/latest/1
Header: Authorization: Bearer <YOUR_AGENT_API_KEY>

Please make this API call and report:
- Run status (completed/failed/running)
- When it started and completed
- Total items processed
- Success and error counts
- Any error messages

If the job is still running, please poll the status endpoint every 30 seconds until it completes:
GET ${appDomain}/api/agent/status/{runId}
Header: Authorization: Bearer <YOUR_AGENT_API_KEY>`}
              />

              <ManusPromptCard
                title="Cancel a Running Job"
                description="Cancel a currently running job by its Job ID. Use this if a job is taking too long or you need to stop it."
                prompt={`Please cancel a running job on my Meta Product Insights app.

**Step 1 - Find the running job**:
GET ${appDomain}/api/agent/latest/1
Header: Authorization: Bearer <YOUR_AGENT_API_KEY>

Check the response for any job with status "running" and note its job ID.

**Step 2 - Cancel the job**:
POST ${appDomain}/api/agent/cancel/{jobId}
Header: Authorization: Bearer <YOUR_AGENT_API_KEY>

Please confirm the cancellation result.`}
              />

              <ManusPromptCard
                title="List All Schedules"
                description="View all configured schedules and their current status. Useful for getting schedule IDs."
                prompt={`Please list all my Meta Product Insights schedules.

**API Call**:
GET ${appDomain}/api/agent/schedules
Header: Authorization: Bearer <YOUR_AGENT_API_KEY>

Please make this API call and show me a table with:
- Schedule ID
- Name
- Cron Expression
- Timezone
- Enabled status
- Last run time and status
- Next scheduled run time`}
              />
            </div>
          </TabsContent>

          {/* ─── API REFERENCE TAB ─── */}
          <TabsContent value="api" className="mt-0">
            <SectionTitle icon={Terminal} title="Agent API Reference" />
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              All endpoints require the <code className="bg-secondary px-1">Authorization: Bearer &lt;AGENT_API_KEY&gt;</code> header. 
              The base URL is your app's published domain.
            </p>

            <div className="space-y-6">
              {/* GET /schedules */}
              <Card className="border border-border rounded-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <Badge className="rounded-none bg-emerald-600 text-white font-mono text-[10px]">GET</Badge>
                    <code className="text-sm font-mono">/api/agent/schedules</code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">List all enabled schedules with basic info</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <CopyBlock 
                    label="Response Example"
                    content={`{
  "success": true,
  "schedules": [
    {
      "id": 1,
      "name": "CTR 9%",
      "cronExpression": "0 0 6 * * 1",
      "timezone": "Asia/Taipei",
      "enabled": true,
      "jobType": "report_and_catalog",
      "lastRunAt": "2026-03-02T15:35:07.000Z",
      "lastRunStatus": "completed"
    }
  ]
}`}
                  />
                </CardContent>
              </Card>

              {/* POST /trigger/:scheduleId */}
              <Card className="border border-border rounded-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <Badge className="rounded-none bg-blue-600 text-white font-mono text-[10px]">POST</Badge>
                    <code className="text-sm font-mono">/api/agent/trigger/:scheduleId</code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Trigger a schedule to run immediately</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Parameters</div>
                  <div className="bg-secondary/50 p-3 text-xs mb-3 border border-border">
                    <code>scheduleId</code> (path) — The ID of the schedule to trigger (integer)
                  </div>
                  <CopyBlock 
                    label="Response Example"
                    content={`{
  "success": true,
  "message": "Schedule \\"CTR 9%\\" triggered successfully",
  "scheduleId": 1,
  "runId": 42,
  "jobIds": [330005]
}`}
                  />
                </CardContent>
              </Card>

              {/* GET /status/:runId */}
              <Card className="border border-border rounded-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <Badge className="rounded-none bg-emerald-600 text-white font-mono text-[10px]">GET</Badge>
                    <code className="text-sm font-mono">/api/agent/status/:runId</code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Check the status of a specific schedule run and its jobs</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <CopyBlock 
                    label="Response Example"
                    content={`{
  "success": true,
  "run": {
    "id": 42,
    "scheduleId": 1,
    "status": "completed",
    "triggerType": "manual",
    "startedAt": "2026-03-02T15:35:07.000Z",
    "completedAt": "2026-03-02T15:50:33.000Z",
    "durationMs": 926000,
    "totalItems": 65977
  },
  "jobs": [
    {
      "id": 330005,
      "status": "completed",
      "progress": 100,
      "processedItems": 65977,
      "successCount": 65977,
      "errorCount": 0,
      "statusMessage": "Completed: 65977 success, 0 errors"
    }
  ]
}`}
                  />
                </CardContent>
              </Card>

              {/* GET /latest/:scheduleId */}
              <Card className="border border-border rounded-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <Badge className="rounded-none bg-emerald-600 text-white font-mono text-[10px]">GET</Badge>
                    <code className="text-sm font-mono">/api/agent/latest/:scheduleId</code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Get the latest run for a schedule</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground mb-3">Returns the most recent run and its job details. Useful for checking if a trigger worked.</p>
                </CardContent>
              </Card>

              {/* POST /cancel/:jobId */}
              <Card className="border border-border rounded-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <Badge className="rounded-none bg-red-600 text-white font-mono text-[10px]">POST</Badge>
                    <code className="text-sm font-mono">/api/agent/cancel/:jobId</code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Cancel a running or queued job</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Parameters</div>
                  <div className="bg-secondary/50 p-3 text-xs mb-3 border border-border">
                    <code>jobId</code> (path) — The ID of the job to cancel (integer). Only works for jobs with status "running" or "queued".
                  </div>
                  <CopyBlock 
                    label="Response Example"
                    content={`{
  "success": true,
  "message": "Job 330005 cancelled successfully",
  "jobId": 330005
}`}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6">
        <div className="container text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Meta Product Insights Explorer v2.0 — Built with Manus
          </p>
        </div>
      </footer>
    </div>
  );
}
