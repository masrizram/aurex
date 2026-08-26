// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { Link } from "react-router-dom";
import { Main } from "@/components/layout/main";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ErrorState, LoadingState, IntelligentEmpty, DecisionBadge,
  ValueStateBadge, fmtRp, fmtPctRatio, fmtRoi,
} from "@/components/aurex-primitives";
import { listObjectives, getEconomics, listDecisions, getAiEconomics } from "@/api";
import type { EconomicsSnapshotRow, DecisionRow } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";
import { Metric } from "./metric";

// ── Economics — Economic Truth Center (§14 master prompt) ────────────────────
// SEMUA angka dari economic_snapshots TURUNAN LEDGER (dihitung engine §15) +
// nilai VERIFIED langsung dari capital_transactions RECONCILED. Snapshot lama =
// baseline; terbaru = current. Tidak ada angka karangan: snapshot kosong →
// dijelaskan mengapa (Rule 4).
export function EconomicsPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data: econ, error, loading, reload } = useAsync(
    () => (active ? getEconomics(active) : Promise.resolve(null)),
    [active]
  );
  const { data: decData } = useAsync(
    () => (active ? listDecisions(active) : Promise.resolve({ decisions: [] as DecisionRow[] })),
    [active]
  );
  const decisions = decData?.decisions ?? [];

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Economics</h1>
            <p className='text-sm text-muted-foreground'>
              Kebenaran ekonomi — dihitung dari ledger double-entry, bukan klaim model.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {!active ? <NoObjectiveState /> : loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : (
          <EconomicsBody econ={econ} decisions={decisions} objectiveId={active} />
        )}
      </Main>
    </>
  );
}

function EconomicsBody({
  econ, decisions, objectiveId,
}: {
  econ: Awaited<ReturnType<typeof getEconomics>> | null
  decisions: DecisionRow[]
  objectiveId: string
}) {
  if (!econ || econ.snapshots.length === 0) {
    return (
      <IntelligentEmpty
        stageTitle='Belum ada snapshot ekonomi'
        doing='Snapshot dibuat otomatis oleh engine setiap kali ledger berubah (pembayaran terekonsiliasi).'
        next='Setelah rekonsiliasi pertama, P&L lengkap muncul di sini: revenue, COGS, gross profit, opex, operating profit, dan ROI.'
      />
    );
  }

  const cur = econ.current;
  const tgt = econ.target;
  const isBaselineSameAsCurrent = econ.snapshots.length === 1;

  return (
    <>
      {/* ── P&L / Economic Summary (LEVEL 1) ── */}
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <Metric label='Revenue' value={fmtRp(cur?.revenue)} />
        <Metric label='COGS' value={fmtRp(cur?.cogs)} />
        <Metric
          label='Gross Profit'
          value={
            <>
              {fmtRp(cur?.gross_profit)}
              {cur?.gross_margin != null && (
                <span className='ms-2 text-xs font-normal text-muted-foreground'>
                  margin {fmtPctRatio(cur.gross_margin, 1)}
                </span>
              )}
            </>
          }
        />
        <Metric label='Operating Profit' value={fmtRp(cur?.operating_profit)} />
      </div>

      {/* ── Target vs current + ROI + Verified (LEVEL 2) ── */}
      <Card className='mt-6'>
        <CardHeader>
          <CardTitle className='text-base'>Target & Nilai Terverifikasi</CardTitle>
          <CardDescription>
            Target dari objective; nilai terverifikasi hanya dari pembayaran terekonsiliasi.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4'>
            <Metric label='Target Profit' value={fmtRp(tgt?.target_profit)} />
            <Metric
              label='ROI (engine)'
              value={
                <>
                  {cur?.roi != null ? fmtRoi(Number(cur.roi)) : "—"}
                  <span className='ms-2 block text-xs font-normal text-muted-foreground'>
                    {cur?.roi != null ? "Profit bersih ÷ modal disetujui" : "Dihitung saat modal > 0"}
                  </span>
                </>
              }
            />
            <Metric label='Verified Revenue' value={fmtRp(econ.verified.revenue)} />
            <Metric label='Verified Cost' value={fmtRp(econ.verified.cost)} />
          </div>
          <div className='flex flex-wrap items-center gap-3'>
            <ValueStateBadge state='VERIFIED' />
            <span className='text-xs text-muted-foreground'>
              Angka lain pada halaman ini adalah posisi ledger turunan (OBSERVED-grade), bukan hasil verifikasi pembayaran.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Capital (LEVEL 2) ── */}
      <Card className='mt-6'>
        <CardHeader>
          <CardTitle className='text-base'>Modal</CardTitle>
          <CardDescription>Disetujui, terpakai, dan sisa — dari identitas engine.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='grid gap-4 text-sm sm:grid-cols-3'>
            <Metric label='Capital Approved' value={fmtRp(tgt?.capital_approved)} />
            <Metric label='Capital Deployed' value={fmtRp(cur?.capital_deployed)} />
            <Metric label='Capital Remaining' value={fmtRp(cur?.capital_remaining)} />
          </div>
          {cur?.drawdown != null && Number(cur.drawdown) !== 0 && (
            <p className='mt-3 text-xs text-muted-foreground'>Drawdown tercatat: {fmtRp(cur.drawdown)}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Snapshot history (LEVEL 3) ── */}
      <Card className='mt-6'>
        <CardHeader>
          <CardTitle className='text-base'>Riwayat Snapshot</CardTitle>
          <CardDescription>
            {isBaselineSameAsCurrent
              ? "Satu snapshot — baseline akan terbentuk saat ledger kembali berubah."
              : "Baseline = snapshot tertua; current = terbaru. Semua baris diturunkan dari ledger."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SnapshotTable rows={econ.snapshots} />
        </CardContent>
      </Card>

      {/* ── Keputusan AUREX (konteks WHY) ── */}
      {decisions.length > 0 && (
        <Card className='mt-6'>
          <CardHeader>
            <CardTitle className='text-base'>Keputusan AUREX</CardTitle>
            <CardDescription>Rekomendasi siklus terakhir dengan keyakinannya.</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {decisions.slice(0, 3).map((d) => (
              <div key={d.id} className='rounded-md border p-3'>
                <div className='flex items-center justify-between gap-2'>
                  <DecisionBadge decision={d.decision} />
                  {d.confidence != null && d.confidence !== "" && (
                    <span className='text-xs text-muted-foreground'>
                      Keyakinan {fmtPctRatio(d.confidence, 0)}
                    </span>
                  )}
                </div>
                {d.reason && <p className='mt-2 text-sm text-muted-foreground'>{d.reason}</p>}
                {Array.isArray(d.evidence_ids) && d.evidence_ids.length > 0 && (
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Bukti terkait: {d.evidence_ids.length} item.
                  </p>
                )}
              </div>
            ))}
            <Link to='/app/objectives' className='inline-block text-xs underline underline-offset-4'>
              Lihat semua keputusan di detail objective →
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Konteks traceability */}
      <AiEconomicsCard />
      <p className='mt-6 text-xs text-muted-foreground'>
        Sumber: economic_snapshots objective {objectiveId.slice(0, 8)}… — dibangun ulang penuh dari
        capital_transactions setiap perubahan ledger.
      </p>
    </>
  );
}

// ── Akuntabilitas AI §17: strategi (KIMI) vs eksekusi (GLM), dari model_runs ──
export function AiEconomicsCard() {
  const { data, error } = useAsync(getAiEconomics);
  if (error)
    return (
      <p className='mt-6 text-xs text-muted-foreground'>
        Data akuntabilitas AI belum tersedia.
      </p>
    );
  const rows = data?.by_agent_purpose ?? [];
  return (
    <Card className='mt-6'>
      <CardHeader>
        <CardTitle className='text-base'>Akuntabilitas AI</CardTitle>
        <CardDescription>
          Jejak run model nyata (tabel model_runs): token, biaya tercatat, latensi rata-rata.
          Biaya tampil — bila billing adapter belum mencatatnya.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {rows.length === 0 ? (
          <IntelligentEmpty
            stageTitle='Belum ada run model tercatat'
            doing='Setiap panggilan KIMI/GLM akan tercatat di sini — token masuk/keluar dan statusnya.'
            next='Jalankan satu siklus objective untuk mengisi jejak akuntabilitas AI.'
          />
        ) : (
          ["KIMI", "GLM"].map((agent) => {
            const group = rows.filter((r) => r.agent === agent);
            if (group.length === 0) return null;
            const runs = group.reduce((a, r) => a + r.runs, 0);
            const okRuns = group.reduce((a, r) => a + r.succeeded, 0);
            const tokensIn = group.reduce((a, r) => a + Number(r.input_tokens || 0), 0);
            const tokensOut = group.reduce((a, r) => a + Number(r.output_tokens || 0), 0);
            return (
              <div key={agent} className='space-y-2'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <p className='text-sm font-medium'>
                    {agent === "KIMI" ? "Agent Strategi (KIMI)" : "Agent Eksekusi (GLM)"}
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    {runs} run · {okRuns} sukses ({runs > 0 ? Math.round((okRuns / runs) * 100) : 0}%) ·
                    {" "}token {tokensIn.toLocaleString("id-ID")} in / {tokensOut.toLocaleString("id-ID")} out
                  </p>
                </div>
                <table className='w-full text-xs'>
                  <caption className='sr-only'>Rincian run {agent}</caption>
                  <thead>
                    <tr className='border-b text-left text-muted-foreground'>
                      <th scope='col' className='py-1 pr-3'>Tujuan</th>
                      <th scope='col' className='py-1 pr-3'>Run</th>
                      <th scope='col' className='py-1 pr-3'>Token in/out</th>
                      <th scope='col' className='py-1 pr-3'>Biaya</th>
                      <th scope='col' className='py-1'>Latensi rata-rata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((r) => (
                      <tr key={`${r.agent}-${r.purpose}`} className='border-b last:border-0'>
                        <td className='py-1 pr-3'>{r.purpose}</td>
                        <td className='py-1 pr-3 tabular-nums'>{r.runs} ({r.failed} gagal)</td>
                        <td className='py-1 pr-3 tabular-nums'>
                          {Number(r.input_tokens).toLocaleString("id-ID")} / {Number(r.output_tokens).toLocaleString("id-ID")}
                        </td>
                        <td className='py-1 pr-3 tabular-nums'>{r.cost != null ? fmtRp(r.cost) : "—"}</td>
                        <td className='py-1 tabular-nums'>{r.avg_latency_ms} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function SnapshotTable({ rows }: { rows: EconomicsSnapshotRow[] }) {
  return (
    <div className='overflow-x-auto'>
      <table className='w-full text-sm'>
        <caption className='sr-only'>Riwayat snapshot ekonomi dari ledger</caption>
        <thead>
          <tr className='border-b text-left text-xs text-muted-foreground'>
            <th scope='col' className='py-2 pr-4'>Waktu</th>
            <th scope='col' className='py-2 pr-4'>Revenue</th>
            <th scope='col' className='py-2 pr-4'>COGS</th>
            <th scope='col' className='py-2 pr-4'>Gross Profit</th>
            <th scope='col' className='py-2 pr-4'>Opex</th>
            <th scope='col' className='py-2 pr-4'>Op. Profit</th>
            <th scope='col' className='py-2 pr-4'>Deployed</th>
            <th scope='col' className='py-2'>ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.created_at ?? i} className='border-b last:border-0'>
              <td className='py-2 pr-4 whitespace-nowrap'>
                {s.created_at ? new Date(s.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—"}
              </td>
              <td className='py-2 pr-4 tabular-nums'>{fmtRp(s.revenue)}</td>
              <td className='py-2 pr-4 tabular-nums'>{fmtRp(s.cogs)}</td>
              <td className='py-2 pr-4 tabular-nums'>{fmtRp(s.gross_profit)}</td>
              <td className='py-2 pr-4 tabular-nums'>{fmtRp(s.opex)}</td>
              <td className='py-2 pr-4 tabular-nums'>{fmtRp(s.operating_profit)}</td>
              <td className='py-2 pr-4 tabular-nums'>{fmtRp(s.capital_deployed)}</td>
              <td className='py-2 tabular-nums'>{s.roi != null && s.roi !== "" ? fmtRoi(Number(s.roi)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
