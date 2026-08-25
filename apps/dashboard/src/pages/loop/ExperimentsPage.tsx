// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { Main } from "@/components/layout/main";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState, StatusBadge, fmtRp } from "@/components/aurex-primitives";
import { listObjectives, listExperiments } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";
import { Metric } from "./metric";

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

