// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { useState } from "react";
import { Link } from "react-router-dom";
import { Main } from "@/components/layout/main";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  ErrorState, LoadingState, IntelligentEmpty, DecisionBadge,
  fmtPctRatio,
} from "@/components/aurex-primitives";
import { listObjectives, listDecisions } from "@/api";
import type { DecisionRow } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { LoopHeader, ObjectivePicker, NoObjectiveState } from "./loop-chrome";

// ── Decisions — Decision Intelligence Ledger (§8 master prompt) ──────────────
// Setiap baris = catatan keputusan NYATA dari tabel decisions (bukan narasi):
// keputusan engine, alasan terstruktur, keyakinan, dan jumlah bukti.
// §29: rationale decision-grade tanpa chain-of-thought.
export function DecisionsPage() {
  const { data: objectives } = useAsync(listObjectives);
  const [objId, setObjId] = useState<string | null>(null);
  const active = objId ?? objectives?.[0]?.id ?? null;
  const { data: decData, error, loading, reload } = useAsync(
    () => (active ? listDecisions(active) : Promise.resolve({ decisions: [] as DecisionRow[] })),
    [active]
  );
  const decisions = decData?.decisions ?? [];

  return (
    <>
      <LoopHeader />
      <Main>
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Decisions</h1>
            <p className='text-sm text-muted-foreground'>
              Apa yang AUREX putuskan, mengapa, dan dasar buktinya.
            </p>
          </div>
          {objectives && objectives.length > 0 && (
            <div className='w-full max-w-xs'>
              <ObjectivePicker
                objectives={objectives}
                value={active ?? ""}
                onChange={(v) => setObjId(v || null)}
              />
            </div>
          )}
        </div>

        {!active ? (
          <NoObjectiveState />
        ) : loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : decisions.length === 0 ? (
          <IntelligentEmpty
            stageTitle='Belum ada keputusan tercatat'
            doing='AUREX mencatat keputusan setelah hasil eksperimen diinterpretasi (SCALE / ITERATE / PIVOT / KILL).'
            next='Ledger keputusan akan muncul begitu siklus pertama tiba di gerbang keputusan.'
          />
        ) : (
          <div className='space-y-3'>
            {decisions.map((d) => (
              <DecisionCard key={d.id} d={d} objectiveId={active} />
            ))}
          </div>
        )}
      </Main>
    </>
  );
}

function DecisionCard({ d, objectiveId }: { d: DecisionRow; objectiveId: string }) {
  const evidenceCount = Array.isArray(d.evidence_ids) ? d.evidence_ids.length : 0;
  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <DecisionBadge decision={d.decision} />
            <span className='text-xs text-muted-foreground'>
              oleh {d.decided_by ?? "engine"} ·{" "}
              {new Date(d.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
            </span>
          </div>
          {d.confidence != null && d.confidence !== "" && (
            <span className='text-xs text-muted-foreground' title='Keyakinan engine atas keputusan ini'>
              Keyakinan {fmtPctRatio(d.confidence, 0)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-2'>
        {d.reason ? (
          <p className='text-sm'>{d.reason}</p>
        ) : (
          <p className='text-sm text-muted-foreground'>Alasan tidak tercatat untuk keputusan ini.</p>
        )}
        <div className='flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
          <span>
            Bukti pendukung: {evidenceCount > 0 ? `${evidenceCount} item` : "belum ditautkan"}
          </span>
          <Link
            to={`/app/objectives/${objectiveId}`}
            className='underline underline-offset-4'
          >
            Telusuri siklusnya di objective →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
