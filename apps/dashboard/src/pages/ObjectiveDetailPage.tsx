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
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState, ErrorState, LoadingState, StatusBadge, DecisionBadge, EvidenceBadge,
  fmtRp, fmtPct, phaseLabel,
} from "@/components/aurex-primitives";
import {
  getObjectiveDetail, listOpportunities, listExperiments, listMissions, listResults,
  listEvents, stopObjective, startObjective, parseApiError,
  type AeeEvent,
} from "@/api";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/lib/session";

// ═════════════════════════════════════════════════════════════════
// P15 — Objective Detail (§16): header + tabs. FSM diterjemahkan.
// ═════════════════════════════════════════════════════════════════

const EVENT_LABELS: [string, string][] = [
  ["RESEARCH", "AUREX meneliti pasar"],
  ["OPPORTUNIT", "AUREX mengidentifikasi peluang"],
  ["RANK", "Peluang diberi peringkat"],
  ["SELECT", "Peluang dipilih"],
  ["VENTURE", "Business venture dibuat"],
  ["EXPERIMENT", "Eksperimen dibuat"],
  ["MISSION", "Misi disiapkan"],
  ["APPROVAL", "Menunggu persetujuan Anda"],
  ["APPROVED", "Misi disetujui"],
  ["REJECTED", "Misi ditolak"],
  ["EXECUT", "Eksekusi berjalan"],
  ["RESULT", "Hasil tersedia"],
  ["LEDGER", "Transaksi ekonomi tercatat"],
  ["SNAPSHOT", "Snapshot ekonomi diperbarui"],
  ["DECISION", "AUREX memberi rekomendasi"],
  ["STATE", "Status diperbarui"],
];
function eventLabel(type: string): string {
  for (const [tok, label] of EVENT_LABELS) if (type.includes(tok)) return label;
  return type.replace(/_/g, " ").toLowerCase();
}

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
            {/* Header block */}
            <div className='mb-6 space-y-4'>
              <div className='flex flex-wrap items-start justify-between gap-4'>
                <div>
                  <h1 className='text-2xl font-semibold tracking-tight'>{obj.title}</h1>
                  <div className='mt-2 flex flex-wrap items-center gap-2'>
                    {obj.business && <Badge variant='outline'>{obj.business.name}</Badge>}
                    <StatusBadge stage={obj.status} />
                    <EvidenceBadge tier={obj.environment} />
                  </div>
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

              {/* KPI summary */}
              <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                <Kpi label='Baseline' value={fmtRp(obj.economics?.revenue_target ?? null)} />
                <Kpi label='Current' value={fmtRp(obj.result?.actual_revenue ?? null)} />
                <Kpi label='Operating Profit' value={fmtRp(obj.result?.actual_profit ?? obj.economics?.operating_profit ?? null)} />
                <Kpi label='Progress' value={fmtPct(obj.progress)} progress={obj.progress} />
              </div>
            </div>

            <Tabs defaultValue='overview'>
              <TabsList className='mb-4 flex-wrap'>
                <TabsTrigger value='overview'>Overview</TabsTrigger>
                <TabsTrigger value='strategy'>Strategy</TabsTrigger>
                <TabsTrigger value='opportunities'>Opportunities</TabsTrigger>
                <TabsTrigger value='experiments'>Experiments</TabsTrigger>
                <TabsTrigger value='missions'>Missions</TabsTrigger>
                <TabsTrigger value='results'>Results</TabsTrigger>
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

function Kpi({ label, value, progress }: { label: string; value: string; progress?: number }) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardDescription className='text-xs'>{label}</CardDescription>
        <CardTitle className='text-xl tabular-nums'>{value}</CardTitle>
        {progress != null && <Progress value={progress} className='mt-2' aria-label={label} />}
      </CardHeader>
    </Card>
  );
}

function OverviewTab({ obj }: { obj: NonNullable<Awaited<ReturnType<typeof getObjectiveDetail>>> }) {
  const dec = obj.decision;
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Ringkasan</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3 text-sm'>
          <Row label='Bisnis' value={obj.business?.name ?? "—"} />
          <Row label='Industri' value={obj.industry ?? "—"} />
          <Row label='Model bisnis' value={obj.business?.business_model ?? "—"} />
          <Row label='Fase' value={phaseLabel(obj.status)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Rekomendasi AUREX</CardTitle>
        </CardHeader>
        <CardContent>
          {dec?.recommendation ? (
            <div className='space-y-2'>
              <DecisionBadge decision={dec.recommendation} />
              {dec.confidence != null && <p className='text-xs text-muted-foreground'>Keyakinan: {fmtPct(dec.confidence)}</p>}
              {dec.rationale && <p className='text-sm'>{dec.rationale}</p>}
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>Analisis masih berjalan — rekomendasi menyusul.</p>
          )}
        </CardContent>
      </Card>
    </div>
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

function StrategyTab({ obj }: { obj: NonNullable<Awaited<ReturnType<typeof getObjectiveDetail>>> }) {
  const s = obj.strategy;
  if (!s) return <EmptyState title='Strategi belum tersedia' description='AUREX menyusun strategi setelah peluang terpilih.' />;
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
    return <EmptyState title='Belum ada peluang' description='AUREX sedang meneliti peluang untuk objective ini.' />;
  return (
    <div className='space-y-3'>
      {opps.map((o, i) => (
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
            <div className='grid gap-3 text-sm sm:grid-cols-3'>
              <div><p className='text-xs text-muted-foreground'>Modal</p><p className='font-medium tabular-nums'>{fmtRp(o.capital_required ?? null)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Potensi</p><p className='font-medium tabular-nums'>{fmtRp(o.expected_revenue ?? null)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Skor</p><p className='font-medium tabular-nums'>{o.risk_adjusted_score?.toFixed(0) ?? "—"}</p></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ExperimentsTab({ objectiveId }: { objectiveId: string }) {
  const { data, loading, error, reload } = useAsync(() => listExperiments(objectiveId), [objectiveId]);
  const items: any[] = data?.experiments ?? [];
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (items.length === 0) return <EmptyState title='Belum ada eksperimen' description='Eksperimen dibuat setelah peluang dipilih.' />;
  return (
    <div className='space-y-3'>
      {items.map((x) => (
        <Card key={x.id}>
          <CardHeader>
            <div className='flex items-start justify-between gap-2'>
              <CardTitle className='text-base'>{x.hypothesis || x.name || 'Eksperimen'}</CardTitle>
              <StatusBadge stage={x.status ?? x.state ?? ''} />
            </div>
          </CardHeader>
          <CardContent>
            <div className='grid gap-3 text-sm sm:grid-cols-4'>
              <div><p className='text-xs text-muted-foreground'>Budget</p><p className='font-medium tabular-nums'>{fmtRp(x.budget ?? null)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Threshold</p><p className='font-medium'>{x.success_threshold ?? x.threshold ?? '—'}</p></div>
              <div><p className='text-xs text-muted-foreground'>Hasil</p><p className='font-medium'>{x.measured_result ?? x.result ?? '—'}</p></div>
              <div><p className='text-xs text-muted-foreground'>Status</p><p className='font-medium'>{phaseLabel(x.status ?? x.state ?? '')}</p></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MissionsTab({ objectiveId }: { objectiveId: string }) {
  const { data, loading, error, reload } = useAsync(() => listMissions(objectiveId), [objectiveId]);
  const items: any[] = data?.missions ?? [];
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (items.length === 0) return <EmptyState title='Belum ada misi' description='Misi muncul setelah eksperimen tervalidasi.' />;
  return (
    <div className='space-y-3'>
      {items.map((m) => (
        <Card key={m.id}>
          <CardHeader>
            <div className='flex items-start justify-between gap-2'>
              <CardTitle className='text-base'>{m.title || m.name || 'Misi'}</CardTitle>
              <StatusBadge stage={m.status ?? m.state ?? ''} />
            </div>
          </CardHeader>
          <CardContent>
            <div className='grid gap-3 text-sm sm:grid-cols-4'>
              <div><p className='text-xs text-muted-foreground'>Prioritas</p><p className='font-medium'>{m.priority ?? '—'}</p></div>
              <div><p className='text-xs text-muted-foreground'>Estimasi biaya</p><p className='font-medium tabular-nums'>{fmtRp(m.estimated_cost ?? m.cost ?? null)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Progress</p><p className='font-medium tabular-nums'>{m.progress != null ? `${m.progress}%` : '—'}</p></div>
              <div><p className='text-xs text-muted-foreground'>Versi</p><p className='font-medium'>{m.version != null ? `v${m.version}` : '—'}</p></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ResultsTab({ objectiveId }: { objectiveId: string }) {
  const { data, loading, error, reload } = useAsync(() => listResults(objectiveId), [objectiveId]);
  const items: any[] = data?.results ?? [];
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (items.length === 0) return <EmptyState title='Belum ada hasil' description='Hasil muncul setelah misi dieksekusi.' />;
  return (
    <div className='space-y-3'>
      {items.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <div className='flex items-start justify-between gap-2'>
              <CardTitle className='text-base'>{r.title || r.name || 'Hasil'}</CardTitle>
              <EvidenceBadge tier={r.verification_tier ?? r.evidence ?? r.environment} />
            </div>
          </CardHeader>
          <CardContent>
            <div className='grid gap-3 text-sm sm:grid-cols-4'>
              <div><p className='text-xs text-muted-foreground'>Revenue</p><p className='font-medium tabular-nums'>{fmtRp(r.actual_revenue ?? r.revenue ?? null)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Cost</p><p className='font-medium tabular-nums'>{fmtRp(r.actual_cost ?? r.cost ?? null)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Net</p><p className='font-medium tabular-nums'>{fmtRp(r.net_result ?? r.profit ?? null)}</p></div>
              <div><p className='text-xs text-muted-foreground'>Customers</p><p className='font-medium tabular-nums'>{r.actual_customers ?? r.customers ?? '—'}</p></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EconomicsTab({ objectiveId }: { objectiveId: string }) {
  const { data: detail, loading, error, reload } = useAsync(() => getObjectiveDetail(objectiveId), [objectiveId]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const econ = detail?.economics;
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader><CardTitle className='text-base'>Snapshot</CardTitle></CardHeader>
        <CardContent className='space-y-3 text-sm'>
          <Row label='Target revenue' value={fmtRp(econ?.revenue_target ?? null)} />
          <Row label='Harga unit' value={fmtRp(econ?.unit_price ?? null)} />
          <Row label='Biaya unit' value={fmtRp(econ?.unit_cost ?? null)} />
          <Row label='Gross margin' value={econ?.gross_margin != null ? fmtPct(econ.gross_margin) : '—'} />
          <Row label='ROI' value={econ?.roi != null ? `${econ.roi.toFixed(1)}×` : '—'} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className='text-base'>Bukti</CardTitle></CardHeader>
        <CardContent className='space-y-3 text-sm'>
          <Row label='Environment' value={<EvidenceBadge tier={detail?.environment} />} />
          <Row label='Break-even units' value={econ?.break_even_units ?? '—'} />
        </CardContent>
      </Card>
    </div>
  );
}

function ActivityTab({ objectiveId }: { objectiveId: string }) {
  const { data: events, loading, error, reload } = useAsync(() => listEvents(objectiveId), [objectiveId]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!events || events.length === 0) return <EmptyState title='Belum ada aktivitas' description='Aktivitas muncul saat siklus berjalan.' />;
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
                <p className='text-sm font-medium'>{eventLabel(ev.event_type)}</p>
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
