import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { eachDayOfInterval, format, isSameDay, startOfDay, subDays } from "date-fns";
import { ArrowLeft, Eye, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function ProductSetMonitors() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: "",
    productSetId: "",
    runHour: 8,
    runMinute: 0,
  });

  const monitorsQuery = useQuery({
    queryKey: ["monitors"],
    queryFn: () => apiClient.monitors.list(),
    refetchInterval: 10_000,
  });

  const snapshotsQuery = useQuery({
    queryKey: ["monitors", selectedId, "snapshots"],
    queryFn: () => apiClient.monitors.listSnapshots(selectedId as number, 60),
    enabled: !!selectedId,
    refetchInterval: 5_000,
  });

  const createMutation = useMutation({
    mutationFn: apiClient.monitors.create,
    onSuccess: () => {
      toast.success("Monitor created");
      setCreateOpen(false);
      setForm({ name: "", productSetId: "", runHour: 8, runMinute: 0 });
      queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
    onError: (e: any) => toast.error(`Failed: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.monitors.delete(id),
    onSuccess: () => {
      toast.success("Monitor deleted");
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiClient.monitors.update(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["monitors"] }),
  });

  const runMutation = useMutation({
    mutationFn: (id: number) => apiClient.monitors.runNow(id),
    onSuccess: (_d, id) => {
      toast.success("Triggered — snapshot incoming");
      setSelectedId(id);
      queryClient.invalidateQueries({ queryKey: ["monitors", id, "snapshots"] });
    },
  });

  const monitors = monitorsQuery.data?.monitors || [];
  const snapshots = snapshotsQuery.data?.snapshots || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/")}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div>
              <h1 className="text-lg font-bold flex items-center gap-2">
                <Eye className="w-5 h-5" /> Product Set Monitors
              </h1>
              <p className="text-xs text-muted-foreground">Daily snapshots of products inside a Facebook Product Set</p>
            </div>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-1" /> New Monitor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create monitor</DialogTitle>
                <DialogDescription>Daily snapshot of product count + list, with diff vs previous day.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. High-CTR set" />
                </div>
                <div className="space-y-1">
                  <Label>Product Set ID</Label>
                  <Input
                    value={form.productSetId}
                    onChange={(e) => setForm({ ...form, productSetId: e.target.value })}
                    placeholder="e.g. 1234567890"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Daily hour (0-23)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={form.runHour}
                      onChange={(e) => setForm({ ...form, runHour: parseInt(e.target.value || "0") })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Minute (0-59)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={59}
                      value={form.runMinute}
                      onChange={(e) => setForm({ ...form, runMinute: parseInt(e.target.value || "0") })}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => createMutation.mutate(form)}
                  disabled={!form.name || !form.productSetId || createMutation.isPending}
                >
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="container py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              Monitors
              <Button variant="ghost" size="sm" onClick={() => monitorsQuery.refetch()}>
                <RefreshCw className="w-3 h-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {monitors.length === 0 && (
              <p className="text-sm text-muted-foreground">No monitors yet. Click "New Monitor" to add one.</p>
            )}
            {monitors.map((m: any) => (
              <div
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className={`border rounded p-3 cursor-pointer ${selectedId === m.id ? "border-primary bg-primary/5" : "hover:bg-secondary/30"}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{m.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{m.productSetId}</div>
                  </div>
                  <Switch
                    checked={m.enabled}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: m.id, enabled: checked })}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-2 flex items-center justify-between">
                  <span>
                    {m.lastProductCount != null ? `${m.lastProductCount.toLocaleString()} products` : "Never run"}
                    {m.lastRunStatus === "failed" && <span className="text-red-500 ml-2">⚠ failed</span>}
                  </span>
                  <span className="font-mono">{String(m.runHour).padStart(2, "0")}:{String(m.runMinute).padStart(2, "0")}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Last: {m.lastRunAt ? format(new Date(m.lastRunAt), "MM/dd HH:mm") : "—"} | Next: {m.nextRunAt ? format(new Date(m.nextRunAt), "MM/dd HH:mm") : "—"}
                </div>
                <div className="flex gap-1 mt-2">
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={(e) => { e.stopPropagation(); runMutation.mutate(m.id); }}>
                    <Play className="w-3 h-3 mr-1" /> Run now
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={(e) => { e.stopPropagation(); if (confirm("Delete this monitor and its snapshots?")) deleteMutation.mutate(m.id); }}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Snapshots + detail */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{selectedId ? "Snapshots" : "Select a monitor"}</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedId && <p className="text-sm text-muted-foreground">Pick a monitor on the left to view its snapshots.</p>}
            {selectedId && (
              <div className="space-y-4">
                {snapshots.length >= 1 && (() => {
                  const today = startOfDay(new Date());
                  const days = eachDayOfInterval({ start: subDays(today, 29), end: today });
                  const completed = snapshots.filter((s: any) => s.status === "completed" && s.productCount != null);
                  const chartData = days.map((d) => {
                    const dayMatches = completed
                      .filter((s: any) => isSameDay(new Date(s.takenAt), d))
                      .sort((a: any, b: any) => +new Date(b.takenAt) - +new Date(a.takenAt));
                    return {
                      label: format(d, "MM/dd"),
                      count: dayMatches.length > 0 ? dayMatches[0].productCount : null,
                    };
                  });
                  return (
                    <div className="border rounded p-3">
                      <div className="text-xs font-bold uppercase text-muted-foreground mb-2">Product count — last 30 days</div>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v.toLocaleString()} />
                          <Tooltip
                            formatter={(v: any) => (v == null ? "—" : v.toLocaleString())}
                            labelStyle={{ fontSize: 11 }}
                            contentStyle={{ fontSize: 11 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="count"
                            name="Products"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            activeDot={{ r: 5 }}
                            connectNulls={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
                {snapshots.length === 0 && <p className="text-sm text-muted-foreground">No snapshots yet.</p>}
                {snapshots.map((s: any, idx: number) => {
                  const prev = snapshots[idx + 1];
                  const delta = prev && prev.productCount != null && s.productCount != null
                    ? s.productCount - prev.productCount
                    : null;
                  return (
                    <div key={s.id} className="border rounded p-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">
                          {s.takenAt ? format(new Date(s.takenAt), "yyyy-MM-dd HH:mm:ss") : "—"}
                          <span className="ml-2 text-xs px-2 py-0.5 rounded bg-secondary">{s.triggerType}</span>
                        </div>
                        {s.status === "failed" ? (
                          <div className="text-xs text-red-500 mt-1">{s.errorMessage}</div>
                        ) : (
                          <div className="text-xs text-muted-foreground mt-1">
                            {(s.productCount ?? 0).toLocaleString()} products
                            {delta !== null && delta !== 0 && (
                              <span className={`ml-2 font-medium ${delta > 0 ? "text-emerald-600" : "text-red-500"}`}>
                                {delta > 0 ? "+" : ""}{delta.toLocaleString()}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{s.durationMs ? `${s.durationMs}ms` : ""}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

