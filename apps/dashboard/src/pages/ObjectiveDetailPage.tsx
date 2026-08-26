import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Ban } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { ProfileDropdown } from "@/components/profile-dropdown";
import { Search } from "@/components/search";
import { ThemeSwitch } from "@/components/theme-switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState, ErrorState, LoadingState, IntelligentEmpty,
  StatusBadge, DecisionBadge, EvidenceBadge,
  ValueStateBadge, tierToValueState,
  fmtRp, fmtPct, fmtRoi, fmtPctRatio, phaseLabel,
  eventProductLabel,
} from "@/components/aurex-primitives";
import {
  getObjectiveDetail, listOpportunities, listExperiments, listMissions, listResults,
  getEconomics, listEvents, stopObjective, startObjective, parseApiError, getForecast,
  type AeeEvent, type OppSummary, type ExperimentRow, type MissionRow,
  type ResultRow,
} from "@/api";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/lib/session";

// ═════════════════════════════════════════════════════════════════
// P15+ — Objective Command Center (§4 master prompt).
// Header = baseline/current/target + modal + verified + lifecycle
// strip dari data NYATA (status FSM + counts). Tab = enam pertanyaan
// §3. Tanpa progres persen karangan (§26) — tahap lifecycle saja.
// ═════════════════════════════════════════════════════════════════

export function ObjectiveDetailPage() {
  const { objectiveId } = useParams<{ objectiveId: string }>();
  const session = useSession();
  const { data: obj, error, loading, reload } = useAsync(
    () => getObjectiveDetail(objectiveId!),
    [objectiveId]
  );

  const stop = async () => {
    try {
      await stopObjective(objectiveId!, "Stopped from dashboard");
      toast.success("Objective dihentikan.");
      reload();
    } catch (e) { toast.error(parseApiError(e)); }
  };

  const restart = async () => {
    try {
      await startObjective(objectiveId!);
      toast.success("Siklus baru dimulai.");
      reload();
    } catch (e) { toast.error(parseApiError(e)); }
  };

  return (
    <>
      <Header>
        <div className='flex flex-row gap-2'>
          <Search />
          <div className='ml-auto flex items-center gap-2 space-x-1'>
            <ThemeSwitch />
            <ProfileDropdown session={session} />
          </div>
        </div>
      </Header>
      <Main>
        <Button asChild variant='ghost' size='sm' className='mb-4 -ms-2'>
          <Link to='/app/objectives'><ArrowLeft /> Semua objective</Link>
        </Button>

        {loading ? (
          <div className='space-y-4'>
            <Skeleton className='h-10 w-2/3' />
            <Skeleton className='h-24 w-full' />
            <Skeleton className='h-64 w-full' />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !obj ? (
          <EmptyState title='Objective tidak ditemukan' description='Objective ini mungkin sudah dihapus.' />
        ) : (
          <>
            {/* ── Header block (§4) ── */}
            <div className='mb-6 space-y-4'>
              <div className='flex flex-wrap items-start justify-between gap-4'>
                <div>
                  <h1 className='text-2xl font-semibold tracking-tight'>{obj.title}</h1>
                  <div className='mt-2 flex flex-wrap items-center gap-2'>
                    {obj.business && <Badge variant='outline'>{obj.business.name}</Badge>}
                    <StatusBadge stage={obj.status} />
                    <EvidenceBadge tier={obj.environment} />
                    {obj.autonomy_level != null && (
                      <Badge variant='outline'>Otonomi: level {String(obj.autonomy_level)}</Badge>
                    )}
                  </div>
                  {(obj.created_at || obj.deadline || obj.horizon_months != null) && (
                    <p className='mt-2 text-xs text-muted-foreground'>
                      {obj.created_at && <>Dibuat {new Date(obj.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</>}
                      {obj.deadline && <> · Tenggat {new Date(obj.deadline).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</>}
                      {obj.horizon_months != null && <> · Horizon {String(obj.horizon_months)} bulan</>}
                      {obj.current_cycle != null && <> · Siklus {String(obj.current_cycle)}</>}
                    </p>
                  )}
                </div>
                <div className='flex gap-2'>
                  {obj.status.includes("STOPPED") ? (
                    <Button variant='outline' onClick={restart}>Mulai siklus baru</Button>
                  ) : (
                    <Button variant='outline' onClick={stop}>
                      <Ban /> Hentikan
                    </Button>
                  )}
                </div>
              </div>

              {/* KPI: baseline/target vs posisi ledger + verified (§5) */}
              <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                <Kpi
                  label='Target Profit'
                  value={fmtRp(obj.target_profit ?? null)}
                  hint={obj.goal_type ? obj.goal_type.replaceAll("_", " ").toLowerCase() : undefined}
                />
                <Kpi
                  label='Operating Profit (ledger)'
                  value={fmtRp(obj.snapshot?.operating_profit ?? null)}
                  hint={obj.snapshot?.revenue ? `Revenue ${fmtRp(obj.snapshot.revenue)}` : undefined}
                />
                <Kpi
                  label='ROI (engine)'
                  value={obj.snapshot?.roi != null && obj.snapshot.roi !== "" ? fmtRoi(Number(obj.snapshot.roi)) : "—"}
                  hint="Profit bersih ÷ modal disetujui"
                />
                <Kpi
                  label='Modal'
                  value={fmtRp(obj.snapshot?.capital_deployed ?? null)}
                  hint={`Disetujui ${fmtRp(obj.capital_approved ?? null)}${obj.snapshot?.capital_remaining ? ` · sisa ${fmtRp(obj.snapshot.capital_remaining)}` : ""}`}
                />
              </div>

              <LifecycleStrip obj={obj} />
            </div>

            <Tabs defaultValue='overview'>
              <TabsList className='mb-4 flex-wrap'>
                <TabsTrigger value='overview'>Overview</TabsTrigger>
                <TabsTrigger value='strategy'>Strategy</TabsTrigger>
                <TabsTrigger value='opportunities'>Opportunities{obj.counts.opportunities > 0 ? ` (${obj.counts.opportunities})` : ""}</TabsTrigger>
                <TabsTrigger value='experiments'>Experiments{obj.counts.experiments > 0 ? ` (${obj.counts.experiments})` : ""}</TabsTrigger>
                <TabsTrigger value='missions'>Missions{obj.counts.missions > 0 ? ` (${obj.counts.missions})` : ""}</TabsTrigger>
                <TabsTrigger value='results'>Results{obj.counts.results > 0 ? ` (${obj.counts.results})` : ""}</TabsTrigger>
                <TabsTrigger value='economics'>Economics</TabsTrigger>
                <TabsTrigger value='activity'>Activity</TabsTrigger>
              </TabsList>

              <TabsContent value='overview'>
                <OverviewTab obj={obj} />
              </TabsContent>
              <TabsContent value='strategy'>
                <StrategyTab obj={obj} />
              </TabsContent>
              <TabsContent value='opportunities'>
                <OpportunitiesTab objectiveId={obj.id} />
              </TabsContent>
              <TabsContent value='experiments'>
                <ExperimentsTab objectiveId={obj.id} />
              </TabsContent>
              <TabsContent value='missions'>
                <MissionsTab objectiveId={obj.id} />
              </TabsContent>
              <TabsContent value='results'>
                <ResultsTab objectiveId={obj.id} />
              </TabsContent>
              <TabsContent value='economics'>
                <EconomicsTab objectiveId={obj.id} />
              </TabsContent>
              <TabsContent value='activity'>
                <ActivityTab objectiveId={obj.id} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </Main>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardDescription className='text-xs'>{label}</CardDescription>
        <CardTitle className='text-xl tabular-nums'>{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent>
          <p className='-mx-6 text-xs text-muted-foreground'>{hint}</p>
        </CardContent>
      )}
    </Card>
  );
}

// ── Lifecycle strip: tahap produk dari status FSM + counts nyata (§4) ────────
type ObjDetail = NonNullable<Awaited<ReturnType<typeof getObjectiveDetail>>>;

function LifecycleStrip({ obj }: { obj: ObjDetail }) {
  const st = obj.status.toUpperCase();
  const c = obj.counts;
  // Urutan produk; indeks tahap saat ini ditentukan dari status FSM aktual.
  const stages: Array<{ key: string; label: string; reached: boolean; note?: string }> = [
    { key: "objective", label: "Objective", reached: true },
    { key: "research", label: "Riset", reached: st !== "DRAFT" && st !== "VALIDATING", note: undefined },
    { key: "opportunity", label: "Peluang", reached: c.opportunities > 0 || /RANK|SELECT|EXPERIMENT|MISSION|RESULT|SCALE|ITERAT|COMPLETE/.test(st), note: c.opportunities > 0 ? `${c.opportunities}` : undefined },
    { key: "experiment", label: "Eksperimen", reached: c.experiments > 0 || /MISSION|APPROVAL|RESULT_READY|DECIDING|SCALE|ITERAT|COMPLETE/.test(st), note: c.experiments > 0 ? `${c.experiments}` : undefined },
    { key: "decision", label: "Keputusan", reached: c.decisions > 0, note: c.decisions > 0 ? `${c.decisions}` : undefined },
    { key: "mission", label: "Misi", reached: c.missions > 0, note: c.missions > 0 ? `${c.missions}` : undefined },
    { key: "approval", label: "Persetujuan", reached: c.approvals_pending === 0 && /APPROVED|EXECUT|MEASURE|RESULT|SCALE|ITERAT|COMPLETE/.test(st), note: c.approvals_pending > 0 ? "menunggu Anda" : undefined },
    { key: "verification", label: "Verifikasi", reached: c.results > 0, note: c.results > 0 ? `${c.results} hasil` : undefined },
    { key: "impact", label: "Dampak ekonomi", reached: st.includes("COMPLETED"), note: undefined },
  ];
  return (
    <nav aria-label='Tahap siklus objective'>
      <ol className='flex flex-wrap items-center gap-x-1 gap-y-1 text-xs'>
        {stages.map((s, i) => (
          <li key={s.key} className='flex items-center gap-1'>
            {i > 0 && <span aria-hidden='true' className='text-border'>→</span>}
            <span
              className={
                s.reached
                  ? "rounded-md bg-primary/10 px-2 py-1 font-medium text-primary"
                  : "rounded-md border border-dashed px-2 py-1 text-muted-foreground"
              }
              aria-current={s.note === undefined && s.reached ? "step" : undefined}
            >
              {s.reached ? "✓ " : ""}{s.label}{s.note ? ` · ${s.note}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function OverviewTab({ obj }: { obj: ObjDetail }) {
  const dec = obj.decision;
  const snap = obj.snapshot;
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Ringkasan</CardTitle>
          <CardDescription>Konteks bisnis dan posisi ekonomi saat ini.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3 text-sm'>
          <Row label='Bisnis' value={obj.business?.name ?? "—"} />
          <Row label='Industri' value={obj.industry ?? "—"} />
          <Row label='Model bisnis' value={obj.business?.business_model ?? "—"} />
          <Row label='Fase' value={phaseLabel(obj.status)} />
          <Row label='Gross margin' value={snap?.gross_margin != null && snap.gross_margin !== "" ? fmtPctRatio(snap.gross_margin, 1) : "—"} />
          <Row label='Opex tercatat' value={fmtRp(snap?.opex ?? null)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Rekomendasi AUREX</CardTitle>
          <CardDescription>Keputusan siklus terakhir beserta alasannya.</CardDescription>
        </CardHeader>
        <CardContent>
          {dec?.recommendation ? (
            <div className='space-y-2'>
              <DecisionBadge decision={dec.recommendation} />
              {dec.confidence != null && (
                <p className='text-xs text-muted-foreground'>Keyakinan: {fmtPct(dec.confidence)}</p>
              )}
              {dec.rationale && <p className='text-sm'>{dec.rationale}</p>}
              <p className='text-xs text-muted-foreground'>
                Lihat tab Opportunities/Experiments untuk bukti di balik rekomendasi ini.
              </p>
            </div>
          ) : (
            <IntelligentEmpty
              stageTitle='Menunggu analisis'
              doing='AUREX menyusun rekomendasi setelah riset dan eksperimen menghasilkan bukti cukup.'
              next='Rekomendasi akan muncul dengan tingkat keyakinannya — tanpa angka sebelum ada dasar.'
            />
          )}
        </CardContent>
      </Card>

      {/* Verified value — dipisah tegas dari proyeksi (§5) */}
      <Card className='lg:col-span-2'>
        <CardHeader>
          <CardTitle className='text-base'>Nilai Ekonomi Objective Ini</CardTitle>
          <CardDescription>Status kebenaran setiap kategori nilai ditampilkan eksplisit.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='grid gap-4 text-sm sm:grid-cols-3'>
            <div>
              <p className='text-xs text-muted-foreground'>Terverifikasi ledger</p>
              <p className='flex items-center gap-2 font-medium tabular-nums'>
                {fmtRp(obj.verified?.revenue ?? null)} <ValueStateBadge state='VERIFIED' />
              </p>
            </div>
            <div>
              <p className='text-xs text-muted-foreground'>Proyeksi engine</p>
              <p className='flex items-center gap-2 font-medium tabular-nums'>
                {fmtRp(obj.economics?.revenue_target ?? null)} <ValueStateBadge state='PROJECTED' />
              </p>
            </div>
            <div>
              <p className='text-xs text-muted-foreground'>Hasil eksekusi diklaim</p>
              <p className='font-medium tabular-nums'>
                {fmtRp(obj.result?.actual_revenue ?? null)}{" "}
                <span className='text-xs font-normal text-muted-foreground'>(lihat tab Results untuk status verifikasinya)</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Forecast §15 — skenario PROJECTED, kalkulasi deterministik di backend */}
      <ForecastCard objectiveId={obj.id} />
    </div>
  );
}

// ── Forecast BEAR/BASE/BULL (§15): hanya tampil bila snapshot ada; 409 →
// penjelasan state-aware, bukan error mentah. Semua angka = PROJECTED.
function ForecastCard({ objectiveId }: { objectiveId: string }) {
  const [horizon, setHorizon] = useState(3);
  const { data: fc, error: fcError } = useAsync(
    () => getForecast(objectiveId, horizon),
    [objectiveId, horizon]
  );
  const notReady = fcError != null;
  return (
    <Card className='lg:col-span-2'>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div>
            <CardTitle className='text-base'>Forecast Skenario</CardTitle>
            <CardDescription>
              Proyeksi dari snapshot ekonomi terbaru — semua angka bersifat PROJECTED,
              bukan hasil terverifikasi. Model linear transparan: BEAR −30%, BASE ±0%,
              BULL +25% per bulan; probabilitas prior 30/45/25.
            </CardDescription>
          </div>
          <div className='flex items-center gap-1 text-xs'>
            {[3, 6, 12].map((h) => (
              <button
                key={h}
                type='button'
                onClick={() => setHorizon(h)}
                aria-pressed={horizon === h}
                className={`rounded-md border px-2 py-1 ${horizon === h ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {h} bln
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {notReady ? (
          <IntelligentEmpty
            stageTitle='Forecast belum tersedia'
            doing='Skenario dihitung dari snapshot ekonomi terbaru — objective ini belum memiliki snapshot.'
            next='Snapshot dibuat otomatis setiap perubahan ledger. Forecast muncul setelah siklus pertama bergerak.'
          />
        ) : !fc ? (
          <Skeleton className='h-24 w-full' />
        ) : (
          <div className='space-y-4'>
            <div className='grid gap-3 sm:grid-cols-3'>
              {fc.scenarios.map((s) => (
                <div key={s.name} className='rounded-md border p-3'>
                  <div className='flex items-center justify-between'>
                    <Badge variant={s.name === "BASE" ? "default" : "outline"}>
                      {s.name} · P {fmtPctRatio(s.probability, 0)}
                    </Badge>
                  </div>
                  <p className='mt-2 text-xs text-muted-foreground'>Profit / bulan</p>
                  <p className='font-medium tabular-nums'>{fmtRp(s.projectedMonthlyProfit)}</p>
                  <p className='mt-1 text-xs text-muted-foreground'>Total {fc.horizonMonths} bln</p>
                  <p className='text-sm font-medium tabular-nums'>{fmtRp(s.projectedTotalProfit)}</p>
                </div>
              ))}
            </div>
            <div className='flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 p-3 text-sm'>
              <span>EV tertimbang probabilitas ({fc.horizonMonths} bulan)</span>
              <span className='flex items-center gap-2 font-semibold tabular-nums'>
                {fmtRp(fc.probabilityWeightedEV)} <ValueStateBadge state='PROJECTED' />
              </span>
            </div>
            <p className='text-xs text-muted-foreground'>
              Payback modal:{' '}
              {fc.paybackMonths != null
                ? `≈ ${fc.paybackMonths} bulan (dari profit BASE)`
                : 'belum bisa dihitung — profit BASE ≤ 0'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='flex items-start justify-between gap-4'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='text-end font-medium'>{value}</span>
    </div>
  );
}

function StrategyTab({ obj }: { obj: ObjDetail }) {
  const s = obj.strategy;
  if (!s)
    return (
      <IntelligentEmpty
        stageTitle='Strategi belum tersedia'
        doing='AUREX menyusun positioning, diferensiasi, dan go-to-market setelah bisnis dipilih pada fase riset.'
        next='Strategi akan muncul di sini begitu tahap riset selesai.'
      />
    );
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader><CardTitle className='text-base'>Positioning</CardTitle></CardHeader>
        <CardContent><p className='text-sm'>{s.positioning ?? "—"}</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className='text-base'>Diferensiasi</CardTitle></CardHeader>
        <CardContent><p className='text-sm'>{s.differentiation ?? "—"}</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className='text-base'>Go-to-market</CardTitle></CardHeader>
        <CardContent><p className='text-sm'>{s.go_to_market ?? "—"}</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className='text-base'>Keunggulan kompetitif</CardTitle></CardHeader>
        <CardContent><p className='text-sm'>{s.competitive_edge ?? "—"}</p></CardContent>
      </Card>
    </div>
  );
}

function OpportunitiesTab({ objectiveId }: { objectiveId: string }) {
  const { data: opps, loading, error, reload } = useAsync(() => listOpportunities(objectiveId), [objectiveId]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!opps || opps.length === 0)
    return (
      <IntelligentEmpty
        stageTitle='Belum ada peluang terdaftar'
        doing='AUREX menemukan dan menyusun peringkat peluang setelah riset pasar selesai.'
        next='Portofolio berperingkat akan muncul di sini.'
      />
    );
  return (
    <div className='space-y-3'>
      {opps.map((o: OppSummary, i: number) => (
        <Card key={o.id}>
          <CardHeader>
            <div className='flex items-start justify-between gap-2'>
              <div className='flex items-center gap-2'>
                <Badge variant='secondary'>#{i + 1}</Badge>
                <CardTitle className='text-base'>{o.name}</CardTitle>
              </div>
              <StatusBadge stage={o.status} />
            </div>
          </CardHeader>
          <CardContent>
            <div className='grid gap-3 text-sm sm:grid-cols-4'>
              <div><p className='text-xs text-muted-foreground'>Modal</p><p className='font-medium tabular-nums'>{fmtRp(o.capital_required ?? null)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Potensi</p><p className='font-medium tabular-nums'>{fmtRp(o.revenue_potential ?? null)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Expected value</p><p className='font-medium tabular-nums'>{fmtRp(o.expected_value ?? null)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Skor engine</p><p className='font-medium tabular-nums'>{o.risk_adjusted_score != null ? Number(o.risk_adjusted_score).toFixed(0) : "—"}</p></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ExperimentsTab({ objectiveId }: { objectiveId: string }) {
  const { data, loading, error, reload } = useAsync(() => listExperiments(objectiveId), [objectiveId]);
  const items: ExperimentRow[] = data?.experiments ?? [];
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (items.length === 0)
    return (
      <IntelligentEmpty
        stageTitle='Belum ada eksperimen'
        doing='Eksperimen dibuat setelah peluang dipilih — merancang uji termurah penurun ketidakpastian.'
        next='Desain eksperimen akan muncul di sini.'
      />
    );
  return (
    <div className='space-y-3'>
      {items.map((x) => (
        <Card key={x.id}>
          <CardHeader>
            <div className='flex items-start justify-between gap-2'>
              <CardTitle className='text-base'>{x.hypothesis || "Eksperimen"}</CardTitle>
              <StatusBadge stage={x.status} />
            </div>
          </CardHeader>
          <CardContent>
            <div className='grid gap-3 text-sm sm:grid-cols-4'>
              <div><p className='text-xs text-muted-foreground'>Budget</p><p className='font-medium tabular-nums'>{fmtRp(x.budget)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Ambang sukses</p><p className='font-medium'>{x.success_threshold ?? "—"}</p></div>
              <div>
                <p className='text-xs text-muted-foreground'>Nilai terukur</p>
                <p className='font-medium tabular-nums'>{fmtRp(x.measured_value)}</p>
              </div>
              <div>
                <p className='text-xs text-muted-foreground'>Status kebenaran</p>
                <p className='pt-0.5'>
                  <ValueStateBadge state={tierToValueState(x.measured_value != null ? "SELF_REPORTED" : null)} />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MissionsTab({ objectiveId }: { objectiveId: string }) {
  const { data, loading, error, reload } = useAsync(() => listMissions(objectiveId), [objectiveId]);
  const items: MissionRow[] = data?.missions ?? [];
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (items.length === 0)
    return (
      <IntelligentEmpty
        stageTitle='Belum ada misi'
        doing='Misi disusun otomatis setelah eksperimen memvalidasi peluang.'
        next='Misi berisiko modal menunggu persetujuan Anda di halaman Approvals.'
      />
    );
  return (
    <div className='space-y-3'>
      {items.map((m) => {
        const pkgWhy = typeof m.package?.why === "string" ? m.package.why : null;
        return (
          <Card key={m.id}>
            <CardHeader>
              <div className='flex items-start justify-between gap-2'>
                <CardTitle className='text-base'>{pkgWhy?.slice(0, 80) ?? "Misi eksekusi"}</CardTitle>
                <StatusBadge stage={m.status} />
              </div>
            </CardHeader>
            <CardContent>
              <div className='grid gap-3 text-sm sm:grid-cols-4'>
                <div><p className='text-xs text-muted-foreground'>Prioritas</p><p className='font-medium'>{m.priority ?? "—"}</p></div>
                <div><p className='text-xs text-muted-foreground'>Peluang</p><p className='font-medium'>{m.opportunity_name ?? "—"}</p></div>
                <div><p className='text-xs text-muted-foreground'>Eksekusi masuk</p><p className='font-medium tabular-nums'>{m.execution_count}</p></div>
                <div><p className='text-xs text-muted-foreground'>Versi</p><p className='font-medium'>{m.version != null ? `v${m.version}` : "—"}</p></div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ResultsTab({ objectiveId }: { objectiveId: string }) {
  const { data, loading, error, reload } = useAsync(() => listResults(objectiveId), [objectiveId]);
  const items: ResultRow[] = data?.results ?? [];
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (items.length === 0)
    return (
      <IntelligentEmpty
        stageTitle='Belum ada hasil'
        doing='Hasil muncul setelah misi dieksekusi provider dan laporannya diterima result processor.'
        next='Setiap hasil akan menyertakan status verifikasi dan buktinya.'
      />
    );
  return (
    <div className='space-y-3'>
      {items.map((r) => {
        const netClaimed =
          r.revenue_claimed != null && r.cost_claimed != null
            ? Number(r.revenue_claimed) - Number(r.cost_claimed)
            : null;
        return (
          <Card key={r.id}>
            <CardHeader>
              <div className='flex flex-wrap items-start justify-between gap-2'>
                <CardTitle className='text-base'>{r.opportunity_name || "Hasil eksekusi"}</CardTitle>
                <div className='flex items-center gap-2'>
                  <EvidenceBadge tier={r.verification_tier} />
                  <ValueStateBadge state={tierToValueState(r.verification_tier)} />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className='grid gap-3 text-sm sm:grid-cols-4'>
                <div><p className='text-xs text-muted-foreground'>Revenue (klaim)</p><p className='font-medium tabular-nums'>{fmtRp(r.revenue_claimed)}</p></div>
                <div><p className='text-xs text-muted-foreground'>Cost (klaim)</p><p className='font-medium tabular-nums'>{fmtRp(r.cost_claimed)}</p></div>
                <div><p className='text-xs text-muted-foreground'>Net (klaim)</p><p className='font-medium tabular-nums'>{netClaimed != null ? fmtRp(netClaimed) : "—"}</p></div>
                <div>
                  <p className='text-xs text-muted-foreground'>Waktu selesai</p>
                  <p className='font-medium'>{r.finished_at ? new Date(r.finished_at).toLocaleDateString("id-ID") : "—"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function EconomicsTab({ objectiveId }: { objectiveId: string }) {
  const { data: econ, loading, error, reload } = useAsync(() => getEconomics(objectiveId), [objectiveId]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!econ || econ.snapshots.length === 0)
    return (
      <IntelligentEmpty
        stageTitle='Belum ada snapshot ekonomi'
        doing='Snapshot dibuat otomatis oleh engine setiap kali ledger berubah.'
        next='P&L lengkap akan muncul setelah rekonsiliasi pertama.'
      />
    );
  const cur = econ.current;
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader><CardTitle className='text-base'>Posisi Terkini (ledger)</CardTitle></CardHeader>
        <CardContent className='space-y-3 text-sm'>
          <Row label='Revenue' value={fmtRp(cur?.revenue ?? null)} />
          <Row label='COGS' value={fmtRp(cur?.cogs ?? null)} />
          <Row label='Gross profit' value={fmtRp(cur?.gross_profit ?? null)} />
          <Row label='Opex' value={fmtRp(cur?.opex ?? null)} />
          <Row label='Operating profit' value={fmtRp(cur?.operating_profit ?? null)} />
          <Row label='ROI' value={cur?.roi != null && cur.roi !== "" ? fmtRoi(Number(cur.roi)) : "—"} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className='text-base'>Target & Terverifikasi</CardTitle></CardHeader>
        <CardContent className='space-y-3 text-sm'>
          <Row label='Target profit' value={fmtRp(econ.target?.target_profit ?? null)} />
          <Row label='Capital approved' value={fmtRp(econ.target?.capital_approved ?? null)} />
          <Row label='Capital deployed' value={fmtRp(cur?.capital_deployed ?? null)} />
          <Row label='Verified revenue' value={<span className='flex items-center gap-2'>{fmtRp(econ.verified.revenue)} <ValueStateBadge state='VERIFIED' /></span>} />
          <Row label='Snapshot tercatat' value={`${econ.snapshots.length}`} />
        </CardContent>
      </Card>
    </div>
  );
}

function ActivityTab({ objectiveId }: { objectiveId: string }) {
  const { data: events, loading, error, reload } = useAsync(() => listEvents(objectiveId), [objectiveId]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!events || events.length === 0)
    return <EmptyState title='Belum ada aktivitas' description='Aktivitas muncul saat siklus berjalan.' />;
  return (
    <Card>
      <CardContent className='pt-6'>
        <ol className='relative space-y-6 border-s border-border ps-6'>
          {events.map((ev: AeeEvent, i: number) => (
            <li key={ev.id ?? i} className='relative'>
              <span className='absolute -start-[31px] grid size-5 place-items-center rounded-full border bg-background'>
                <span className='size-2 rounded-full bg-primary' aria-hidden='true' />
              </span>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <p className='text-sm font-medium'>{eventProductLabel(ev.event_type, ev.payload ?? undefined)}</p>
                <time className='text-xs text-muted-foreground' dateTime={ev.created_at}>
                  {new Date(ev.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
              </div>
              {ev.message && <p className='mt-1 text-sm text-muted-foreground'>{ev.message}</p>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
