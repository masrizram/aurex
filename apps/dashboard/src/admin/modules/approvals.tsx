// AUREX admin — Approvals: admin dapat approve/reject (domain mengizinkan)
// via FSM resmi. Append-only proof di audit log.
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Check, X } from "lucide-react";
import { adminApprovals, adminApprovalApprove, adminApprovalReject, type AdminApprovalRow } from "../api";
import { useAsync } from "@/hooks/use-async";
import { StatusBadge, fmtDate, fmtRupiah } from "../ui";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

export function AdminApprovals() {
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rejecting, setRejecting] = useState<AdminApprovalRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, error, loading } = useAsync(
    () => adminApprovals({ status: status === "ALL" ? undefined : status, limit: 50, offset: page * 50 }),
    [status, page, refreshKey],
  );

  const approve = async (a: AdminApprovalRow) => {
    try { await adminApprovalApprove(a.id); toast.success(`Approval ${a.category} disetujui`); setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };

  const reject = async () => {
    if (!rejecting || reason.length < 3) { toast.error("Alasan min 3 karakter"); return; }
    setBusy(true);
    try { await adminApprovalReject(rejecting.id, reason); toast.success("Approval ditolak (FSM T35)"); setRejecting(null); setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); setReason(""); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Approvals</CardTitle>
          <CardDescription>Approve/reject keputusan yang menunggu aksi manusia.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {loading ? <LoadingState rows={4} /> : error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead><TableHead>Objective</TableHead><TableHead>Owner</TableHead>
                    <TableHead>Capital at Risk</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead><TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.approvals.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Tidak ada approval.</TableCell></TableRow>}
                  {data?.approvals.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.category}</TableCell>
                      <TableCell className="text-sm">{a.objective_title}</TableCell>
                      <TableCell className="text-sm">{a.owner_email}</TableCell>
                      <TableCell className="tabular-nums">{fmtRupiah(a.capital_at_risk)}</TableCell>
                      <TableCell><StatusBadge value={a.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(a.expires_at)}</TableCell>
                      <TableCell className="text-right">
                        {a.status === "PENDING" && (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title="Approve" onClick={() => approve(a)} className="text-emerald-500"><Check className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" title="Reject" onClick={() => { setRejecting(a); setReason(""); }} className="text-destructive"><X className="h-4 w-4" /></Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!loading && data && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{data.approvals.length} approval (halaman {page + 1})</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Sebelumnya</Button>
                <Button variant="outline" size="sm" disabled={data.approvals.length < 50} onClick={() => setPage((p) => p + 1)}>Berikutnya →</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reject dialog */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tolak Approval</DialogTitle></DialogHeader>
          {rejecting && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Category <span className="font-medium text-foreground">{rejecting.category}</span> — Objective <span className="font-medium text-foreground">{rejecting.objective_title}</span></p>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan penolakan (min 3)" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Batal</Button>
            <Button variant="destructive" onClick={reject} disabled={busy || reason.length < 3}>{busy ? "Menolak…" : "Tolak"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
