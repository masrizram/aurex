import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { ProfileDropdown } from "@/components/profile-dropdown";
import { Search } from "@/components/search";
import { ThemeSwitch } from "@/components/theme-switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  EmptyState, ErrorState, LoadingState, StatusBadge, DecisionBadge, EvidenceBadge,
  fmtRp, fmtPct, phaseLabel,
} from "@/components/aurex-primitives";
import {
  listObjectives, getObjectiveDetail, listOpportunities, listExperiments, listMissions,
  listResults, listApprovals, listEvents, listDecisions, approveDecision, rejectDecision,
  selectOpportunity, letAurexDecide, rejectOpportunity, saveOpportunity,
  parseApiError, type OppSummary, type Approval, type ObjectiveListItem,
} from "@/api";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/lib/session";


// ═════════════════════════════════════════════════════════════════
// P10-P14 — Loop pages: Opportunities / Experiments / Missions /
// Approvals / Results / Economics / Activity.
// Semua halaman cross-objective: pilih objective → lihat entitas loop.
// ═════════════════════════════════════════════════════════════════

// ── Shared page chrome ────────────────────────────────────────────────────────
function LoopHeader() {
  const session = useSession();
  return (
    <Header>
      <div className='flex flex-row gap-2'>
        <Search />
        <div className='ml-auto flex items-center gap-2 space-x-1'>
          <ThemeSwitch />
          <ProfileDropdown session={session} />
        </div>
      </div>
    </Header>
  );
}

function ObjectivePicker({
  objectives, value, onChange,
}: {
  objectives: ObjectiveListItem[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger className='w-full sm:w-72' aria-label='Pilih objective'>
        <SelectValue placeholder='Pilih objective…' />
      </SelectTrigger>
      <SelectContent>
        {objectives.map((o) => (
          <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NoObjectiveState() {
  return (
    <EmptyState
      title='Belum ada objective'
      description='Pilih objective untuk melihat entitas ini. Objective dibuat lewat onboarding atau halaman Objectives.'
      action={<Button asChild><Link to='/app/objectives'>Ke Objectives</Link></Button>}
    />
  );
}

// ── Opportunities (§17) ───────────────────────────────────────────────────────
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
              Peluang yang ditemukan AUREX, diberi peringkat berdasarkan expected value.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {oLoading ? <LoadingState /> : !active ? <NoObjectiveState /> : (
          <>
            {active && (
              <div className='mb-4'>
                <Button variant='outline' size='sm' onClick={async () => {
                  try {
                    await letAurexDecide(active);
                    toast.success("AUREX akan memilih peluang terbaik.");
                    reload();
                  } catch (e) { toast.error(parseApiError(e)); }
                }}>
                  <Sparkles /> Let AUREX Decide
                </Button>
              </div>
            )}
            {loading ? <LoadingState rows={3} /> : error ? <ErrorState message={error} onRetry={reload} /> : (opps ?? []).length === 0 ? (
              <EmptyState
                title='Belum ada peluang'
                description='AUREX sedang meneliti dan mengidentifikasi peluang untuk objective ini.'
              />
            ) : (
              <div className='space-y-3'>
                {(opps ?? []).map((o, i) => (
                  <OpportunityCard key={o.id} opp={o} rank={i + 1} objectiveId={active!} onChanged={reload} />
                ))}
              </div>
            )}
          </>
        )}
      </Main>
    </>
  );
}

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
          <div className='flex items-center gap-2'>
            {opp.risk_adjusted_score != null && (
              <Badge variant='secondary'>Score {opp.risk_adjusted_score.toFixed(0)}</Badge>
            )}
            <Badge variant='outline'>{phaseLabel(opp.status)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className='grid gap-3 text-sm sm:grid-cols-3'>
          <div>
            <p className='text-xs text-muted-foreground'>Capital</p>
            <p className='font-medium tabular-nums'>{fmtRp(opp.capital_required ?? null)}</p>
          </div>
          <div>
            <p className='text-xs text-muted-foreground'>Expected Revenue</p>
            <p className='font-medium tabular-nums'>{fmtRp(opp.expected_revenue ?? null)}</p>
          </div>
          <div>
            <p className='text-xs text-muted-foreground'>Risk</p>
            <p className='font-medium tabular-nums'>{opp.risk_score != null ? fmtPct(opp.risk_score) : "—"}</p>
          </div>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant='outline' size='sm' className='mt-4'>Lihat detail</Button>
          </SheetTrigger>
          <SheetContent side='right' className='w-full overflow-y-auto sm:max-w-md'>
            <SheetHeader>
              <SheetTitle>{opp.name}</SheetTitle>
              <SheetDescription>{opp.customer_segment}</SheetDescription>
            </SheetHeader>
            <div className='space-y-4 px-4 pb-8'>
              <Section title='Problem'>{opp.problem}</Section>
              <Section title='Solution'>{opp.solution}</Section>
              <Section title='Business Model'>{opp.business_model}</Section>
              <Section title='Modal'>{fmtRp(opp.capital_required ?? null)}</Section>
              <Section title='Potensi Pendapatan'>{fmtRp(opp.expected_revenue ?? null)}</Section>
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

// ── Experiments (§18) ─────────────────────────────────────────────────────────
export function ExperimentsPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data, error, loading, reload } = useAsync(
    () => (active ? listExperiments(active) : Promise.resolve(null)),
    [active]
  );
  const experiments: any[] = data?.experiments ?? [];

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Experiments</h1>
            <p className='text-sm text-muted-foreground'>
              Uji hipotesis murah sebelum komitmen besar.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {!active ? <NoObjectiveState /> : loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : experiments.length === 0 ? (
          <EmptyState
            title='Belum ada eksperimen'
            description='Eksperimen dibuat setelah peluang dipilih dari analisis AUREX.'
          />
        ) : (
          <div className='space-y-3'>
            {experiments.map((x) => (
              <Card key={x.id}>
                <CardHeader>
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div>
                      <CardTitle className='text-base'>{x.hypothesis || x.name || "Eksperimen"}</CardTitle>
                      <CardDescription>{x.objective_title ?? ""}</CardDescription>
                    </div>
                    <StatusBadge stage={x.status ?? x.state ?? ""} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className='grid gap-3 text-sm sm:grid-cols-4'>
                    <Metric label='Budget' value={fmtRp(x.budget ?? x.capital_required ?? null)} />
                    <Metric label='Durasi' value={x.duration ?? x.duration_days ? `${x.duration_days ?? x.duration} hari` : "—"} />
                    <Metric label='Threshold' value={x.success_threshold ?? x.threshold ?? "—"} />
                    <Metric label='Hasil' value={x.measured_result ?? x.result ?? "—"} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Main>
    </>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='font-medium tabular-nums'>{value}</p>
    </div>
  );
}

// ── Missions (§19) ────────────────────────────────────────────────────────────
export function MissionsPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data, error, loading, reload } = useAsync(
    () => (active ? listMissions(active) : Promise.resolve(null)),
    [active]
  );
  const missions: any[] = data?.missions ?? [];

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Missions</h1>
            <p className='text-sm text-muted-foreground'>
              Rencana eksekusi otonom yang dijalankan AUREX.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {!active ? <NoObjectiveState /> : loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : missions.length === 0 ? (
          <EmptyState
            title='Belum ada misi'
            description='Misi dibuat setelah eksperimen memvalidasi peluang dan menunggu persetujuan Anda.'
          />
        ) : (
          <div className='space-y-3'>
            {missions.map((m) => (
              <Card key={m.id}>
                <CardHeader>
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div>
                      <CardTitle className='text-base'>{m.title || m.name || "Misi"}</CardTitle>
                      <CardDescription>{m.description || m.why || ""}</CardDescription>
                    </div>
                    <StatusBadge stage={m.status ?? m.state ?? ""} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className='grid gap-3 text-sm sm:grid-cols-4'>
                    <Metric label='Prioritas' value={m.priority ?? "—"} />
                    <Metric label='Estimasi Biaya' value={fmtRp(m.estimated_cost ?? m.cost ?? null)} />
                    <Metric label='Progress' value={m.progress != null ? `${m.progress}%` : "—"} />
                    <Metric label='Versi' value={m.version != null ? `v${m.version}` : "—"} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Main>
    </>
  );
}

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

// ── Results (§22) ─────────────────────────────────────────────────────────────
export function ResultsPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data, error, loading, reload } = useAsync(
    () => (active ? listResults(active) : Promise.resolve(null)),
    [active]
  );
  const results: any[] = data?.results ?? [];

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Results</h1>
            <p className='text-sm text-muted-foreground'>
              Hasil ekonomi terukur — proyeksi dan terverifikasi dibedakan jelas.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {!active ? <NoObjectiveState /> : loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : results.length === 0 ? (
          <EmptyState
            title='Belum ada hasil'
            description='Hasil muncul setelah misi dieksekusi dan diverifikasi.'
          />
        ) : (
          <div className='space-y-3'>
            {results.map((r) => (
              <Card key={r.id}>
                <CardHeader>
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <CardTitle className='text-base'>{r.title || r.name || "Hasil"}</CardTitle>
                    <EvidenceBadge tier={r.verification_tier ?? r.evidence ?? r.environment} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className='grid gap-3 text-sm sm:grid-cols-4'>
                    <Metric label='Revenue' value={fmtRp(r.actual_revenue ?? r.revenue ?? null)} />
                    <Metric label='Cost' value={fmtRp(r.actual_cost ?? r.cost ?? null)} />
                    <Metric label='Net Result' value={fmtRp(r.net_result ?? r.profit ?? null)} />
                    <Metric label='Customers' value={r.actual_customers ?? r.customers ?? "—"} />
                  </div>
                  {(r.projected_revenue != null || r.projected_profit != null) && (
                    <p className='mt-3 text-xs text-muted-foreground'>
                      Proyeksi: {fmtRp(r.projected_revenue)} revenue · {fmtRp(r.projected_profit)} profit — belum terverifikasi.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Main>
    </>
  );
}

// ── Economics (§23) ───────────────────────────────────────────────────────────
export function EconomicsPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data: detail, error, loading, reload } = useAsync(
    () => (active ? getObjectiveDetail(active) : Promise.resolve(null)),
    [active]
  );
  const { data: decisions } = useAsync(
    () => (active ? listDecisions(active) : Promise.resolve({ decisions: [] })),
    [active]
  );

  const econ = detail?.economics;
  const result = detail?.result;

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Economics</h1>
            <p className='text-sm text-muted-foreground'>
              Baseline vs target vs aktual — kebenaran ekonomi tanpa decorator.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {!active ? <NoObjectiveState /> : loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : (
          <>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <Metric label='Baseline Revenue' value={fmtRp(econ?.revenue_target ?? null)} />
              <Metric label='Current Revenue' value={fmtRp(result?.actual_revenue ?? null)} />
              <Metric label='Operating Profit' value={fmtRp(econ?.operating_profit ?? result?.actual_profit ?? null)} />
              <Metric label='ROI' value={econ?.roi != null ? `${econ.roi.toFixed(1)}×` : "—"} />
            </div>

            <Card className='mt-6'>
              <CardHeader>
                <CardTitle className='text-base'>Detail Ekonomi</CardTitle>
                <CardDescription>Snapshot ekonomi dari siklus aktif.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='grid gap-4 text-sm sm:grid-cols-3'>
                  <Metric label='Gross Margin' value={econ?.gross_margin != null ? fmtPct(econ.gross_margin) : "—"} />
                  <Metric label='Break-even Units' value={econ?.break_even_units ?? "—"} />
                  <Metric label='Environment' value={<EvidenceBadge tier={detail?.environment} />} />
                </div>
              </CardContent>
            </Card>

            {(decisions?.decisions ?? []).length > 0 && (
              <Card className='mt-6'>
                <CardHeader>
                  <CardTitle className='text-base'>Keputusan AUREX</CardTitle>
                  <CardDescription>Rekomendasi siklus terakhir.</CardDescription>
                </CardHeader>
                <CardContent className='space-y-3'>
                  {(decisions?.decisions ?? []).slice(0, 3).map((d: any) => (
                    <div key={d.id} className='rounded-md border p-3'>
                      <div className='flex items-center justify-between gap-2'>
                        <DecisionBadge decision={d.decision ?? d.recommendation} />
                        {d.confidence != null && (
                          <span className='text-xs text-muted-foreground'>Keyakinan {fmtPct(d.confidence)}</span>
                        )}
                      </div>
                      {(d.reason || d.rationale) && (
                        <p className='mt-2 text-sm text-muted-foreground'>{d.reason ?? d.rationale}</p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </Main>
    </>
  );
}

// ── Activity (§25) ────────────────────────────────────────────────────────────
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

export function ActivityPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data: events, error, loading, reload } = useAsync(
    () => (active ? listEvents(active) : Promise.resolve([])),
    [active]
  );

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Activity</h1>
            <p className='text-sm text-muted-foreground'>
              Aktivitas AUREX diterjemahkan ke bahasa produk.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {!active ? <NoObjectiveState /> : loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : (events ?? []).length === 0 ? (
          <EmptyState
            title='Belum ada aktivitas'
            description='Aktivitas muncul saat AUREX mulai menganalisis dan mengeksekusi.'
          />
        ) : (
          <Card>
            <CardContent className='pt-6'>
              <ol className='relative space-y-6 border-s border-border ps-6'>
                {(events ?? []).map((ev, i) => (
                  <li key={ev.id ?? i} className='relative'>
                    <span className='absolute -start-[31px] grid size-5 place-items-center rounded-full border bg-background'>
                      <span className='size-2 rounded-full bg-primary' aria-hidden='true' />
                    </span>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <p className='text-sm font-medium'>{eventLabel(ev.event_type)}</p>
                      <time className='text-xs text-muted-foreground' dateTime={ev.created_at}>
                        {new Date(ev.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                      </time>
                    </div>
                    {ev.message && <p className='mt-1 text-sm text-muted-foreground'>{ev.message}</p>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}
      </Main>
    </>
  );
}
