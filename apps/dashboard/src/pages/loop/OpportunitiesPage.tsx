// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useMemo, useState } from "react";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Main } from "@/components/layout/main";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { EmptyState, ErrorState, LoadingState, fmtRp, fmtPct, phaseLabel } from "@/components/aurex-primitives";
import { listObjectives, listOpportunities, selectOpportunity, letAurexDecide, rejectOpportunity, saveOpportunity, parseApiError } from "@/api";
import type { OppSummary } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";

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

