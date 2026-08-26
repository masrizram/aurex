import { useState } from "react";
import { Main } from "@/components/layout/main";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ErrorState, LoadingState, IntelligentEmpty,
  StatusBadge, ValueStateBadge, tierToValueState, fmtRp, fmtPctRatio,
} from "@/components/aurex-primitives";
import { listObjectives, listExperiments } from "@/api";
import type { ExperimentRow } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";
import { Metric } from "./metric";

// ── Experiments — Economic Experiment Lab (§7 master prompt) ─────────────────
// Eksperimen = pembelian informasi untuk menurunkan ketidakpastian sebelum
// modal besar. Angka hasil adalah klaim eksekusi dengan tier verifikasinya
// sendiri (§5) — tidak pernah dicampur nilai ledger terverifikasi.
export function ExperimentsPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data, error, loading, reload } = useAsync(
    () => (active ? listExperiments(active) : Promise.resolve(null)),
    [active]
  );
  const experiments: ExperimentRow[] = data?.experiments ?? [];

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Experiments</h1>
            <p className='text-sm text-muted-foreground'>
              Uji hipotesis murah sebelum komitmen modal besar.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {!active ? <NoObjectiveState /> : loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : experiments.length === 0 ? (
          <IntelligentEmpty
            stageTitle='Belum ada eksperimen'
            doing='Eksperimen dibuat setelah peluang dipilih — AUREX merancang uji termurah yang bisa menurunkan ketidakpastian hipotesis.'
            next='Rancangan eksperimen (hipotesis, metrik sukses/gagal, budget) akan muncul di sini.'
          />
        ) : (
          <div className='space-y-3'>
            {experiments.map((x) => <ExperimentCard key={x.id} exp={x} />)}
          </div>
        )}
      </Main>
    </>
  );
}

function ExperimentCard({ exp }: { exp: ExperimentRow }) {
  const hasResult = exp.measured_value != null || exp.result != null;
  const vs = tierToValueState(hasResult ? "SELF_REPORTED" : null); // hasil eksperimen = klaim terukur
  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div className='space-y-1'>
            <CardTitle className='text-base'>{exp.hypothesis || "Eksperimen"}</CardTitle>
            <CardDescription>
              {exp.opportunity_name ? `Peluang: ${exp.opportunity_name}` : "Dari peluang terpilih"}
              {exp.objective ? ` · ${exp.objective}` : ""}
              {" · "}
              {new Date(exp.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
            </CardDescription>
          </div>
          <StatusBadge stage={exp.status} />
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {/* Desain eksperimen */}
        <div className='grid gap-3 text-sm sm:grid-cols-4'>
          <Metric
            label='Budget'
            value={
              <>
                {fmtRp(exp.budget)}
                {exp.spent != null && exp.spent !== "" && Number(exp.spent) > 0 && (
                  <span className='ms-2 text-xs font-normal text-muted-foreground'>
                    terpakai {fmtRp(exp.spent)}
                  </span>
                )}
              </>
            }
          />
          <Metric label='Durasi' value={exp.duration_days != null ? `${exp.duration_days} hari` : "—"} />
          <Metric label='Metrik sukses' value={exp.success_metric ?? "—"} />
          <Metric label='Ambang sukses' value={exp.success_threshold ?? "—"} />
        </div>

        {/* Kriteria keputusan — apa yang membuat eksperimen SCALE/ITERATE/STOP */}
        <div className='rounded-md border border-dashed p-3 text-sm'>
          <p className='font-medium'>Hipotesis</p>
          <p className='text-muted-foreground'>{exp.hypothesis ?? "—"}</p>
          {(exp.failure_threshold || exp.kill_criteria != null) && (
            <>
              <p className='mt-2 font-medium'>Kriteria gagal / kill</p>
              <p className='text-muted-foreground'>
                {exp.failure_threshold ?? "—"}
                {exp.kill_criteria != null && (
                  <span className='block font-mono text-xs'>{String(JSON.stringify(exp.kill_criteria))}</span>
                )}
              </p>
            </>
          )}
          {exp.information_gain_target != null && (
            <p className='mt-2 text-xs text-muted-foreground'>
              Target pengurangan ketidakpastian: {fmtPctRatio(exp.information_gain_target, 0)} dari baseline keyakinan.
            </p>
          )}
        </div>

        {/* Hasil terukur + status kebenarannya */}
        {hasResult ? (
          <div className='grid gap-3 text-sm sm:grid-cols-2'>
            <div>
              <p className='font-medium'>Nilai terukur</p>
              <p className='flex items-center gap-2 tabular-nums'>
                {fmtRp(exp.measured_value)} <ValueStateBadge state={vs} />
              </p>
            </div>
            {exp.result != null && (
              <div>
                <p className='font-medium'>Detail hasil</p>
                <pre className='overflow-x-auto rounded bg-muted p-2 font-mono text-xs text-muted-foreground'>
                  {JSON.stringify(exp.result, null, 1).slice(0, 400)}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <IntelligentEmpty
            stageTitle='Menunggu hasil'
            doing='Eksekusi berjalan atau antre — hasil akan muncul setelah result processor menerima laporan provider.'
            next='Hasil akan menyertai badge verifikasi; ambang sukses di atas menentukan keputusan lanjutan.'
          />
        )}
      </CardContent>
    </Card>
  );
}
