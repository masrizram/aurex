// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useMemo, useState } from "react";
import { Main } from "@/components/layout/main";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  EmptyState, ErrorState, LoadingState,
  eventProductLabel, eventCategory, EVENT_CATEGORY_LABELS,
  type EventCategory,
} from "@/components/aurex-primitives";
import { listObjectives, listEvents } from "@/api";
import type { AeeEvent } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker } from "./loop-chrome";

// ── Activity — Economic Timeline (§16 master prompt) ─────────────────────────
// Timeline lintas-objective (GET /events tanpa objective_id = seluruh event
// organisasi), bahasa produk (bukan raw FSM §2), filter kategori, dan filter
// opsional per objective. Detail angka dari payload asli event.
const FILTERS: Array<{ key: EventCategory | "all"; label: string }> = [
  { key: "all", label: EVENT_CATEGORY_LABELS.all },
  { key: "intelligence", label: EVENT_CATEGORY_LABELS.intelligence },
  { key: "decision", label: EVENT_CATEGORY_LABELS.decision },
  { key: "experiment", label: EVENT_CATEGORY_LABELS.experiment },
  { key: "execution", label: EVENT_CATEGORY_LABELS.execution },
  { key: "approval", label: EVENT_CATEGORY_LABELS.approval },
  { key: "economic", label: EVENT_CATEGORY_LABELS.economic },
  { key: "system", label: EVENT_CATEGORY_LABELS.system },
];

export function ActivityPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  // Timeline GLOBAL by default (§16); picker mempersempit ke satu objective.
  const { data: events, error, loading, reload } = useAsync(
    () => listEvents(objId ?? undefined),
    [objId]
  );
  const [filter, setFilter] = useState<EventCategory | "all">("all");

  const filtered = useMemo(() => {
    const all = events ?? [];
    return filter === "all" ? all : all.filter((e) => eventCategory(e.event_type) === filter);
  }, [events, filter]);

  const countsByCat = useMemo(() => {
    const c = new Map<EventCategory, number>();
    for (const e of events ?? []) {
      const k = eventCategory(e.event_type);
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    return c;
  }, [events]);

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Activity</h1>
            <p className='text-sm text-muted-foreground'>
              Timeline ekonomi organisasi — setiap tahap siklus dalam bahasa produk.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                variant={objId == null ? "default" : "outline"}
                size='sm'
                onClick={() => setObjId(null)}
              >
                Semua objective
              </Button>
              <ObjectivePicker
                objectives={objectives}
                value={objId ?? objectives[0]?.id ?? null}
                onChange={(v) => setObjId(v)}
              />
            </div>
          )}
        </div>

        {/* Filter kategori */}
        <div className='mb-4 flex flex-wrap gap-2' role='group' aria-label='Filter kategori aktivitas'>
          {FILTERS.map((f) => {
            const n = f.key === "all" ? (events ?? []).length : countsByCat.get(f.key) ?? 0;
            return (
              <Button
                key={f.key}
                size='sm'
                variant={filter === f.key ? "default" : "outline"}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
              >
                {f.label} <Badge variant='secondary' className='ms-1'>{n}</Badge>
              </Button>
            );
          })}
        </div>

        {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={reload} /> : filtered.length === 0 ? (
          (events ?? []).length === 0 && !objId ? (
            <EmptyState
              title='Belum ada aktivitas'
              description='Timeline terisi saat AUREX mulai riset, menemukan peluang, dan mengeksekusi misi.'
            />
          ) : (
            <EmptyState
              title={`Tidak ada aktivitas kategori ${EVENT_CATEGORY_LABELS[filter]}`}
              description='Coba kategori lain atau hapus filter objective.'
            />
          )
        ) : (
          <Card>
            <CardContent className='pt-6'>
              <ol className='relative space-y-6 border-s border-border ps-6'>
                {filtered.slice(0, 100).map((ev, i) => (
                  <li key={ev.id ?? i} className='relative'>
                    <span className='absolute -start-[31px] grid size-5 place-items-center rounded-full border bg-background'>
                      <span className='size-2 rounded-full bg-primary' aria-hidden='true' />
                    </span>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <p className='text-sm font-medium'>
                        {eventProductLabel(ev.event_type, ev.payload ?? undefined)}
                        {!objId && ev.objective_title && (
                          <span className='text-muted-foreground'> · {ev.objective_title}</span>
                        )}
                      </p>
                      <time className='text-xs text-muted-foreground' dateTime={ev.created_at}>
                        {new Date(ev.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                      </time>
                    </div>
                    {ev.message && <p className='mt-1 text-sm text-muted-foreground'>{ev.message}</p>}
                    <EventDetailLine ev={ev} />
                  </li>
                ))}
              </ol>
              {(filtered.length > 100) && (
                <p className='mt-4 text-xs text-muted-foreground'>
                  Menampilkan 100 event terbaru dari {filtered.length}.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </Main>
    </>
  );
}

/** Angka penting dari payload event — hanya field yang benar-benar ada. */
function EventDetailLine({ ev }: { ev: AeeEvent }) {
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof p.expected_value === "number" || typeof p.expected_value === "string")
    if (p.expected_value !== "" && p.expected_value != null)
      bits.push(`EV Rp${Number(p.expected_value).toLocaleString("id-ID")}`);
  if (typeof p.count === "number") bits.push(`${p.count} item`);
  if (typeof p.opportunity_name === "string") bits.push(String(p.opportunity_name));
  if (typeof p.rationale === "string" && p.rationale.length <= 140) bits.push(String(p.rationale));
  if (bits.length === 0) return null;
  return (
    <p className='mt-1 text-xs text-muted-foreground'>{bits.join(" · ")}</p>
  );
}
