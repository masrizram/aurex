// AUREX admin — Missions/Executions: inspect execution, retry failed, cancel
// hanya pada state legal (QUEUED/RUNNING). Retry/cancel di-scope per execution.
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { adminExecutions, adminExecutionRetry, adminExecutionCancel, type AdminExecutionRow } from "../api";
import { useAsync } from "@/hooks/use-async";
import { StatusBadge, fmtDate, fmtRupiah, MonoText } from "../ui";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

const RETRYABLE = ["FAILED", "TIMED_OUT"];
const CANCELLABLE = ["QUEUED", "RUNNING"];

export function AdminMissions() {
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [inspect, setInspect] = useState<AdminExecutionRow | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, loading } = useAsync(
    () => adminExecutions({ status: status === "ALL" ? undefined : status, limit: 50, offset: page * 50 }),
    [status, page, refreshKey],
  );

  const retry = async (ex: AdminExecutionRow) => {
    setBusy(true);
    try { const r = await adminExecutionRetry(ex.id); toast.success(`Execution di-retry → attempt ${r.new_attempt}`); setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  const cancel = async (ex: AdminExecutionRow) => {
    setBusy(true);
    try { await adminExecutionCancel(ex.id); toast.success("Execution di-cancel (legal state)"); setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Missions / Executions</CardTitle>
          <CardDescription>Inspect, retry failed, cancel hanya pada state legal (QUEUED/RUNNING).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua</SelectItem>
                <SelectItem value="QUEUED">QUEUED</SelectItem>
                <SelectItem value="RUNNING">RUNNING</SelectItem>
                <SelectItem value="FAILED">FAILED</SelectItem>
                <SelectItem value="TIMED_OUT">TIMED_OUT</SelectItem>
                <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                <SelectItem value="COMPLETED">COMPLETED</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {loading ? <LoadingState rows={4} /> : error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mission</TableHead><TableHead>Objective</TableHead><TableHead>Attempt</TableHead>
                    <TableHead>Status</TableHead><TableHead>Provider</TableHead><TableHead>Revenue</TableHead>
                    <TableHead>Started</TableHead><TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.executions.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Tidak ada execution.</TableCell></TableRow>}
                  {data?.executions.map((ex) => (
                    <TableRow key={ex.id}>
                      <TableCell className="font-medium">{ex.mission_title ?? <MonoText>{ex.mission_id.slice(0, 8)}</MonoText>}</TableCell>
                      <TableCell className="text-sm">{ex.objective_title}</TableCell>
                      <TableCell className="tabular-nums">{ex.attempt}</TableCell>
                      <TableCell><StatusBadge value={ex.status} /></TableCell>
                      <TableCell><Badge variant="outline">{ex.provider}</Badge></TableCell>
                      <TableCell className="tabular-nums">{ex.verification_tier ? `${ex.verification_tier} · ${fmtRupiah(ex.revenue_claimed)}` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(ex.started_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {RETRYABLE.includes(ex.status) && (
                            <Button variant="ghost" size="icon" title="Retry" onClick={() => retry(ex)} className="text-amber-500"><RotateCcw className="h-4 w-4" /></Button>
                          )}
                          {CANCELLABLE.includes(ex.status) && (
                            <Button variant="ghost" size="icon" title="Cancel" onClick={() => cancel(ex)} className="text-destructive"><XCircle className="h-4 w-4" /></Button>
                          )}
                          <Button variant="ghost" size="icon" title="Inspect" onClick={() => setInspect(ex)}><Badge className="h-4 w-4 p-0" variant="outline"><span className="text-[10px]">?</span></Badge></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!loading && data && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{data.executions.length} execution (halaman {page + 1})</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Sebelumnya</Button>
                <Button variant="outline" size="sm" disabled={data.executions.length < 50} onClick={() => setPage((p) => p + 1)}>Berikutnya →</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inspect dialog */}
      <Dialog open={!!inspect} onOpenChange={(o) => !o && setInspect(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Execution Detail</DialogTitle></DialogHeader>
          {inspect && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <p className="text-muted-foreground">ID <span className="block font-medium text-foreground"><MonoText>{inspect.id}</MonoText></span></p>
                <p className="text-muted-foreground">Status <span className="block font-medium text-foreground"><StatusBadge value={inspect.status} /></span></p>
                <p className="text-muted-foreground">Mission <span className="block font-medium text-foreground">{inspect.mission_title ?? inspect.mission_id}</span></p>
                <p className="text-muted-foreground">Objective <span className="block font-medium text-foreground">{inspect.objective_title}</span></p>
                <p className="text-muted-foreground">Attempt <span className="block font-medium text-foreground tabular-nums">{inspect.attempt}</span></p>
                <p className="text-muted-foreground">Provider <span className="block font-medium text-foreground">{inspect.provider}</span></p>
                <p className="text-muted-foreground">Started <span className="block font-medium text-foreground">{fmtDate(inspect.started_at)}</span></p>
                <p className="text-muted-foreground">Finished <span className="block font-medium text-foreground">{fmtDate(inspect.finished_at)}</span></p>
              </div>
              <div className="flex gap-2 pt-2">
                {RETRYABLE.includes(inspect.status) && <Button size="sm" onClick={() => retry(inspect)} disabled={busy}><RotateCcw className="h-4 w-4" /> Retry</Button>}
                {CANCELLABLE.includes(inspect.status) && <Button size="sm" variant="destructive" onClick={() => cancel(inspect)} disabled={busy}><XCircle className="h-4 w-4" /> Cancel</Button>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
