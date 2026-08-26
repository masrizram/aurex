// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Main } from "@/components/layout/main";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ErrorState, LoadingState, IntelligentEmpty,
  fmtRp, valueStateDesc,
} from "@/components/aurex-primitives";
import { listObjectives, listApprovals, approveDecision, rejectDecision, parseApiError } from "@/api";
import type { Approval } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";
import { Metric } from "./metric";

// ── Approvals — Economic Decision Inbox (§11 master prompt) ──────────────────
// Setiap permintaan menjawab: apa yang akan dilakukan, mengapa, berapa modal,
// upside/downside, dan apa yang terjadi bila ditolak — dari kolom asli tabel
// approvals yang ditulis engine (fallback payload utk baris lama). Rule 4:
// nilai tidak ada → "—", bukan angka karangan.
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
              <IntelligentEmpty
                stageTitle='Tidak ada approval tertunda'
                doing='Semua misi sudah diproses. AUREX akan meminta persetujuan otomatis saat keputusan ekonomi berisiko modal atau sulit dibatalkan.'
                next='Misi baru akan muncul di sini sebelum dieksekusi.'
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
                <ApprovalHistory items={history} />
              </>
            )}
          </>
        )}
      </Main>
    </>
  );
}

function ApprovalHistory({ items }: { items: Approval[] }) {
  const { data: objectives } = useAsync(listObjectives);
  const byId = new Map((objectives ?? []).map((o) => [o.id, o.title]));
  return (
    <div className='space-y-2'>
      {items.slice(0, 20).map((a) => (
        <div key={a.id} className='flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm'>
          <span className='flex flex-wrap items-center gap-2'>
            <Badge variant={a.status === "APPROVED" ? "success" : a.status === "REJECTED" ? "destructive" : "outline"}>
              {a.status === "APPROVED" ? "Disetujui" : a.status === "REJECTED" ? "Ditolak" : a.status}
            </Badge>
            <span>{labelFor(a)}</span>
            {(a.objective_title || byId.get(a.objective_id ?? "")) && (
              <span className='text-xs text-muted-foreground'>
                · {a.objective_title ?? byId.get(a.objective_id ?? "")}
              </span>
            )}
          </span>
          {a.decided_at && (
            <time className='text-xs text-muted-foreground' dateTime={a.decided_at}>
              {new Date(a.decided_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
            </time>
          )}
        </div>
      ))}
    </div>
  );
}

/** Label kategori approval → bahasa produk. */
const CATEGORY_LABELS: Record<string, string> = {
  LARGE_CAPITAL: "Modal besar",
  IRREVERSIBLE: "Tindakan permanen",
  HIGH_RISK: "Risiko tinggi",
  DESTRUCTIVE: "Destruktif",
  PIVOT: "Pivot arah",
  REGULATORY: "Regulasi",
};
function labelFor(a: Approval): string {
  return CATEGORY_LABELS[a.category] ?? a.category.replaceAll("_", " ").toLowerCase();
}

function ApprovalCard({ approval, onDone }: { approval: Approval; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const payload = approval.payload as Record<string, any> | null;

  // Kolom kanonik dulu (ditulis engine), payload lama sebagai fallback.
  const why = approval.why_required || payload?.why_required || payload?.why || null;
  const what = approval.what_will_happen || payload?.what_will_happen || payload?.description || null;
  const capitalAtRisk =
    approval.capital_at_risk != null ? approval.capital_at_risk
    : payload?.capital_at_risk ?? payload?.cost ?? null;
  const upside =
    approval.expected_upside != null ? approval.expected_upside
    : payload?.expected_upside ?? payload?.upside ?? null;
  const downside =
    approval.expected_downside != null ? approval.expected_downside
    : payload?.expected_downside ?? payload?.downside ?? null;
  const expiresLabel = approval.expires_at
    ? new Date(approval.expires_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
    : null;

  const decide = async (kind: "approve" | "reject") => {
    setBusy(kind);
    try {
      if (kind === "approve") await approveDecision(approval.id);
      else await rejectDecision(approval.id, "ditolak dari dashboard");
      toast.success(kind === "approve"
        ? "Misi disetujui — eksekusi dimulai."
        : "Misi ditolak — objective masuk antrian perhatian.");
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
          <div className='space-y-1'>
            <CardTitle className='text-base'>{labelFor(approval)}</CardTitle>
            {approval.objective_title && (
              <CardDescription>
                <Link
                  to={`/app/objectives/${approval.objective_id ?? ""}`}
                  className='underline-offset-4 hover:underline'
                >
                  Objective: {approval.objective_title}
                </Link>
              </CardDescription>
            )}
          </div>
          <Badge variant='outline' className='border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'>
            Menunggu keputusan
          </Badge>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {/* Apa yang AUREX lakukan & mengapa */}
        <div className='space-y-2 text-sm'>
          <div>
            <p className='font-medium'>Apa yang akan dilakukan AUREX</p>
            <p className='text-muted-foreground'>
              {what ?? "Misi akan dieksekusi sesuai paket eksekusi yang disusun engine."}
            </p>
          </div>
          <div>
            <p className='font-medium'>Mengapa perlu persetujuan Anda</p>
            <p className='text-muted-foreground'>{why ?? "Nilai ekonomi atau risikonya melampaui batas otonomi."}</p>
          </div>
        </div>

        {/* Angka keputusan */}
        <div className='grid gap-3 text-sm sm:grid-cols-3'>
          <Metric label='Modal Berisiko' value={fmtRp(capitalAtRisk)} />
          <Metric label='Expected Upside' value={fmtRp(upside)} />
          <Metric label='Maximum Downside' value={downside != null ? fmtRp(downside) : "—"} />
        </div>

        {/* Jika ditolak + kedaluwarsa */}
        <div className='space-y-1 rounded-md border border-dashed p-3 text-sm'>
          <p className='font-medium'>Jika ditolak</p>
          <p className='text-muted-foreground'>
            Misi tidak dieksekusi; objective menjadi BLOCKED dan menunggu arahan atau riset ulang.
            Tidak ada modal yang dibelanjakan.
          </p>
          {expiresLabel && (
            <p className='flex items-center gap-1 pt-1 text-xs text-muted-foreground'>
              <Clock className='size-3' aria-hidden='true' /> Berlaku hingga {expiresLabel} — lewat itu
              otomatis kedaluwarsa.
            </p>
          )}
        </div>

        <div className='flex flex-wrap gap-2'>
          <Button onClick={() => decide("approve")} disabled={busy != null}>
            <CheckCircle2 /> {busy === "approve" ? "Menyetujui…" : "Approve & Execute"}
          </Button>
          <Button variant='destructive' onClick={() => decide("reject")} disabled={busy != null}>
            <XCircle /> {busy === "reject" ? "Menolak…" : "Reject"}
          </Button>
        </div>
        <p className='text-xs text-muted-foreground'>
          Status nilai hasil eksekusi nanti mengikuti verifikasi: {valueStateDesc("OBSERVED")}
        </p>
      </CardContent>
    </Card>
  );
}
