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
