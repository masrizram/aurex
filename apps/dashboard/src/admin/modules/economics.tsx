// AUREX admin — Economics/Ledger: read-only. Reversal hanya via
// compensating transaction resmi (tidak pernah edit ledger langsung).
import { useState } from "react";
import { RefreshCw, Lock } from "lucide-react";
import { adminEconomics } from "../api";
import { useAsync } from "@/hooks/use-async";
import { fmtDate, fmtRupiah, MonoText, StatusBadge } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

export function AdminEconomics() {
  const [objectiveId, setObjectiveId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, error, loading } = useAsync(
    () => adminEconomics({ objective_id: objectiveId || undefined, limit: 100 }),
    [objectiveId, refreshKey],
  );

  const summary = data?.summary;
  const ledgers = data?.ledgers ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Economics / Ledger <Lock className="h-4 w-4 text-muted-foreground" />
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">read-only</span>
          </CardTitle>
          <CardDescription>Hanya reversal/compensating transaction resmi yang mengubah ledger — admin tidak pernah mengedit langsung.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Input value={objectiveId} onChange={(e) => setObjectiveId(e.target.value)} placeholder="Filter objective (uuid)" className="max-w-xs font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {loading ? <LoadingState rows={3} /> : error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : (
            <>
              {/* Summary KPI */}
              {summary && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Card className="bg-muted/40"><CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Verified Revenue</p>
                    <p className="text-xl font-semibold tabular-nums">{fmtRupiah(summary.verified_revenue)}</p>
                  </CardContent></Card>
                  <Card className="bg-muted/40"><CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Verified Cost</p>
                    <p className="text-xl font-semibold tabular-nums">{fmtRupiah(summary.verified_cost)}</p>
                  </CardContent></Card>
                  <Card className="bg-muted/40"><CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Total Drawdown</p>
                    <p className="text-xl font-semibold tabular-nums">{fmtRupiah(summary.total_drawdown)}</p>
                  </CardContent></Card>
                  <Card className="bg-muted/40"><CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Transactions</p>
                    <p className="text-xl font-semibold tabular-nums">{summary.transactions}</p>
                  </CardContent></Card>
                </div>
              )}

              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Objective</TableHead><TableHead>Debit</TableHead><TableHead>Credit</TableHead><TableHead>Amount</TableHead><TableHead>Tier</TableHead><TableHead>Memo</TableHead><TableHead>Waktu</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgers.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Tidak ada transaksi.</TableCell></TableRow>}
                    {ledgers.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.objective_title}</TableCell>
                        <TableCell className="tabular-nums"><MonoText>{t.debit_account}</MonoText></TableCell>
                        <TableCell className="tabular-nums"><MonoText>{t.credit_account}</MonoText></TableCell>
                        <TableCell className="tabular-nums">{fmtRupiah(t.amount)}</TableCell>
                        <TableCell><StatusBadge value={t.verification_tier} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.memo ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(t.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
