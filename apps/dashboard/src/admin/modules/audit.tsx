// AUREX admin — Audit Log: append-only, proof of every privileged mutation.
import { useState } from "react";
import { RefreshCw, Lock } from "lucide-react";
import { adminAudit } from "../api";
import { useAsync } from "@/hooks/use-async";
import { fmtDate, MonoText } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

export function AdminAuditLog() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, error, loading } = useAsync(
    () => adminAudit({ action: action || undefined, limit: 50, offset: page * 50 }),
    [action, page, refreshKey],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Audit Log <Lock className="h-4 w-4 text-muted-foreground" />
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">append-only</span>
          </CardTitle>
          <CardDescription>Setiap mutasi admin tercatat — tidak dapat diubah/dihapus.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-56">
              <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} placeholder="Filter action (mis. users.update)" className="font-mono text-xs" />
            </div>
            <Button variant="outline" size="icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {loading ? <LoadingState rows={4} /> : error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Waktu</TableHead><TableHead>Aktor</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>IP</TableHead><TableHead>Detail</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data?.audit.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Tidak ada entri.</TableCell></TableRow>}
                  {data?.audit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(a.created_at)}</TableCell>
                      <TableCell className="text-sm">{a.actor_email ?? <span className="text-muted-foreground">system</span>}</TableCell>
                      <TableCell><Badge variant="outline" className="font-mono text-xs">{a.action}</Badge></TableCell>
                      <TableCell className="text-xs"><MonoText>{a.target}</MonoText></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.ip ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-56 truncate">{typeof a.detail === "object" && a.detail ? JSON.stringify(a.detail).slice(0, 120) : String(a.detail ?? "—")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!loading && data && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{data.audit.length} entri (halaman {page + 1})</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Sebelumnya</Button>
                <Button variant="outline" size="sm" disabled={data.audit.length < 50} onClick={() => setPage((p) => p + 1)}>Berikutnya →</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
