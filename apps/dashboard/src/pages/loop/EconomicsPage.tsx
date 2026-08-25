// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { Main } from "@/components/layout/main";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState, DecisionBadge, EvidenceBadge, fmtRp, fmtPct } from "@/components/aurex-primitives";
import { listObjectives, getObjectiveDetail, listDecisions } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";
import { Metric } from "./metric";

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

