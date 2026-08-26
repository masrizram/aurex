// AUREX admin — Overview: KPI + counts. Landing untuk Admin Control Center.
import { Users, Building2, Target, ClipboardCheck, AlertTriangle, Activity, Cpu } from "lucide-react";
import { adminOverview } from "../api";
import { useAsync } from "@/hooks/use-async";
import { fmtNum } from "@/components/aurex-primitives";
import { StatusBadge } from "../ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

export function AdminOverview() {
  const { data, error, loading, reload } = useAsync(adminOverview, []);

  return (
    <div className="space-y-4">
      {loading ? <LoadingState rows={3} /> : error ? <ErrorState message={error} onRetry={reload} /> : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardHeader className="pb-2"><CardDescription className="flex items-center gap-1"><Users className="h-3 w-3" /> Total Users</CardDescription><CardTitle className="text-2xl tabular-nums">{fmtNum(data.users)}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">{data.activeUsers} aktif · {data.suspendedUsers} suspend</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardDescription className="flex items-center gap-1"><Building2 className="h-3 w-3" /> Organizations</CardDescription><CardTitle className="text-2xl tabular-nums">{fmtNum(data.orgs)}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-1">{data.orgsByPlan.map((p) => <Badge key={p.tier} variant="outline">{p.tier}: {p.count}</Badge>)}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardDescription className="flex items-center gap-1"><Target className="h-3 w-3" /> Objectives</CardDescription><CardTitle className="text-2xl tabular-nums">{fmtNum(data.objectives.reduce((a, s) => a + s.count, 0))}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">{data.objectives.length} active states</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardDescription className="flex items-center gap-1"><Cpu className="h-3 w-3" /> AI Providers</CardDescription><CardTitle className="text-2xl tabular-nums">{fmtNum(data.providers)}</CardTitle></CardHeader></Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Pending Approvals</CardTitle></CardHeader>
              <CardContent><p className="text-3xl font-semibold tabular-nums">{data.pendingApprovals}</p></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Failed Executions</CardTitle></CardHeader>
              <CardContent><p className="text-3xl font-semibold tabular-nums">{data.failedExecutions}</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Objectives by State</CardTitle>
              <CardDescription>Raw FSM states — admin only.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.objectives.length === 0 ? <p className="text-sm text-muted-foreground">Tidak ada data.</p> : (
                <div className="flex flex-wrap gap-2">
                  {data.objectives.map((s) => (
                    <div key={s.state} className="flex items-center gap-2 rounded-md border px-2 py-1">
                      <StatusBadge value={s.state} />
                      <span className="text-sm font-semibold tabular-nums">{s.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
