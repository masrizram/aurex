// AUREX admin — Objectives: detail lengkap, edit metadata mutable, dan
// administrative actions yang SEMUA lewat FSM resmi (advance), bukan
// dropdown bebas mengubah raw state.
import { useState } from "react";
import { toast } from "sonner";
import { Search, RefreshCw, Eye, Octagon, Play } from "lucide-react";
import {
  adminObjectives, adminObjectiveDetail, adminObjectiveUpdate, adminObjectiveStop, adminObjectiveResume,
  type AdminObjectiveRow, type AdminObjectiveDetail,
} from "../api";
import { useAsync } from "@/hooks/use-async";
import { StatusBadge, fmtRupiah, MonoText } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

const TERMINAL = ["ACHIEVED", "STOPPED"];

export function AdminObjectives() {
  const [stateFilter, setStateFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AdminObjectiveRow | null>(null);
  const [detail, setDetail] = useState<AdminObjectiveDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editTitle, setEditTitle] = useState("");
  const [editEnv, setEditEnv] = useState("SIMULATED");
  const [saving, setSaving] = useState(false);
  const [stopReason, setStopReason] = useState("");
  const [resumeReason, setResumeReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, error, loading } = useAsync(
    () => adminObjectives({ state: stateFilter === "ALL" ? undefined : stateFilter, search: search || undefined, limit: 50, offset: page * 50 }),
    [stateFilter, search, page, refreshKey],
  );

  const openDetail = async (o: AdminObjectiveRow) => {
    setSelected(o);
    setDetailLoading(true);
    setDetail(null);
    try { const d = await adminObjectiveDetail(o.id); setDetail(d.objective); setEditTitle(d.objective.title); setEditEnv(d.objective.environment); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setDetailLoading(false); }
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await adminObjectiveUpdate(selected.id, { title: editTitle || undefined, environment: editEnv as never });
      toast.success("Objective diperbarui");
      setRefreshKey((k) => k + 1);
      openDetail(selected);
    } catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setSaving(false); }
  };

  const stop = async () => {
    if (!selected) return;
    setBusy(true);
    try { await adminObjectiveStop(selected.id, stopReason || "admin"); toast.success("Objective di-stop (FSM T38)"); setRefreshKey((k) => k + 1); openDetail(selected); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); setStopReason(""); }
  };

  const resume = async () => {
    if (!selected) return;
    setBusy(true);
    try { await adminObjectiveResume(selected.id, resumeReason || undefined); toast.success("Objective di-resume (FSM T36)"); setRefreshKey((k) => k + 1); openDetail(selected); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); setResumeReason(""); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Objectives</CardTitle>
          <CardDescription>Detail + aksi FSM resmi. Raw state HANYA berubah melalui advance().</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Cari title / email…" className="pl-9" />
            </div>
            <Select value={stateFilter} onValueChange={(v) => { setStateFilter(v); setPage(0); }}>
              <SelectTrigger className="w-48"><SelectValue placeholder="State" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua state</SelectItem>
                <SelectItem value="RESEARCHING">RESEARCHING</SelectItem>
                <SelectItem value="HUMAN_APPROVAL_REQUIRED">HUMAN_APPROVAL_REQUIRED</SelectItem>
                <SelectItem value="BLOCKED">BLOCKED</SelectItem>
                <SelectItem value="EXECUTING">EXECUTING</SelectItem>
                <SelectItem value="STOPPED">STOPPED</SelectItem>
                <SelectItem value="ACHIEVED">ACHIEVED</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {loading ? <LoadingState rows={4} /> : error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead><TableHead>State</TableHead><TableHead>User</TableHead>
                    <TableHead>Org</TableHead><TableHead>Target Profit</TableHead><TableHead>Capital</TableHead><TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.objectives.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Tidak ada objective.</TableCell></TableRow>}
                  {data?.objectives.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.title}</TableCell>
                      <TableCell><StatusBadge value={o.state} /></TableCell>
                      <TableCell>{o.user_email}</TableCell>
                      <TableCell>{o.org_name === "—" ? "—" : o.org_name}</TableCell>
                      <TableCell className="tabular-nums">{fmtRupiah(o.target_profit)}</TableCell>
                      <TableCell className="tabular-nums">{fmtRupiah(o.capital_approved)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" title="Detail" onClick={() => openDetail(o)}><Eye className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!loading && data && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{data.objectives.length} objective (halaman {page + 1})</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Sebelumnya</Button>
                <Button variant="outline" size="sm" disabled={data.objectives.length < 50} onClick={() => setPage((p) => p + 1)}>Berikutnya →</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Objective Detail</DialogTitle></DialogHeader>
          {detailLoading ? <LoadingState rows={2} /> : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><p className="text-muted-foreground">State</p><p className="font-medium"><StatusBadge value={detail.state} /></p></div>
                <div><p className="text-muted-foreground">Environment</p><p className="font-medium">{detail.environment}</p></div>
                <div><p className="text-muted-foreground">Cycle</p><p className="font-medium tabular-nums">{detail.current_cycle}</p></div>
                <div><p className="text-muted-foreground">Row version</p><p className="font-medium tabular-nums">{detail.row_version}</p></div>
                <div><p className="text-muted-foreground">Target Profit</p><p className="font-medium tabular-nums">{fmtRupiah(detail.target_profit)}</p></div>
                <div><p className="text-muted-foreground">Capital</p><p className="font-medium tabular-nums">{fmtRupiah(detail.capital_approved)}</p></div>
                <div><p className="text-muted-foreground">Autonomy</p><p className="font-medium tabular-nums">{detail.autonomy_level}</p></div>
                <div><p className="text-muted-foreground">Horizon</p><p className="font-medium tabular-nums">{detail.horizon_months} bulan</p></div>
              </div>

              {/* Lifecycle counts */}
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Lifecycle</p>
                <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-center text-xs">
                  {([
                    ["Opp", detail.counts.opportunities], ["Exp", detail.counts.experiments],
                    ["Mission", detail.counts.missions], ["Decision", detail.counts.decisions],
                    ["Result", detail.counts.results], ["Approval", detail.counts.approvals_pending],
                    ["Exec fail", detail.counts.executions_failed],
                  ] as const).map(([label, n]) => (
                    <div key={label} className="rounded-md bg-muted p-2">
                      <p className="text-lg font-semibold tabular-nums">{n}</p>
                      <p className="text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Edit mutable metadata */}
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Edit metadata (mutable)</p>
                <div className="grid gap-2 md:grid-cols-2">
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" />
                  <Select value={editEnv} onValueChange={setEditEnv}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SIMULATED">SIMULATED</SelectItem>
                      <SelectItem value="TEST">TEST</SelectItem>
                      <SelectItem value="REAL">REAL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" onClick={saveEdit} disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</Button>
              </div>

              {/* Missions */}
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Missions ({detail.missions.length})</p>
                {detail.missions.length === 0 ? <p className="text-sm text-muted-foreground">Tidak ada.</p> : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {detail.missions.map((m) => (
                      <div key={m.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                        <span className="font-medium truncate">{m.title ?? <MonoText>{m.id}</MonoText>}</span>
                        <div className="flex items-center gap-2">
                          <StatusBadge value={m.status} />
                          <span className="text-xs text-muted-foreground tabular-nums">{m.execution_count} exec</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions (FSM resmi) */}
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Actions (via FSM resmi)</p>
                <div className="flex flex-wrap gap-2">
                  {!TERMINAL.includes(detail.state) && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm"><Octagon className="h-4 w-4" /> Stop objective</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Stop objective?</AlertDialogTitle>
                          <AlertDialogDescription>Transisi T38 (human_only) → STOPPED. Terminal; tanpa transisi keluar.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <Input value={stopReason} onChange={(e) => setStopReason(e.target.value)} placeholder="Alasan (min 3)" />
                        <AlertDialogFooter>
                          <AlertDialogCancel>Batal</AlertDialogCancel>
                          <AlertDialogAction onClick={stop} disabled={busy || stopReason.length < 3}>Stop</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {detail.state === "BLOCKED" && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm"><Play className="h-4 w-4" /> Resume</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Resume objective?</AlertDialogTitle>
                          <AlertDialogDescription>Transisi T36 (BLOCKED → RESEARCHING, human_action).</AlertDialogDescription>
                        </AlertDialogHeader>
                        <Input value={resumeReason} onChange={(e) => setResumeReason(e.target.value)} placeholder="Alasan (opsional)" />
                        <AlertDialogFooter>
                          <AlertDialogCancel>Batal</AlertDialogCancel>
                          <AlertDialogAction onClick={resume} disabled={busy}>Resume</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {TERMINAL.includes(detail.state) && <span className="text-xs text-muted-foreground">State terminal — tidak ada transisi keluar.</span>}
                </div>
              </div>
            </div>
          ) : <p className="text-muted-foreground text-sm">Tidak ada detail.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
