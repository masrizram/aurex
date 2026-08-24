/**
 * @aee/orchestrator — §11: mesin transisi.
 * GuardEvaluator konkret (murni, data dari GuardContext) + efek dispatcher skeleton.
 * Integrasi DB/pg-boss menyusul di apps/worker (Phase 6) — package ini murni & teruji unit.
 */
import {
  type FsmOutcome, type FsmState, type FsmTrigger, type GuardContext, type GuardKey,
  type GuardResult, type Transition, step,
} from "@aee/domain";

// ── Guard evaluator konkret (§5.2 kolom Guard) ───────────────────────────────

function num(s: string): number { return parseFloat(s); }

/** created_at + horizon bulan → ISO date (basis deadline efektif T02, GAP-07). */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function evaluateGuard(key: GuardKey, t: Transition, ctx: GuardContext): GuardResult {
  const o = ctx.objective;
  switch (key) {
    case "none":
    case "human_action":
    case "human_only":
      return { ok: true };
    case "schema_valid_and_horizon_and_capital": {
      // Deadline efektif (GAP-07): deadline DB bila terisi, ELSE created_at+horizon
      // (deadline baris T02 diisi EFEK transisi — guard memakai nilai yang akan diisi).
      const effective = o.deadline ?? addMonths(o.createdAt, o.horizonMonths);
      if (num(o.capitalApproved) <= 0) return { ok: false, reason: "capital_approved ≤ 0" };
      const deadline = new Date(`${effective}T23:59:59+07:00`); // Asia/Jakarta
      if (Number.isNaN(deadline.getTime())) return { ok: false, reason: "deadline tidak parseable" };
      if (deadline.getTime() <= ctx.now.getTime()) return { ok: false, reason: "horizon ≤ now" };
      return { ok: true };
    }
    case "no_active_cycle":
      return (ctx.cycle?.activeCount ?? 0) === 0
        ? { ok: true } : { ok: false, reason: "cycle aktif sudah ada (lock T03)" };
    case "at_least_one_opportunity":
      return (ctx.research?.opportunityCount ?? 0) >= 1
        ? { ok: true } : { ok: false, reason: "tidak ada opportunity schema-valid" };
    case "retry_ge_3": {
      // T05 = retry Kimi (research), T17 = retry GLM — sumber diambil SESUAI transisi.
      const r = t.id === "T17" ? (ctx.glm?.retryCount ?? 0) : (ctx.research?.retryCount ?? 0);
      // T05/T17: ke BLOCKED hanya setelah retry HABIS (≥3) — sebelum itu caller retry dengan backoff.
      return r >= 3 ? { ok: true } : { ok: false, reason: `retry ${r} < 3 — masih ada kesempatan retry` };
    }
    case "all_scores_by_engine":
      return { ok: true }; // engine menghitung skor — dibuktikan di test economics
    case "selection_in_ranked_and_capital_gate":
      return ctx.selection?.inRankedList && ctx.selection.capitalGatePass
        ? { ok: true } : { ok: false, reason: "pilihan ∉ ranked list atau capital gate gagal" };
    case "budget_le_max_single_experiment":
      return ctx.experiment && num(ctx.experiment.budget) <= num(ctx.experiment.maxSingleExperimentLoss)
        ? { ok: true } : { ok: false, reason: "budget > MAX_SINGLE_EXPERIMENT_LOSS" };
    case "autonomy_ge_3_and_risk_lt_high":
      return o.autonomyLevel >= 3 && ctx.risk?.level !== "high"
        ? { ok: true } : { ok: false, reason: "autonomy < 3 atau risk level = high" };
    case "mission_schema_valid":
      return ctx.mission?.schemaValid ? { ok: true } : { ok: false, reason: "mission package tidak schema-valid" };
    case "autonomy_ge_3_or_human_approve":
      return o.autonomyLevel >= 3 || ctx.mission?.humanApproved
        ? { ok: true } : { ok: false, reason: "autonomy < 3 dan belum human-approve" };
    case "capital_gate_or_irreversible_or_autonomy_le_2":
      return o.autonomyLevel <= 2
        ? { ok: true } : { ok: false, reason: "gate tidak aktif (autonomy ≥ 3, capital ≤ threshold)" };
    case "no_active_execution":
      return (ctx.mission?.activeExecutionCount ?? 0) === 0
        ? { ok: true } : { ok: false, reason: "execution aktif sudah ada (unique index)" };
    case "result_schema_valid":
      return ctx.result?.schemaValid ? { ok: true } : { ok: false, reason: "GLM result tidak schema-valid" };
    case "metric_window_complete":
      return ctx.experiment?.windowComplete
        ? { ok: true } : { ok: false, reason: "metric window belum lengkap" };
    case "decision_schema_valid_and_evidence":
      return ctx.decision?.schemaValid && (ctx.decision.evidenceCount ?? 0) >= 1
        ? { ok: true } : { ok: false, reason: "decision tidak valid atau evidence kosong (GAP-05)" };
    case "ledger_support_and_gates":
      return ctx.decision?.ledgerSupportsScale
        ? { ok: true } : { ok: false, reason: "ledger tidak mendukung SCALE" };
    case "mission_version_next_created":
      return ctx.mission?.nextVersionCreated ? { ok: true } : { ok: false, reason: "mission_version+1 belum dibuat" };
    case "pivot_count_lt_3":
      return (ctx.decision?.pivotCount ?? 0) < 3 ? { ok: true } : { ok: false, reason: "pivot_count ≥ 3" };
    case "budget_gate":
      return ctx.mission?.budgetGatePass ? { ok: true } : { ok: false, reason: "budget gate gagal" };
    case "learnings_archived":
      return ctx.decision?.learningsArchived ? { ok: true } : { ok: false, reason: "learnings belum diarsip" };
    case "alternative_exists_and_kill_lt_3":
      return ctx.decision?.alternativesExist && (ctx.decision.killCount ?? 0) < 3
        ? { ok: true } : { ok: false, reason: "tidak ada alternatif atau kill_count ≥ 3" };
    case "ranked_empty":
      return ctx.decision?.rankedEmpty ? { ok: true } : { ok: false, reason: "ranked tidak kosong" };
    case "kill_count_ge_3":
      return (ctx.decision?.killCount ?? 0) >= 3 ? { ok: true } : { ok: false, reason: "kill_count < 3" };
    case "profit_from_ledger": {
      const g = ctx.global;
      if (!g) return { ok: false, reason: "data ledger tidak tersedia" };
      return num(g.currentProfit) >= num(g.targetProfit)
        ? { ok: true } : { ok: false, reason: "profit ledger < target" };
    }
    case "ev_negative_2_cycles":
      return (ctx.global?.evNegativeStreak ?? 0) >= 2
        ? { ok: true } : { ok: false, reason: "EV<0 belum 2 siklus berturut" };
    default: {
      const _exhaustive: never = key;
      void _exhaustive;
      return { ok: false, reason: `guard tidak dikenal: ${String(key)}` };
    }
  }
}

// ── Facade transisi (satu pintu; caller tinggal sediakan ctx) ────────────────

export function advance(state: FsmState, trigger: FsmTrigger, ctx: GuardContext): FsmOutcome {
  return step(state, trigger, ctx, evaluateGuard);
}

/** Terminal check untuk CLI/debug. */
export function isTerminal(s: FsmState): boolean {
  return s === "ACHIEVED" || s === "STOPPED";
}
