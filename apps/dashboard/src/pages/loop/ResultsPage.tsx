// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { Link } from "react-router-dom";
import { FileCheck2 } from "lucide-react";
import { Main } from "@/components/layout/main";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ErrorState, LoadingState, IntelligentEmpty, EvidenceBadge,
  ValueStateBadge, tierToValueState, fmtRp,
} from "@/components/aurex-primitives";
import { listObjectives, listResults } from "@/api";
import type { ResultRow } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";
import { Metric } from "./metric";

// ── Results — Economic Outcome (§12/§13 master prompt) ───────────────────────
// Klaim eksekusi DIPISAH dari status verifikasinya: SELF_REPORTED = Observed,
// EVIDENCED = Attributed, RECONCILED = Verified (pemetaan tier engine §5).
// Evidence pack ditampilkan dari payload GLM asli (uri + sha256) — bukti
// tidak direkayasa ulang di UI.
export function ResultsPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data, error, loading, reload } = useAsync(
    () => (active ? listResults(active) : Promise.resolve(null)),
    [active]
  );
  const results: ResultRow[] = data?.results ?? [];
  const verifiedCount = results.filter((r) => r.verification_tier === "RECONCILED").length;

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Results</h1>
            <p className='text-sm text-muted-foreground'>
              Hasil ekonomi terukur — klaim eksekusi dan verifikasinya dipisah jelas.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {!active ? <NoObjectiveState /> : loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : results.length === 0 ? (
          <IntelligentEmpty
            stageTitle='Belum ada hasil ekonomi'
            doing='Hasil muncul setelah misi dieksekusi oleh provider dan hasilnya diterima result processor.'
            done={[
              "Klaim hanya dicatat bila lolos intake anti-duplikat dan identitas paket.",
            ]}
            next='Setelah misi berjalan, hasilnya muncul di sini dengan status verifikasi (Self-reported → Evidenced → Reconciled).'
            needsUser={false}
          />
        ) : (
          <div className='space-y-3'>
            <p className='text-sm text-muted-foreground'>
              {results.length} hasil · {verifiedCount} terekonsiliasi dengan pembayaran.
              Angka di bawah adalah KLAIM eksekusi — lihat badge untuk status kebenarannya.
            </p>
            {results.map((r) => <ResultCard key={r.id} row={r} />)}
          </div>
        )}
      </Main>
    </>
  );
}

function ResultCard({ row }: { row: ResultRow }) {
  const vs = tierToValueState(row.verification_tier);
  const payload = row.payload as Record<string, any> | null;
  const bm = payload?.business_metrics ?? null;
  // Net klaim = aritmetika atas dua angka yang sama-sama ditampilkan (transparan).
  const netClaimed =
    row.revenue_claimed != null && row.cost_claimed != null
      ? Number(row.revenue_claimed) - Number(row.cost_claimed)
      : null;
  const evidence: { kind?: string; uri?: string; sha256?: string }[] =
    Array.isArray(payload?.evidence) ? payload.evidence : [];
  const unverified: string[] = Array.isArray(payload?.unverified_items) ? payload.unverified_items : [];

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div className='space-y-1'>
            <CardTitle className='text-base'>{row.opportunity_name || "Hasil eksekusi"}</CardTitle>
            <CardDescription>
              Misi{" "}
              {row.mission_id && (
                <Link className='underline underline-offset-4' to={`/app/objectives`}>
                  {row.mission_id.slice(0, 8)}
                </Link>
              )}
              {row.provider ? ` · ${row.provider}` : ""}
              {row.attempt != null ? ` · percobaan ${row.attempt}` : ""}
              {row.finished_at ? ` · ${new Date(row.finished_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}` : ""}
            </CardDescription>
          </div>
          <div className='flex items-center gap-2'>
            <EvidenceBadge tier={row.verification_tier} />
            <ValueStateBadge state={vs} />
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid gap-3 text-sm sm:grid-cols-4'>
          <Metric label='Revenue (klaim)' value={fmtRp(row.revenue_claimed)} />
          <Metric label='Cost (klaim)' value={fmtRp(row.cost_claimed)} />
          <Metric label='Net (klaim)' value={netClaimed != null ? fmtRp(netClaimed) : "—"} />
          <Metric label='Customers' value={bm?.customers != null ? String(bm.customers) : "—"} />
        </div>

        {/* Status kebenaran angka */}
        <p className='text-xs text-muted-foreground'>
          {vs === "VERIFIED"
            ? "Angka ini terekonsiliasi dengan pembayaran nyata di ledger double-entry."
            : vs === "ATTRIBUTED"
              ? "Didukung bukti eksekusi (hash terverifikasi) namun belum terekonsiliasi dengan pembayaran."
              : vs === "OBSERVED"
                ? "Laporan langsung dari eksekutor — BELUM diverifikasi independen. Jangan dijadikan dasar keputusan final."
                : "Status verifikasi tidak dikenal."}
        </p>

        {/* Evidence pack (§13) */}
        {(evidence.length > 0 || unverified.length > 0 || payload?.verification) && (
          <div className='rounded-md border p-3 text-sm'>
            <p className='mb-2 flex items-center gap-2 font-medium'>
              <FileCheck2 className='size-4' aria-hidden='true' /> Bukti
            </p>
            {evidence.length > 0 ? (
              <ul className='space-y-1'>
                {evidence.map((ev, i) => (
                  <li key={`${ev.uri}-${i}`} className='flex flex-wrap items-baseline gap-x-2 text-xs break-all'>
                    <span className='font-mono uppercase text-muted-foreground'>{ev.kind}</span>
                    <span className='max-w-md truncate'>{ev.uri}</span>
                    {ev.sha256 && (
                      <span className='font-mono text-muted-foreground' title={ev.sha256}>
                        sha256:{ev.sha256.slice(0, 10)}…
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-xs text-muted-foreground'>Tidak ada bukti terlampir pada laporan ini.</p>
            )}
            {payload?.verification?.tests_run != null && (
              <p className='mt-2 text-xs text-muted-foreground'>
                Verifikasi teknis: {payload.verification.tests_run} tes dijalankan ·{" "}
                {payload.verification.test_results?.passed ?? "?"} lulus · build{" "}
                {payload.verification.build_result ?? "?"}.
              </p>
            )}
            {unverified.length > 0 && (
              <div className='mt-2 rounded border border-dashed border-amber-500/40 bg-amber-500/5 p-2'>
                <p className='text-xs font-medium'>Belum terverifikasi</p>
                <ul className='list-inside list-disc text-xs text-muted-foreground'>
                  {unverified.slice(0, 5).map((u) => <li key={u}>{u}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Ringkasan pekerjaan */}
        {Array.isArray(payload?.work?.completed) && payload.work.completed.length > 0 && (
          <details className='text-sm'>
            <summary className='cursor-pointer text-muted-foreground'>Pekerjaan yang dilaporkan selesai</summary>
            <ul className='mt-2 list-inside list-disc text-xs text-muted-foreground'>
              {payload.work.completed.slice(0, 6).map((w: string) => <li key={w}>{w}</li>)}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
