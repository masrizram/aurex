import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowUpRight, Banknote, Bell, PiggyBank, TrendingUp, Wallet } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { ProfileDropdown } from "@/components/profile-dropdown";
import { Search } from "@/components/search";
import { ThemeSwitch } from "@/components/theme-switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  StatCard, StatusBadge, DecisionBadge,
  fmtRp, fmtPct, fmtRoi, EmptyState, ErrorState,
} from "@/components/aurex-primitives";
import { listObjectives, getObjectiveDetail, listApprovals, listEvents, parseApiError, type ObjectiveListItem, type ObjectiveDetail, type Approval } from "@/api";
import { useSession } from "@/lib/session";

// ═════════════════════════════════════════════════════════════════
// P6 — Economic Control Center (§12).
// Menjawab 6 pertanyaan customer: performa, goal, temuan, atensi,
// rekomendasi, value created. BUKAN engineering-state dashboard.
// ═════════════════════════════════════════════════════════════════

type OverviewData = {
  objectives: ObjectiveListItem[];
  active: ObjectiveDetail | null;
  pending: Approval[];
  recentEvents: { stage: string; label: string; at: string }[];
};

export function OverviewPage() {
  const session = useSession();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const objectives = await listObjectives();
      let active: ObjectiveDetail | null = null;
      let pending: Approval[] = [];
      let recentEvents: { stage: string; label: string; at: string }[] = [];
      if (objectives.length > 0) {
        const target = objectives.find((o) => !["STOPPED", "ACHIEVED"].includes(o.status)) ?? objectives[0];
        if (target) {
          const [detail, approvals, events] = await Promise.all([
            getObjectiveDetail(target.id),
            listApprovals(target.id),
            listEvents(target.id),
          ]);
          active = detail;
          pending = approvals.filter((a) => a.status === "PENDING");
          recentEvents = events.slice(0, 6).map((e) => ({
            stage: e.stage,
            label: eventLabel(e.event_type),
            at: e.created_at,
          }));
        }
      }
      setData({ objectives, active, pending, recentEvents });
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derive economics from active objective
  const econ = data?.active?.economics;
  const result = data?.active?.result;
  const dec = data?.active?.decision;
  const revenue = result?.actual_revenue ?? econ?.revenue_target;
  const opProfit = result?.actual_profit ?? econ?.operating_profit;
  const roi = result?.actual_profit != null && econ?.revenue_target
    ? (result.actual_profit / Math.max(1, econ.revenue_target)) * 100
    : econ?.roi;

  return (
    <>
      <Header>
        <div className='flex flex-row gap-2'>
          <Search />
          <div className='ml-auto flex items-center gap-2 space-x-1'>
            <ThemeSwitch />
            <Button variant='ghost' size='icon' className='rounded-full' aria-label='Notifications'>
              <Bell className='size-4' />
            </Button>
            <ProfileDropdown session={session} />
          </div>
        </div>
      </Header>
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Economic Control Center</h1>
            <p className='text-sm text-muted-foreground'>
              Kinerja bisnis dan eksekusi otonom — {session?.orgName ?? "organisasi Anda"}.
            </p>
          </div>
          {data && data.objectives.length > 0 && (
            <Button asChild variant='outline'>
              <Link to='/app/objectives'>
                Semua objective <ArrowUpRight className='size-4' />
              </Link>
            </Button>
          )}
        </div>

        {loading ? (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className='h-4 w-24' />
                  <Skeleton className='h-8 w-32' />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !data || data.objectives.length === 0 ? (
          <EmptyState
            title='Belum ada objective'
            description='Buat objective ekonomi pertama Anda untuk mulai menemukan peluang.'
            action={<Button asChild><Link to='/onboarding'>Mulai Onboarding</Link></Button>}
          />
        ) : (
          <>
            {/* KPI cards */}
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
              <StatCard label='Revenue' value={fmtRp(revenue)} hint={result?.actual_revenue != null ? "Terverifikasi periode ini" : "Baseline ekonomi"} icon={Banknote} />
              <StatCard label='Operating Profit' value={fmtRp(opProfit)} hint='Profit operasional' icon={TrendingUp} />
              <StatCard label='ROI' value={fmtRoi(roi)} hint='Return on investment' icon={ArrowUpRight} />
              <StatCard label='Verified Value' value={fmtRp(result?.actual_profit ?? 0)} hint='Value terverifikasi' icon={Wallet} />
              <StatCard label='Capital Deployed' value={fmtRp(0)} hint='Modal terpakai' icon={PiggyBank} />
            </div>

            <div className='mt-6 grid gap-4 lg:grid-cols-2'>
              {/* Economic performance / active objective */}
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Objective Aktif</CardTitle>
                  <CardDescription>
                    {data.active ? data.active.title : "—"}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-4'>
                  {data.active ? (
                    <>
                      <div className='flex items-center justify-between text-sm'>
                        <span className='text-muted-foreground'>Progress</span>
                        <span className='font-medium tabular-nums'>{fmtPct(data.active.progress)}</span>
                      </div>
                      <Progress value={data.active.progress} aria-label='Progress objective' />
                      <div className='flex flex-wrap items-center gap-2'>
                        <StatusBadge stage={data.active.status} />
                        {data.active.business && (
                          <Badge variant='outline'>{data.active.business.name}</Badge>
                        )}
                      </div>
                      <Button asChild variant='outline' size='sm' className='w-full'>
                        <Link to={`/app/objectives/${data.active.id}`}>Buka detail</Link>
                      </Button>
                    </>
                  ) : (
                    <p className='text-sm text-muted-foreground'>Tidak ada objective aktif.</p>
                  )}
                </CardContent>
              </Card>

              {/* Requires attention */}
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Memerlukan Perhatian</CardTitle>
                  <CardDescription>Persetujuan dan hal yang menunggu keputusan Anda.</CardDescription>
                </CardHeader>
                <CardContent className='space-y-3'>
                  {data.pending.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>
                      Tidak ada yang menunggu persetujuan. Semua berjalan.
                    </p>
                  ) : (
                    data.pending.slice(0, 3).map((a) => (
                      <div key={a.id} className='flex items-center justify-between gap-2 rounded-md border p-3'>
                        <div className='min-w-0'>
                          <p className='truncate text-sm font-medium'>{approvalTitle(a)}</p>
                          <p className='text-xs text-muted-foreground'>{approvalDesc(a)}</p>
                        </div>
                        <Button asChild size='sm'>
                          <Link to='/app/approvals'>Tinjau</Link>
                        </Button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* AUREX Recommendation */}
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Rekomendasi AUREX</CardTitle>
                  <CardDescription>Siklus terakhir dari analisis otonom.</CardDescription>
                </CardHeader>
                <CardContent>
                  {dec?.recommendation ? (
                    <div className='space-y-2'>
                      <DecisionBadge decision={dec.recommendation} />
                      {dec.confidence != null && (
                        <p className='text-xs text-muted-foreground'>
                          Keyakinan: {fmtPct(dec.confidence)}
                        </p>
                      )}
                      {dec.rationale && <p className='text-sm'>{dec.rationale}</p>}
                    </div>
                  ) : (
                    <p className='text-sm text-muted-foreground'>Analisis masih berjalan.</p>
                  )}
                </CardContent>
              </Card>

              {/* Recent activity */}
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Aktivitas Ekonomi Terbaru</CardTitle>
                  <CardDescription>Event terakhir dari siklus eksekusi.</CardDescription>
                </CardHeader>
                <CardContent>
                  {data.recentEvents.length === 0 ? (
                    <p className='text-sm text-muted-foreground'>Belum ada aktivitas.</p>
                  ) : (
                    <ul className='space-y-2'>
                      {data.recentEvents.map((ev, i) => (
                        <li key={i} className='flex items-center justify-between gap-2 text-sm'>
                          <span className='flex min-w-0 items-center gap-2'>
                            <Activity className='size-3.5 shrink-0 text-muted-foreground' aria-hidden='true' />
                            <span className='truncate'>{ev.label}</span>
                          </span>
                          <span className='shrink-0 text-xs text-muted-foreground'>
                            {new Date(ev.at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </Main>
    </>
  );
}

function approvalTitle(a: Approval): string {
  const t = (a.decision_type || "").replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function approvalDesc(a: Approval): string {
  return a.stage ? `Fase: ${a.stage}` : "Menunggu keputusan Anda";
}

// FSM event → customer language (§25)
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
  for (const [tok, label] of EVENT_LABELS) {
    if (type.includes(tok)) return label;
  }
  return type.replace(/_/g, " ").toLowerCase();
}
