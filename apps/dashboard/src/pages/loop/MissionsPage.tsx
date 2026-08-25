// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { Main } from "@/components/layout/main";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState, StatusBadge, fmtRp } from "@/components/aurex-primitives";
import { listObjectives, listMissions } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";
import { Metric } from "./metric";

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

