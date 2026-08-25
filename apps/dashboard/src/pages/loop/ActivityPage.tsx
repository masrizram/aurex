// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { Main } from "@/components/layout/main";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/aurex-primitives";
import { listObjectives, listEvents } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";

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
