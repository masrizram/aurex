// AUREX admin — System: worker/queue/provider health.
import { useState } from "react";
import { RefreshCw, Cpu, Layers, Zap, CheckCircle2, AlertTriangle } from "lucide-react";
import { adminSystem } from "../api";
import { useAsync } from "@/hooks/use-async";
import { StatusBadge, fmtRupiah } from "../ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

export function AdminSystem() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, error, loading } = useAsync(() => adminSystem(), [refreshKey]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
          <CardDescription>Worker, queue, dan provider health.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {loading ? <LoadingState rows={3} /> : error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : data ? (
            <div className="space-y-4">
              {/* Queue */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {([
                  ["Queued", data.queue.queued, "text-blue-500"],
                  ["Active", data.queue.active, "text-amber-500"],
                  ["Failed", data.queue.failed, "text-destructive"],
                  ["Completed", data.queue.completed, "text-emerald-500"],
                ] as const).map(([label, n, color]) => (
                  <Card key={label} className="bg-muted/40"><CardContent className="p-3 flex items-center gap-2">
                    <Layers className={`h-4 w-4 ${color}`} />
                    <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums">{n}</p></div>
                  </CardContent></Card>
                ))}
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                {/* Model runs */}
                <Card className="bg-muted/40"><CardContent className="p-3 flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-violet-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Model runs</p>
                    <p className="text-xl font-semibold tabular-nums">{data.model_runs.count} <span className="text-sm font-normal text-muted-foreground">({data.model_runs.failed} fail)</span></p>
                    <p className="text-xs text-muted-foreground">Cost {fmtRupiah(data.model_runs.cost)}</p>
                  </div>
                </CardContent></Card>
                <Card className="bg-muted/40"><CardContent className="p-3 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Events</p>
                    <p className="text-xl font-semibold tabular-nums">{data.events_count}</p>
                  </div>
                </CardContent></Card>
                <Card className="bg-muted/40"><CardContent className="p-3 flex items-center gap-2">
                  <Badge variant="outline">env</Badge>
                  <div>
                    <p className="text-xs text-muted-foreground">Mode</p>
                    <p className="text-sm font-medium">{data.mode} · {data.node_env}</p>
                  </div>
                </CardContent></Card>
              </div>

              {/* Provider health */}
              <div className="rounded-md border">
                <div className="px-3 py-2 border-b"><p className="text-sm font-medium">Provider Health</p></div>
                <div className="divide-y">
                  {data.providers.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Belum ada provider.</p>}
                  {data.providers.map((p, i) => (
                    <div key={`${p.name}-${i}`} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        <Badge variant="outline">{p.role}</Badge>
                        {p.is_primary && <Badge variant="default">primary</Badge>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{p.model}</span>
                        <StatusBadge value={p.status} />
                        {p.last_health_ok == null ? <span className="text-xs text-muted-foreground">—</span>
                          : p.last_health_ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
