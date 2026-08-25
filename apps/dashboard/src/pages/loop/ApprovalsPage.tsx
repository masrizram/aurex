// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Main } from "@/components/layout/main";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState, fmtRp } from "@/components/aurex-primitives";
import { listObjectives, listApprovals, approveDecision, rejectDecision, parseApiError } from "@/api";
import type { Approval } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";
import { Metric } from "./metric";

// ── Approvals (§20) ───────────────────────────────────────────────────────────
export function ApprovalsPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data: approvals, error, loading, reload } = useAsync(
    () => (active ? listApprovals(active) : Promise.resolve([])),
    [active]
  );
  const pending = (approvals ?? []).filter((a) => a.status === "PENDING");
  const history = (approvals ?? []).filter((a) => a.status !== "PENDING");

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Approvals</h1>
            <p className='text-sm text-muted-foreground'>
              Misi menunggu persetujuan Anda sebelum dieksekusi.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {!active ? <NoObjectiveState /> : loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : (
          <>
            {pending.length === 0 ? (
              <EmptyState
                title='Tidak ada approval tertunda'
                description='Semua misi sudah diproses. AUREX akan memberi tahu saat ada misi baru.'
              />
            ) : (
              <div className='space-y-3'>
                {pending.map((a) => (
                  <ApprovalCard key={a.id} approval={a} onDone={reload} />
                ))}
              </div>
            )}
            {history.length > 0 && (
              <>
                <h2 className='mb-3 mt-8 text-sm font-medium text-muted-foreground'>Riwayat</h2>
                <div className='space-y-2'>
                  {history.map((a) => (
                    <div key={a.id} className='flex items-center justify-between rounded-md border p-3 text-sm'>
                      <span className='flex items-center gap-2'>
                        <Badge variant='outline'>{a.status}</Badge>
                        <span className='text-muted-foreground'>{a.decision_type.replace(/_/g, " ").toLowerCase()}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Main>
    </>
  );
}

function ApprovalCard({ approval, onDone }: { approval: Approval; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const payload = approval.payload as Record<string, any> | null;
  const title = approval.decision_type.replace(/_/g, " ").toLowerCase();

  const decide = async (kind: "approve" | "reject") => {
    setBusy(kind);
    try {
      if (kind === "approve") await approveDecision(approval.id);
      else await rejectDecision(approval.id, "not now");
      toast.success(kind === "approve" ? "Misi disetujui — eksekusi dimulai." : "Misi ditolak.");
      onDone();
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div>
            <CardTitle className='text-base capitalize'>{title}</CardTitle>
            <CardDescription>
              {payload?.why || payload?.description || "AUREX meminta persetujuan untuk mengeksekusi misi ini."}
            </CardDescription>
          </div>
          <Badge variant='outline' className='border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'>
            Menunggu keputusan
          </Badge>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {payload && (
          <div className='grid gap-3 text-sm sm:grid-cols-3'>
            <Metric label='Upside' value={fmtRp(payload.expected_upside ?? payload.upside ?? null)} />
            <Metric label='Downside' value={fmtRp(payload.expected_downside ?? payload.downside ?? null)} />
            <Metric label='Modal Berisiko' value={fmtRp(payload.capital_at_risk ?? payload.cost ?? null)} />
            <Metric label='Risiko' value={payload.risk ?? "—"} />
            <Metric label='Reversibilitas' value={payload.reversible === false ? "Tidak dapat dibatalkan" : "Dapat dibatalkan"} />
            <Metric label='Rollback' value={payload.rollback ?? "Tersedia"} />
          </div>
        )}
        <div className='flex flex-wrap gap-2'>
          <Button onClick={() => decide("approve")} disabled={busy != null}>
            <CheckCircle2 /> {busy === "approve" ? "Menyetujui…" : "Approve & Execute"}
          </Button>
          <Button variant='destructive' onClick={() => decide("reject")} disabled={busy != null}>
            <XCircle /> {busy === "reject" ? "Menolak…" : "Reject"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

