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
            <SectionTitle icon={Webhook} title="Automated Scheduling" />
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              This tool uses a <strong>Manus Scheduled Task</strong> with a Python script to automatically trigger report generation and catalog updates every week.
              The script connects directly to the database, sets schedules as "due", and wakes up the app server to process them.
            </p>

            <div className="bg-emerald-50 border border-emerald-200 p-4 mb-6">
              <div className="flex items-start gap-2">
                <Zap className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-800">Current Schedule (Active)</p>
                  <p className="text-xs text-emerald-700 mt-1">
                    A Manus Scheduled Task runs <strong>daily at 01:30 UTC (09:30 AM GMT+8)</strong>. It triggers all enabled schedules
                    by updating their <code>nextRunAt</code> to NOW, then pings the server to wake it up.
                    The server's internal scheduler picks up the due jobs within 60 seconds and processes them automatically.
                    This runs after the daily catalog "Replace" feed completes, ensuring custom_number values persist.
                  </p>
                </div>
              </div>
            </div>

            <SectionTitle icon={Settings} title="How It Works" />
            <div className="bg-zinc-50 border border-zinc-200 p-5 mb-8">
              <div className="space-y-3">
                {[
                  ['Manus Schedule fires at 01:30 UTC daily (09:30 AM GMT+8)', 'A fresh sandbox downloads and runs the trigger Python script'],
                  ['Script pings the app URL to wake up the server', 'The server may be hibernating; an HTTP request wakes it up'],
                  ['Script connects to database and sets nextRunAt = NOW()', 'All enabled schedules get their nextRunAt updated'],
                  ["Server's internal scheduler detects due jobs", 'The scheduler checks every 60 seconds for jobs where nextRunAt <= NOW'],
                  ['Job processor executes reports and catalog updates', 'Each schedule creates batch jobs that fetch data from Facebook API'],
                  ['Script monitors progress and sends notification', 'Monitors up to 60 minutes, then sends an owner notification with results'],
                ].map(([title, desc], i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs">{i + 1}</div>
                    <div>
                      <p className="text-sm font-bold">{title}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 p-4 mb-6">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-amber-800">Why Not Direct Webhook?</p>
                  <p className="text-xs text-amber-700 mt-1">
                    The Manus platform requires OAuth login for all HTTP endpoints (company security policy). External webhook calls 
                    (like <code>POST /api/agent/trigger</code>) are blocked by the OAuth proxy and return a login redirect. 
                    The database-direct approach bypasses this limitation since it connects to the database directly, not through the web server.
                  </p>
                </div>
              </div>
            </div>

            <SectionTitle icon={Terminal} title="Agent API Reference (Local/Dev Use)" />
            <p className="text-sm text-muted-foreground mb-4">
              These API endpoints work when accessed from within the app (after OAuth login) or in local development.
              They are useful for manual testing via the app's internal tools.
            </p>





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

            <div className="bg-emerald-50 border border-emerald-200 p-4 mb-8">
              <div className="flex items-start gap-2">
                <Zap className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-800">Set Up Your Own Daily Schedule</p>
                  <p className="text-xs text-emerald-700 mt-1">
                    Each user needs to set up their own Manus Scheduled Task to trigger their schedules daily.
                    Copy the <strong>first prompt below</strong> and paste it into a new Manus conversation to create your daily automation.
                    You will need your app's <strong>DATABASE_URL</strong> from the Settings &gt; Secrets page.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 p-4 mb-6">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-amber-800">Important: Why Daily Schedule is Required</p>
                  <p className="text-xs text-amber-700 mt-1">
                    If your catalog has a daily <strong>"Replace" feed</strong> (取代), it will reset <code>custom_number</code> fields to 0.
                    The daily schedule runs <strong>after</strong> the feed completes, re-applying your custom_number values.
                    Set the schedule time to <strong>1+ hour after your last daily feed</strong> to ensure values persist.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <ManusPromptCard
                title="⭐ Set Up Daily Manus Schedule (Required)"
                description="Create a daily Manus Scheduled Task that automatically triggers all your enabled schedules. Copy this prompt and paste it into a NEW Manus conversation."
                prompt={`/manus-schedule-runner

Please set up a DAILY Manus Scheduled Task for Meta Product Insights.

**What it does**: Every day at 09:30 AM GMT+8 (01:30 UTC), it runs a Python script that:
1. Wakes up the app server
2. Connects to the database and sets all enabled schedules' nextRunAt to NOW
3. Pings the server so the internal scheduler picks up the due jobs
4. Monitors job progress for up to 60 minutes
5. Sends a notification with results

**Setup Steps**:
1. Install dependency: sudo pip3 install pymysql
2. Download script: curl -o /home/ubuntu/job.py "https://files.manuscdn.com/user_upload_by_module/session_file/310519663317876169/NJObsoWICqHadvmK.py"
3. Test run with env vars:
   APP_URL='${appDomain}' DATABASE_URL='<YOUR_DATABASE_URL>' BUILT_IN_FORGE_API_URL='<YOUR_FORGE_API_URL>' BUILT_IN_FORGE_API_KEY='<YOUR_FORGE_API_KEY>' python3.11 /home/ubuntu/job.py
4. If test succeeds, create the Manus Schedule with cron: 0 30 1 * * * (daily 01:30 UTC = 09:30 AM GMT+8)

**Environment Variables** (find these in the app's Settings > Secrets page):
- DATABASE_URL: The MySQL/TiDB connection string
- BUILT_IN_FORGE_API_URL: The Manus built-in API URL
- BUILT_IN_FORGE_API_KEY: The Manus built-in API key
- APP_URL: ${appDomain}

**IMPORTANT**: Adjust the schedule time based on your catalog feed schedule. The script should run AFTER your daily "Replace" feed completes (typically 1+ hour after the last feed starts).

Please test the script first, then create the scheduled task.`}
              />

              <ManusPromptCard
                title="On-Demand Trigger (Database-Direct)"
                description="Trigger all enabled schedules immediately by running the Python trigger script. This is the same script used by the daily Manus Schedule."
                prompt={`/manus-schedule-runner

Please run the Meta Product Insights trigger script.

Do NOT create any project. Do NOT write any code. Just run these 3 shell commands:

1. sudo pip3 install pymysql
2. curl -o /home/ubuntu/job.py "https://files.manuscdn.com/user_upload_by_module/session_file/310519663317876169/NJObsoWICqHadvmK.py"
3. Run with env vars (timeout 3600s):
   APP_URL='${appDomain}' python3.11 /home/ubuntu/job.py

Note: You will need to provide the DATABASE_URL, BUILT_IN_FORGE_API_URL, and BUILT_IN_FORGE_API_KEY env vars from the app's Secrets settings.

Wait for it to finish and report the results.`}
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
