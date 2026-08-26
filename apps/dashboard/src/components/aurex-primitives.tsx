// AUREX shared primitives — built on shadcn-admin component system.

import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// ── Financial formatting (§45) ────────────────────────────────────────────────
/** Rp 12.450.000 — Indonesian grouping, no decimals for display. */
export function fmtRp(v?: number | string | null): string {
  if (v == null || v === '' || isNaN(Number(v))) return '—'
  return 'Rp' + Math.round(Number(v)).toLocaleString('id-ID')
}

/** "12.450.000" (no currency) for compact table cells. */
export function fmtNum(v?: number | string | null): string {
  if (v == null || v === '' || isNaN(Number(v))) return '—'
  return Math.round(Number(v)).toLocaleString('id-ID')
}

/** 42% / 12.4% */
export function fmtPct(v?: number | null, digits = 0): string {
  if (v == null || isNaN(Number(v))) return '—'
  return `${Number(v).toFixed(digits)}%`
}

/** ROI as ratio "2.4×" or percent. */
export function fmtRoi(v?: number | null): string {
  if (v == null || isNaN(Number(v))) return '—'
  const n = Number(v)
  return `${n.toFixed(1)}×`
}

// ── FSM → customer language (§47, token pairs so raw states never leak whole) ─
const PHASE_ENTRIES: [string, string][] = [
  ['OBJECTIVE', 'Menyiapkan'],
  ['RESEARCH', 'Riset pasar'],
  ['RANK', 'Menyusun peringkat'],
  ['SELECT', 'Memilih peluang'],
  ['EXPERIMENT', 'Eksperimen dirancang'],
  ['RESULT', 'Hasil siap'],
  ['MISSION', 'Misi dibuat'],
  ['APPROVAL', 'Menunggu persetujuan'],
  ['EXECUT', 'Mengeksekusi'],
  ['ANALYZ', 'Menganalisis hasil'],
  ['DECISION', 'Keputusan siap'],
  ['ACHIEVED', 'Tercapai'],
  ['STOPPED', 'Dihentikan'],
  ['BLOCKED', 'Terblokir'],
]

export function phaseLabel(stage: string): string {
  if (!stage || stage === 'UNKNOWN') return 'Aktif'
  for (const [token, label] of PHASE_ENTRIES) {
    if (stage.includes(token)) return label
  }
  return 'Aktif'
}

export function phaseTone(stage: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' {
  const s = stage || ''
  if (s.includes('ACHIEVED')) return 'success'
  if (s.includes('BLOCKED') || s.includes('STOPPED')) return 'destructive'
  if (s.includes('APPROVAL')) return 'outline'
  if (s.includes('DECISION')) return 'secondary'
  return 'default'
}

/** Execution preference (§30): customer terms, not autonomy numbers. */
export function autonomyLabel(level: number | null | undefined): string {
  if (level == null) return '—'
  if (level <= 1) return 'Advisory'
  if (level === 2) return 'Approval Required'
  return 'Controlled Autonomy'
}

// ── Standard states (§40-42) ─────────────────────────────────────────────────
export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className='space-y-3' aria-busy='true' aria-live='polite'>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className='h-16 w-full' />
      ))}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role='alert'
      className='flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center'
    >
      <AlertCircle className='size-8 text-muted-foreground' aria-hidden='true' />
      <div className='space-y-1'>
        <p className='text-sm font-medium'>AUREX tidak dapat menyelesaikan permintaan ini.</p>
        <p className='text-sm text-muted-foreground'>{message}</p>
        <p className='text-xs text-muted-foreground'>Data Anda aman.</p>
      </div>
      {onRetry && (
        <Button variant='outline' size='sm' onClick={onRetry}>
          <RefreshCw /> Coba lagi
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className='flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center'>
      <div className='space-y-1'>
        <p className='text-sm font-medium'>{title}</p>
        <p className='mx-auto max-w-sm text-sm text-muted-foreground'>{description}</p>
      </div>
      {action}
    </div>
  )
}

// ── Badges ────────────────────────────────────────────────────────────────────
import { Badge } from '@/components/ui/badge'

export function StatusBadge({ stage }: { stage: string }) {
  return <Badge variant={phaseTone(stage)}>{phaseLabel(stage)}</Badge>
}

/** Evidence quality tiers (§22): visual separation is mandatory. */
const EVIDENCE_TIERS: Record<string, { label: string; cls: string }> = {
  SELF_REPORTED: { label: 'Self-reported', cls: 'bg-muted text-muted-foreground border-border' },
  EVIDENCED: { label: 'Evidenced', cls: 'bg-primary/10 text-primary border-primary/20' },
  RECONCILED: { label: 'Reconciled', cls: 'bg-primary/15 text-primary border-primary/30' },
  VERIFIED: { label: 'Verified', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
  SIMULATED: { label: 'Simulated', cls: 'bg-muted text-muted-foreground border-dashed border-border' },
  PROJECTED: { label: 'Projected', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  OBSERVED: { label: 'Observed', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30' },
}

export function EvidenceBadge({ tier }: { tier: string | null | undefined }) {
  const t = EVIDENCE_TIERS[(tier || '').toUpperCase()]
  if (!t) return <Badge variant='outline'>—</Badge>
  return (
    <Badge variant='outline' className={cn('border', t.cls)}>
      {t.label}
    </Badge>
  )
}

export function DecisionBadge({ decision }: { decision: string | null | undefined }) {
  const d = (decision || '').toUpperCase()
  const map: Record<string, { label: string; cls: string }> = {
    SCALE: { label: 'Scale', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' },
    ITERATE: { label: 'Iterate', cls: 'bg-primary/10 text-primary border-primary/20' },
    PIVOT: { label: 'Pivot', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' },
    KILL: { label: 'Kill', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
    WAIT: { label: 'Wait', cls: 'bg-muted text-muted-foreground border-border' },
    BLOCKED: { label: 'Blocked', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
    ESCALATE: { label: 'Escalate', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' },
  }
  const m = map[d]
  if (!m) return <Badge variant='outline'>{decision || '—'}</Badge>
  return <Badge variant='outline' className={cn('border', m.cls)}>{m.label}</Badge>
}

// ── StatCard (§12 Control Center KPI) ────────────────────────────────────────
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: string
  hint?: string
  icon?: React.ElementType
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardDescription className='flex items-center justify-between'>
          {label}
          {Icon && <Icon className='size-4 text-muted-foreground' aria-hidden='true' />}
        </CardDescription>
        <CardTitle className='text-2xl font-semibold tabular-nums'>{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent>
          <p className='text-xs text-muted-foreground'>{hint}</p>
        </CardContent>
      )}
    </Card>
  )
}

// ── Value states §5: PROJECTED / OBSERVED / ATTRIBUTED / VERIFIED ────────────
// Pemetaan dari verification_tier engine — BUKAN kategori baru (Rule 4).
export type ValueState = 'PROJECTED' | 'OBSERVED' | 'ATTRIBUTED' | 'VERIFIED'

export function tierToValueState(
  tier: string | null | undefined,
): ValueState | null {
  const t = (tier || '').toUpperCase()
  if (t === 'RECONCILED') return 'VERIFIED'
  if (t === 'EVIDENCED') return 'ATTRIBUTED'
  if (t === 'SELF_REPORTED') return 'OBSERVED'
  return null // tanpa hasil terukur = belum ada nilai OBSERVED pun
}

const VALUE_STATE_META: Record<ValueState, { label: string; cls: string; desc: string }> = {
  PROJECTED: {
    label: 'Projected',
    cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
    desc: 'Estimasi masa depan — bukan uang nyata.',
  },
  OBSERVED: {
    label: 'Observed',
    cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30',
    desc: 'Diukur dari laporan eksekusi, belum diverifikasi independen.',
  },
  ATTRIBUTED: {
    label: 'Attributed',
    cls: 'bg-primary/10 text-primary border-primary/20',
    desc: 'Didukung bukti eksekusi — atribusi ke aksi AUREX.',
  },
  VERIFIED: {
    label: 'Verified',
    cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    desc: 'Terekonsiliasi dengan pembayaran di ledger double-entry.',
  },
}

export function ValueStateBadge({
  state,
  tooltip = true,
}: {
  state: ValueState | null
  tooltip?: boolean
}) {
  if (!state) return <Badge variant='outline'>Belum terukur</Badge>
  const m = VALUE_STATE_META[state]
  const badge = (
    <Badge variant='outline' className={cn('border', m.cls)} title={tooltip ? m.desc : undefined}>
      {m.label}
    </Badge>
  )
  return badge
}

export function valueStateDesc(state: ValueState): string {
  return VALUE_STATE_META[state].desc
}

/** Rasio 0..1 → "42%" — untuk probabilitas/gross_margin yang tersimpan sebagai fraksi. */
export function fmtPctRatio(v?: number | string | null, digits = 0): string {
  if (v == null || v === '' || isNaN(Number(v))) return '—'
  return `${(Number(v) * 100).toFixed(digits)}%`
}

// ── Activity → bahasa produk (§16): peta event_type → kalimat + kategori ─────
const EVENT_LABELS: [RegExp, string][] = [
  [/OBJECTIVE_CREATED/, 'Objective dibuat'],
  [/OBJECTIVE_VALIDATED/, 'Objective tervalidasi'],
  [/RESEARCH_START/, 'Riset pasar dimulai'],
  [/RESEARCH_COMPLETE|BUSINESS_SELECTED/, 'Riset selesai — bisnis dipilih'],
  [/OPPORTUNITIES_DISCOVERED/, 'Peluang ditemukan'],
  [/OPPORTUNITIES_RANKED/, 'Peluang disusun peringkat'],
  [/OPPORTUNITY_SELECTED/, 'Peluang terpilih'],
  [/OPPORTUNITY_SAVED/, 'Peluang disimpan untuk nanti'],
  [/OPPORTUNITY_REJECTED/, 'Peluang ditolak'],
  [/EXPERIMENT_DESIGNED|EXPERIMENT_START/, 'Eksperimen dirancang'],
  [/RESULT_READY/, 'Hasil eksperimen siap'],
  [/MISSION_CREATED/, 'Misi disusun'],
  [/MISSION_APPROVED/, 'Misi disetujui'],
  [/HUMAN_APPROVAL_REQUIRED/, 'Menunggu persetujuan Anda'],
  [/APPROVAL/, 'Keputusan persetujuan'],
  [/DISPATCH|EXECUTION_START/, 'Eksekusi dimulai'],
  [/EXECUTION_COMPLETED/, 'Eksekusi selesai'],
  [/MEASURE/, 'Pengukuran berjalan'],
  [/RESULT_INTERPRETED|ANALYZ/, 'Hasil dianalisis'],
  [/DECISION/, 'Keputusan ekonomi dibuat'],
  [/SCAL/, 'Scaling dieksekusi'],
  [/ITERAT/, 'Iterasi berikutnya'],
  [/PIVOT/, 'Arah diperbarui (pivot)'],
  [/KILL/, 'Eksperimen dihentikan (kill)'],
  [/LEDGER|PAYMENT|RECONCIL/, 'Pembayaran terekonsiliasi ke ledger'],
  [/AGENT_ERROR|SYSTEM_ERROR/, 'Terjadi galat sistem'],
  [/RETRY_REQUESTED/, 'Ulangi tahap diminta'],
  [/ABORTED|STOPPED/, 'Objective dihentikan'],
  [/BLOCKED/, 'Terblokir — perlu tindakan'],
]

export function eventProductLabel(eventType: string, _payload?: Record<string, unknown> | null): string {
  for (const [re, label] of EVENT_LABELS) {
    if (re.test(eventType)) return label
  }
  return eventType.replaceAll('_', ' ').toLowerCase()
}

export type EventCategory =
  | 'intelligence' | 'decision' | 'experiment' | 'execution'
  | 'approval' | 'economic' | 'system'

export function eventCategory(eventType: string): EventCategory {
  const t = eventType.toUpperCase()
  if (/RESEARCH|OPPORTUNIT|BUSINESS_SELECTED|RANK/.test(t)) return 'intelligence'
  if (/DECISION/.test(t)) return 'decision'
  if (/EXPERIMENT|VALIDAT(ING|ED)\b/.test(t)) return 'experiment'
  if (/EXECUT|DISPATCH|MEASURE|MISSION/.test(t)) return 'execution'
  if (/APPROVAL|HUMAN_/.test(t)) return 'approval'
  if (/LEDGER|PAYMENT|RECONCIL|SNAPSHOT/.test(t)) return 'economic'
  return 'system'
}

export const EVENT_CATEGORY_LABELS: Record<EventCategory | 'all', string> = {
  all: 'Semua',
  intelligence: 'Intelijen',
  decision: 'Keputusan',
  experiment: 'Eksperimen',
  execution: 'Eksekusi',
  approval: 'Persetujuan',
  economic: 'Ekonomi',
  system: 'Sistem',
}

// ── Intelligent empty state (§25): jelaskan lifecycle, bukan "kosong" ────────
export function IntelligentEmpty({
  stageTitle,
  doing,
  done = [],
  waiting,
  next,
  needsUser,
  action,
}: {
  stageTitle: string
  doing?: string
  done?: string[]
  waiting?: string
  next?: string
  needsUser?: boolean
  action?: React.ReactNode
}) {
  return (
    <div
      role='status'
      className='flex flex-col gap-3 rounded-lg border border-dashed p-6 text-left'
    >
      <div className='space-y-1'>
        <p className='text-sm font-medium'>{stageTitle}</p>
        {doing && <p className='text-sm text-muted-foreground'>{doing}</p>}
      </div>
      {(done.length > 0 || waiting || next) && (
        <ul className='space-y-1 text-sm text-muted-foreground'>
          {done.map((d) => (
            <li key={d} className='flex items-start gap-2'>
              <span aria-hidden='true' className='mt-0.5 text-emerald-600 dark:text-emerald-400'>✓</span>
              <span>{d}</span>
            </li>
          ))}
          {waiting && (
            <li className='flex items-start gap-2'>
              <span aria-hidden='true' className='mt-0.5 animate-pulse text-primary'>●</span>
              <span>{waiting}</span>
            </li>
          )}
          {next && (
            <li className='flex items-start gap-2'>
              <span aria-hidden='true' className='mt-0.5 text-muted-foreground'>○</span>
              <span>{next}</span>
            </li>
          )}
        </ul>
      )}
      {needsUser && (
        <Badge variant='outline' className='w-fit border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'>
          Perlu tindakan Anda
        </Badge>
      )}
      {action}
    </div>
  )
}
