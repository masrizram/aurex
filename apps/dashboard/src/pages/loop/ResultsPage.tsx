// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { Main } from "@/components/layout/main";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState, EvidenceBadge, fmtRp } from "@/components/aurex-primitives";
import { listObjectives, listResults } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";
import { Metric } from "./metric";

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

