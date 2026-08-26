// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useMemo, useState } from "react";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Main } from "@/components/layout/main";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  ErrorState, LoadingState, IntelligentEmpty,
  fmtRp, fmtPctRatio, phaseLabel,
} from "@/components/aurex-primitives";
import { listObjectives, listOpportunities, selectOpportunity, letAurexDecide, rejectOpportunity, saveOpportunity, parseApiError } from "@/api";
import type { OppSummary } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";

// ── Opportunities — Ranked Economic Opportunity Portfolio (§6 master prompt) ─
// Skor komposit & EV adalah OUTPUT ENGINE (paket economics) — UI menampilkan
// faktor penyusunnya apa adanya tanpa mengarang formula baru (Rule 4/§6).
export function OpportunitiesPage() {
  const { data: objectives, loading: oLoading } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = useMemo(() => objId ?? objectives?.[0]?.id ?? null, [objId, objectives]);
  const { data: opps, error, loading, reload } = useAsync(
    () => (active ? listOpportunities(active) : Promise.resolve([])),
    [active]
  );

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Opportunities</h1>
            <p className='text-sm text-muted-foreground'>
              Portofolio peluang dengan peringkat, expected value, dan alasan peringkatnya.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <div className='flex items-center gap-2'>
              <Button variant='outline' size='sm' disabled={!active} onClick={async () => {
                try {
                  await letAurexDecide(active!);
                  toast.success("AUREX akan memilih peluang terbaik.");
                  reload();
                } catch (e) { toast.error(parseApiError(e)); }
              }}>
                <Sparkles /> Let AUREX Decide
              </Button>
              <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
            </div>
          )}
        </div>
        {oLoading ? <LoadingState /> : !active ? <NoObjectiveState /> : (
          loading ? <LoadingState rows={3} /> : error ? <ErrorState message={error} onRetry={reload} /> : (opps ?? []).length === 0 ? (
            <IntelligentEmpty
              stageTitle='Belum ada peluang terdaftar'
              doing='AUREX menemukan dan menyusun peringkat peluang setelah riset pasar objective ini selesai.'
              done={[
                "Setiap peluang dinilai pada 8 faktor: permintaan, kesediaan membayar, profitabilitas, skalabilitas, defensibilitas, kelayakan eksekusi, kekuatan bukti, waktu-ke-pendapatan.",
              ]}
              next='Portofolio berperingkat akan muncul di sini begitu tahap discovery selesai.'
            />
          ) : (
            <div className='space-y-3'>
              <p className='text-sm text-muted-foreground'>
                Diurutkan oleh skor engine — buka detail untuk melihat faktor penyusun peringkat.
              </p>
              {(opps ?? []).map((o, i) => (
                <OpportunityCard key={o.id} opp={o} rank={i + 1} objectiveId={active!} onChanged={reload} />
              ))}
            </div>
          )
        )}
      </Main>
    </>
  );
}

const FACTORS: Array<{ key: keyof OppSummary; label: string }> = [
  { key: "demand_score", label: "Permintaan" },
  { key: "willingness_to_pay_score", label: "Kesediaan membayar" },
  { key: "profitability_score", label: "Profitabilitas" },
  { key: "scalability_score", label: "Skalabilitas" },
  { key: "defensibility_score", label: "Defensibilitas" },
  { key: "execution_feasibility_score", label: "Kelayakan eksekusi" },
  { key: "evidence_strength_score", label: "Kekuatan bukti" },
  { key: "time_to_revenue_score", label: "Waktu-ke-pendapatan" },
];

function OpportunityCard({ opp, rank, objectiveId, onChanged }: {
  opp: OppSummary; rank: number; objectiveId: string; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onChanged(); }
    catch (e) { toast.error(parseApiError(e)); }
    finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='flex items-start gap-3'>
            <span className='grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary' aria-label={`Peringkat ${rank}`}>
              #{rank}
            </span>
            <div>
              <CardTitle className='text-base'>{opp.name}</CardTitle>
              <CardDescription>{opp.customer_segment}</CardDescription>
            </div>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {opp.expected_value != null && (
              <Badge variant='secondary' title="Expected value dari engine">
                EV {fmtRp(opp.expected_value)}
              </Badge>
            )}
            {opp.risk_adjusted_score != null && (
              <Badge variant='secondary'>Skor {Number(opp.risk_adjusted_score).toFixed(0)}</Badge>
            )}
            <Badge variant='outline'>{phaseLabel(opp.status)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className='grid gap-3 text-sm sm:grid-cols-4'>
          <div>
            <p className='text-xs text-muted-foreground'>Modal dibutuhkan</p>
            <p className='font-medium tabular-nums'>{fmtRp(opp.capital_required ?? null)}</p>
          </div>
          <div>
            <p className='text-xs text-muted-foreground'>Potensi pendapatan</p>
            <p className='font-medium tabular-nums'>{fmtRp(opp.revenue_potential ?? null)}</p>
          </div>
          <div>
            <p className='text-xs text-muted-foreground'>Margin</p>
            <p className='font-medium tabular-nums'>{fmtPctRatio(opp.margin, 0)}</p>
          </div>
          <div>
            <p className='text-xs text-muted-foreground'>Peluang sukses</p>
            <p className='font-medium tabular-nums'>{fmtPctRatio(opp.probability_of_success, 0)}</p>
          </div>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant='outline' size='sm' className='mt-4'>Lihat detail & alasan peringkat</Button>
          </SheetTrigger>
          <SheetContent side='right' className='w-full overflow-y-auto sm:max-w-md'>
            <SheetHeader>
              <SheetTitle>{opp.name}</SheetTitle>
              <SheetDescription>{opp.customer_segment}</SheetDescription>
            </SheetHeader>
            <div className='space-y-4 px-4 pb-8'>
              {/* Mengapa peringkat ini? — faktor asli dari engine */}
              <div className='rounded-md border p-3'>
                <p className='mb-2 text-sm font-medium'>Mengapa peringkat #{rank}?</p>
                <ul className='space-y-1.5'>
                  {FACTORS.map(({ key, label }) => {
                    const v = opp[key];
                    const n = v == null || v === "" ? null : Number(v);
                    return (
                      <li key={String(key)} className='flex items-center justify-between gap-2 text-sm'>
                        <span className='text-muted-foreground'>{label}</span>
                        {n != null ? (
                          <span className='flex items-center gap-2'>
                            <span className='h-1.5 w-20 overflow-hidden rounded bg-muted' aria-hidden='true'>
                              <span
                                className='block h-full rounded bg-primary'
                                style={{ width: `${Math.max(0, Math.min(100, n))}%` }}
                              />
                            </span>
                            <span className='w-10 text-right tabular-nums'>{n.toFixed(0)}</span>
                          </span>
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </li>
                    );
                  })}
                  <li className='flex items-center justify-between border-t pt-1.5 text-sm'>
                    <span>Risiko (penalti)</span>
                    <span className='tabular-nums'>
                      {opp.risk_score != null ? Number(opp.risk_score).toFixed(0) : "—"}
                    </span>
                  </li>
                </ul>
                <p className='mt-2 text-xs text-muted-foreground'>
                  Skor akhir dihitung engine dari faktor-faktor di atas (komposit berbobot dikurangi
                  penalti risiko). Nilai yang kosong berarti faktor belum dinilai saat discovery.
                </p>
              </div>

              <div className='grid grid-cols-2 gap-3 text-sm'>
                <div>
                  <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Harga</p>
                  <p className='tabular-nums'>{fmtRp(opp.price ?? null)}</p>
                </div>
                <div>
                  <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Estimasi biaya</p>
                  <p className='tabular-nums'>{fmtRp(opp.cost_estimate ?? null)}</p>
                </div>
                <div>
                  <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Expected value</p>
                  <p className='tabular-nums'>{fmtRp(opp.expected_value ?? null)}</p>
                </div>
                <div>
                  <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Waktu ke pendapatan</p>
                  <p className='tabular-nums'>
                    {opp.time_to_revenue_days != null
                      ? `${opp.time_to_revenue_days} hari` : "—"}
                  </p>
                </div>
              </div>

              <Section title='Problem'>{opp.problem}</Section>
              <Section title='Solusi'>{opp.solution}</Section>
              <Section title='Model Bisnis'>{opp.business_model}</Section>

              {opp.assumptions.length > 0 && (
                <Section title='Asumsi yang diuji'>
                  <ul className='list-inside list-disc space-y-1'>
                    {opp.assumptions.map((a) => <li key={String(a)}>{String(a)}</li>)}
                  </ul>
                </Section>
              )}
              {opp.unknowns.length > 0 && (
                <div className='rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-3'>
                  <p className='mb-1 text-sm font-medium'>Belum diketahui</p>
                  <ul className='list-inside list-disc space-y-1 text-sm text-muted-foreground'>
                    {opp.unknowns.map((u) => <li key={String(u)}>{String(u)}</li>)}
                  </ul>
                </div>
              )}

              <div className='flex flex-wrap gap-2 pt-2'>
                <Button size='sm' disabled={busy} onClick={() => act(() => selectOpportunity(objectiveId, opp.id), "Peluang dipilih.")}>
                  <CheckCircle2 /> Select
                </Button>
                <Button size='sm' variant='outline' disabled={busy} onClick={() => act(() => saveOpportunity(objectiveId, opp.id), "Peluang disimpan.")}>
                  Simpan
                </Button>
                <Button size='sm' variant='outline' disabled={busy} onClick={() => act(() => rejectOpportunity(objectiveId, opp.id), "Peluang ditolak.")}>
                  <XCircle /> Reject
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className='mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'>{title}</p>
      <p className='text-sm'>{children ?? "—"}</p>
    </div>
  );
}
