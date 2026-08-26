// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { Main } from "@/components/layout/main";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ErrorState, LoadingState, IntelligentEmpty,
  StatusBadge, fmtRp,
} from "@/components/aurex-primitives";
import { listObjectives, listMissions } from "@/api";
import type { MissionRow } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";
import { Metric } from "./metric";

// ── Missions — Execution Control (§10 master prompt) ─────────────────────────
// Misi menjelaskan APA yang AUREX kerjakan: paket eksekusi ber-hash
// (integritas terverifikasi), status FSM diterjemahkan ke bahasa produk (§2),
// jumlah eksekusi, dan tautan kontekstual. Tidak ada aksi di luar operasi FSM.
export function MissionsPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data, error, loading, reload } = useAsync(
    () => (active ? listMissions(active) : Promise.resolve(null)),
    [active]
  );
  const missions: MissionRow[] = data?.missions ?? [];

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Missions</h1>
            <p className='text-sm text-muted-foreground'>
              Rencana eksekusi otonom yang dijalankan AUREX atas nama Anda.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <ObjectivePicker objectives={objectives} value={active} onChange={setObjId} />
          )}
        </div>
        {!active ? <NoObjectiveState /> : loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : missions.length === 0 ? (
          <IntelligentEmpty
            stageTitle='Belum ada misi'
            doing='Misi disusun otomatis setelah eksperimen memvalidasi peluang dan keputusan ekonomi dibuat.'
            next='Misi berisiko modal akan menunggu persetujuan Anda di halaman Approvals sebelum dieksekusi.'
          />
        ) : (
          <div className='space-y-3'>
            {missions.map((m) => <MissionCard key={m.id} m={m} />)}
          </div>
        )}
      </Main>
    </>
  );
}

function MissionCard({ m }: { m: MissionRow }) {
  const pkg = m.package ?? null;
  const why = typeof pkg?.why === "string" ? pkg.why : null;
  const what = typeof pkg?.what_will_happen === "string"
    ? pkg.what_will_happen
    : Array.isArray(pkg?.actions) && pkg.actions.length > 0
      ? `${pkg.actions.length} aksi dalam paket`
      : null;
  const estCost = typeof pkg?.estimated_cost === "string" ? pkg.estimated_cost : null;

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div className='space-y-1'>
            <CardTitle className='text-base'>
              {why ? why.slice(0, 80) : "Misi eksekusi"}
            </CardTitle>
            <CardDescription>
              {m.opportunity_name ? `Peluang: ${m.opportunity_name}` : "Dari peluang terpilih"}
              {" · "}
              {new Date(m.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
              {m.execution_count > 0 && ` · ${m.execution_count}× dieksekusi`}
            </CardDescription>
          </div>
          <StatusBadge stage={m.status} />
        </div>
      </CardHeader>
      <CardContent className='space-y-3'>
        {/* Apa & mengapa */}
        {(what || why) && (
          <div className='space-y-2 text-sm'>
            {what && (
              <div>
                <p className='font-medium'>Apa yang dieksekusi</p>
                <p className='text-muted-foreground'>{what}</p>
              </div>
            )}
            {why && (
              <div>
                <p className='font-medium'>Mengapa</p>
                <p className='text-muted-foreground'>{why}</p>
              </div>
            )}
          </div>
        )}

        {/* Angka eksekusi */}
        <div className='grid gap-3 text-sm sm:grid-cols-4'>
          <Metric label='Prioritas' value={m.priority ?? "—"} />
          <Metric label='Estimasi Biaya' value={fmtRp(estCost)} />
          <Metric label='Versi' value={m.version != null ? `v${m.version}` : "—"} />
          <Metric label='Eksekusi' value={`${m.execution_count}`} />
        </div>
        {m.package_hash && (
          <p className='text-xs text-muted-foreground'>
            Paket eksekusi ter-hash (<span className='font-mono'>{m.package_hash.slice(0, 12)}…</span>) —
            isi yang dieksekusi identik dengan yang disetujui.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
