import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, ArrowUpRight, Banknote, Bell, ClipboardCheck, PiggyBank,
  ShieldAlert, TrendingUp, Wallet,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { ProfileDropdown } from "@/components/profile-dropdown";
import { Search } from "@/components/search";
import { ThemeSwitch } from "@/components/theme-switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  StatCard, ValueStateBadge, fmtRp, fmtPctRatio, fmtRoi,
  EmptyState, ErrorState, eventProductLabel,
} from "@/components/aurex-primitives";
import { getOverview, parseApiError, type OverviewPayload } from "@/api";
import { useSession } from "@/lib/session";

// ═════════════════════════════════════════════════════════════════
// P6+ — Economic Control Center (§2 master prompt).
// SEMUA angka dari GET /overview: economic_snapshots turunan ledger
// dan capital_transactions RECONCILED — tanpa klaim LLM (Rule 4).
// Enam pertanyaan §3 dijawab lewat: Scoreboard (WHAT), Executive
// Brief (WHY/SO WHAT/NEXT), Attention Queue (RISK/ACTION), Activity
// feed (PROOF-of-flow). Nilai dipisah per value-state (§5).
// ═════════════════════════════════════════════════════════════════

export function OverviewPage() {
  const session = useSession();
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setData(await getOverview());
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Header>
        <div className='flex flex-row gap-2'>
          <Search />
          <div className='ml-auto flex items-center gap-2 space-x-1'>
            <ThemeSwitch />
            <Button variant='ghost' size='icon' className='rounded-full' aria-label='Notifikasi'>
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
          {data && data.scoreboard.objectives_total > 0 && (
            <Button asChild variant='outline'>
              <Link to='/app/objectives'>
                Semua objective <ArrowUpRight className='size-4' />
              </Link>
            </Button>
          )}
        </div>

        {loading ? (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            {Array.from({ length: 8 }).map((_, i) => (
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
        ) : !data || data.scoreboard.objectives_total === 0 ? (
          <EmptyState
            title='Belum ada objective'
            description='Buat objective ekonomi pertama Anda untuk mulai menemukan peluang.'
            action={<Button asChild><Link to='/onboarding'>Mulai Onboarding</Link></Button>}
          />
        ) : (
          <OverviewBody data={data} />
        )}
      </Main>
    </>
  );
}

function OverviewBody({ data }: { data: OverviewPayload }) {
  const sb = data.scoreboard;
  const hasEconomics = sb.revenue !== 0 || sb.cogs !== 0 || sb.operating_profit !== 0 || sb.capital_deployed !== 0;

  return (
    <div className='space-y-6'>
      {/* ── Economic Scoreboard (LEVEL 1) ── */}
      <section aria-label='Papan skor ekonomi'>
        {!hasEconomics ? (
          <Card>
            <CardContent className='flex flex-col items-start gap-2 p-6 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <p className='text-sm font-medium'>Belum ada fakta ekonomi dari ledger.</p>
                <p className='text-sm text-muted-foreground'>
                  Angka akan muncul setelah AUREX mengeksekusi misi pertama dan hasilnya terekonsiliasi.
                </p>
              </div>
              <ValueStateBadge state={null} />
            </CardContent>
          </Card>
        ) : (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            <StatCard
              label='Revenue (ledger)'
              value={fmtRp(sb.revenue)}
              hint='Akumulasi REVENUE di double-entry ledger'
              icon={Banknote}
            />
            <StatCard
              label='Gross Profit'
              value={fmtRp(sb.gross_profit)}
              hint={`Margin ${sb.gross_margin != null ? fmtPctRatio(sb.gross_margin, 1) : "—"} · COGS ${fmtRp(sb.cogs)}`}
              icon={TrendingUp}
            />
            <StatCard
              label='Operating Profit'
              value={fmtRp(sb.operating_profit)}
              hint='Setelah opex + biaya eksperimen + biaya AI'
              icon={Activity}
            />
            <StatCard
              label='ROI Portofolio'
              value={sb.portfolio_roi != null ? fmtRoi(sb.portfolio_roi) : "—"}
              hint={sb.portfolio_roi != null
                ? "Profit bersih ÷ modal objektif aktif"
                : "Menunggu modal objektif aktif"}
              icon={ArrowUpRight}
            />
            <Card>
              <CardHeader className='pb-2'>
                <CardDescription className='flex items-center justify-between'>
                  Verified Value
                  <Wallet className='size-4 text-muted-foreground' aria-hidden='true' />
                </CardDescription>
                <CardTitle className='text-2xl font-semibold tabular-nums'>
                  {fmtRp(sb.verified_revenue)}
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-1'>
                <ValueStateBadge state='VERIFIED' />
                <p className='text-xs text-muted-foreground'>
                  Hanya pembayaran terekonsiliasi — bukan klaim eksekusi.
                </p>
              </CardContent>
            </Card>
            <StatCard
              label='Capital Deployed'
              value={fmtRp(sb.capital_deployed)}
              hint={`Sisa ${fmtRp(sb.capital_remaining)} dari modal disetujui`}
              icon={PiggyBank}
            />
            <StatCard
              label='Objective Aktif'
              value={`${sb.objectives_active}`}
              hint={`Total ${sb.objectives_total} objective`}
              icon={ClipboardCheck}
            />
            <StatCard
              label='Eksperimen / Misi'
              value={`${data.counts.experiments_total} / ${data.counts.missions_total}`}
              hint={`${data.counts.decisions_total} keputusan tercatat`}
              icon={TrendingUp}
            />
          </div>
        )}
      </section>

      <div className='grid gap-4 lg:grid-cols-2'>
        {/* ── Trajectory (LEVEL 2) ── */}
        <TrajectoryCard points={data.trajectory} />

        {/* ── Executive Brief (WHY / SO WHAT / NEXT) ── */}
        <ExecutiveBrief data={data} />

        {/* ── Attention Queue ── */}
        <AttentionQueue data={data} />

        {/* ── Recent activity (bukti alur) ── */}
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Aktivitas Ekonomi Terbaru</CardTitle>
            <CardDescription>Event terakhir dari siklus otonom.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.events.length === 0 ? (
              <p className='text-sm text-muted-foreground'>Belum ada aktivitas.</p>
            ) : (
              <ul className='space-y-2'>
                {data.events.slice(0, 8).map((ev) => (
                  <li key={ev.id} className='flex items-center justify-between gap-2 text-sm'>
                    <span className='flex min-w-0 items-center gap-2'>
                      <Activity className='size-3.5 shrink-0 text-muted-foreground' aria-hidden='true' />
                      <span className='truncate'>{eventProductLabel(ev.event_type, ev.payload ?? undefined)}</span>
                      {ev.objective_title && (
                        <span className='hidden shrink-0 text-xs text-muted-foreground md:inline'>
                          · {ev.objective_title}
                        </span>
                      )}
                    </span>
                    <time className='shrink-0 text-xs text-muted-foreground' dateTime={ev.created_at}>
                      {new Date(ev.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant='ghost' size='sm' className='mt-3 w-full'>
              <Link to='/app/activity'>Lihat timeline lengkap</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Trajectory: agregat harian portfolio dari snapshot seri ──────────────────
function TrajectoryCard({ points }: { points: OverviewPayload["trajectory"] }) {
  const series = useMemo(() => dailyPortfolio(points), [points]);
  const metric = (key: "revenue" | "operating_profit" | "capital_deployed") =>
    series.map((d) => d[key]);
  const opSeries = metric("operating_profit");
  const revSeries = metric("revenue");

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Trajektori Ekonomi</CardTitle>
        <CardDescription>
          Snapshot turunan ledger, diagregasi per hari lintas objective.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {series.length < 2 ? (
          <p className='text-sm text-muted-foreground'>
            Belum cukup titik data untuk tren — grafik muncul setelah ≥2 snapshot pada hari berbeda.
          </p>
        ) : (
          <>
            <MiniLineChart
              label='Revenue'
              values={revSeries}
              formatValue={fmtRp}
              stroke='var(--primary)'
            />
            <MiniLineChart
              label='Operating profit'
              values={opSeries}
              formatValue={fmtRp}
              stroke='var(--chart-2, #10b981)'
            />
            <p className='text-xs text-muted-foreground'>
              {series[0]!.date} → {series[series.length - 1]!.date} · {series.length} titik harian
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function dailyPortfolio(points: OverviewPayload["trajectory"]) {
  const byDay = new Map<string, { revenue: number; operating_profit: number; capital_deployed: number }>();
  for (const p of points) {
    const day = (p.created_at || "").slice(0, 10);
    if (!day) continue;
    const cur = byDay.get(day) ?? { revenue: 0, operating_profit: 0, capital_deployed: 0 };
    cur.revenue += Number(p.revenue) || 0;
    cur.operating_profit += Number(p.operating_profit) || 0;
    cur.capital_deployed += Number(p.capital_deployed) || 0;
    byDay.set(day, cur);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));
}

/** Line chart SVG minimal tanpa dependensi — nilai akhir ditampilkan eksplisit. */
function MiniLineChart({
  label, values, formatValue, stroke,
}: {
  label: string
  values: number[]
  formatValue: (v: number | null) => string
  stroke: string
}) {
  const W = 320, H = 64, PAD = 4;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? (W - 2 * PAD) / (values.length - 1) : 0;
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const path = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(PAD + i * step).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1] ?? null;
  return (
    <div>
      <div className='mb-1 flex items-center justify-between text-xs'>
        <span className='text-muted-foreground'>{label}</span>
        <span className='font-medium tabular-nums'>{formatValue(last)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className='h-16 w-full'
        role='img'
        aria-label={`${label}: ${formatValue(last)} dari ${values.length} titik harian`}
      >
        <path d={path} fill='none' strokeWidth={2} stroke={stroke} strokeLinejoin='round' strokeLinecap='round' />
      </svg>
    </div>
  );
}

// ── Executive Brief: deterministik dari data nyata — bukan narasi LLM ────────
function ExecutiveBrief({ data }: { data: OverviewPayload }) {
  const sb = data.scoreboard;
  const att = data.attention;
  const lastEvent = data.events[0] ?? null;

  const risks: string[] = [];
  if (att.pending_approvals.length > 0)
    risks.push(`${att.pending_approvals.length} persetujuan menunggu keputusan Anda`);
  if (att.blocked_objectives.length > 0)
    risks.push(`${att.blocked_objectives.length} objective terblokir`);
  if (att.failed_executions.length > 0)
    risks.push(`${att.failed_executions.length} eksekusi gagal`);

  const nextAction =
    att.pending_approvals.length > 0 ? { label: "Tinjau persetujuan", to: "/app/approvals" }
    : att.failed_executions.length > 0 ? { label: "Periksa misi gagal", to: "/app/missions" }
    : att.blocked_objectives.length > 0 && att.blocked_objectives[0]
      ? { label: "Buka objective terblokir", to: `/app/objectives/${att.blocked_objectives[0].id}` }
    : sb.objectives_active > 0 ? { label: "Ikuti objective aktif", to: "/app/objectives" }
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Ringkasan Eksekutif</CardTitle>
        <CardDescription>
          Disusun deterministik dari data sistem — bukan teks model.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <div>
          <p className='font-medium'>Yang berubah</p>
          <p className='text-muted-foreground'>
            {lastEvent
              ? `${eventProductLabel(lastEvent.event_type, lastEvent.payload ?? undefined)}${lastEvent.objective_title ? ` — ${lastEvent.objective_title}` : ""}`
              : "Belum ada aktivitas tercatat."}
          </p>
        </div>
        <div>
          <p className='font-medium'>Mengapa penting</p>
          <p className='text-muted-foreground'>
            {hasAnyEconomy(sb)
              ? `Posisi ekonomi terkini: operating profit ${fmtRp(sb.operating_profit)} atas revenue ledger ${fmtRp(sb.revenue)}; modal terpakai ${fmtRp(sb.capital_deployed)}.`
              : "Fakta ekonomi belum terbentuk — nilai akan muncul setelah rekonsiliasi pertama."}
          </p>
        </div>
        <div>
          <p className='font-medium'>Risiko utama</p>
          {risks.length > 0 ? (
            <ul className='list-inside list-disc text-muted-foreground'>
              {risks.map((r) => <li key={r}>{r}</li>)}
            </ul>
          ) : (
            <p className='text-muted-foreground'>Tidak ada eksepsi terbuka.</p>
          )}
        </div>
        {nextAction && (
          <Button asChild size='sm' variant='outline' className='w-full'>
            <Link to={nextAction.to}>{nextAction.label} <ArrowUpRight className='size-4' /></Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function hasAnyEconomy(sb: OverviewPayload["scoreboard"]): boolean {
  return sb.revenue !== 0 || sb.cogs !== 0 || sb.operating_profit !== 0 || sb.capital_deployed !== 0;
}

// ── Attention Queue: hanya eksepsi actionable (§2) ───────────────────────────
function AttentionQueue({ data }: { data: OverviewPayload }) {
  const att = data.attention;
  const total = att.pending_approvals.length + att.blocked_objectives.length + att.failed_executions.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          Memerlukan Perhatian
          {total > 0 && (
            <Badge variant='destructive' aria-label={`${total} item`}>{total}</Badge>
          )}
        </CardTitle>
        <CardDescription>Hanya eksepsi yang butuh keputusan atau tindakan Anda.</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {total === 0 ? (
          <p className='text-sm text-muted-foreground'>
            Tidak ada yang menunggu. Semua berjalan.
          </p>
        ) : (
          <>
            {att.pending_approvals.slice(0, 3).map((a) => (
              <div key={a.id} className='flex items-center justify-between gap-2 rounded-md border p-3'>
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium'>
                    Persetujuan: {a.category.replaceAll("_", " ").toLowerCase()}
                    {a.objective_title ? ` — ${a.objective_title}` : ""}
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    Modal berisiko {fmtRp(a.capital_at_risk)}
                    {a.expires_at ? ` · kedaluwarsa ${new Date(a.expires_at).toLocaleDateString("id-ID")}` : ""}
                  </p>
                </div>
                <Button asChild size='sm'>
                  <Link to='/app/approvals'>Tinjau</Link>
                </Button>
              </div>
            ))}
            {att.blocked_objectives.slice(0, 2).map((o) => (
              <div key={o.id} className='flex items-center justify-between gap-2 rounded-md border p-3'>
                <div className='flex min-w-0 items-center gap-2'>
                  <ShieldAlert className='size-4 shrink-0 text-destructive' aria-hidden='true' />
                  <p className='truncate text-sm font-medium'>Objective terblokir: {o.title}</p>
                </div>
                <Button asChild size='sm' variant='outline'>
                  <Link to={`/app/objectives/${o.id}`}>Buka</Link>
                </Button>
              </div>
            ))}
            {att.failed_executions.slice(0, 2).map((e) => (
              <div key={e.id} className='flex items-center justify-between gap-2 rounded-md border p-3'>
                <div className='flex min-w-0 items-center gap-2'>
                  <ShieldAlert className='size-4 shrink-0 text-amber-600 dark:text-amber-400' aria-hidden='true' />
                  <p className='truncate text-sm font-medium'>
                    Eksekusi gagal{e.mission_title ? `: ${e.mission_title}` : ""}
                  </p>
                </div>
                <Button asChild size='sm' variant='outline'>
                  <Link to={`/app/objectives/${e.objective_id}`}>Detail</Link>
                </Button>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
