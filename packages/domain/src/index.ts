/**
 * @aee/domain — D4: FSM tabel transisi data-driven (T01–T39, §5.2 spec).
 * 25 state (union From/To; OBS-01: klaim lama "26+1=27" salah hitung — 24 + STOPPED).
 * Transisi sebagai DATA → bisa diaudit, diuji properti, divisualisasikan.
 * Transisi ilegal → ditolak + event SYSTEM_ERROR (state tidak berubah).
 */

// ── Enumerasi ────────────────────────────────────────────────────────────────

export const FSM_STATES = [
  "IDLE", "OBJECTIVE_CREATED", "OBJECTIVE_VALIDATED", "RESEARCHING",
  "RESEARCH_COMPLETE", "ANALYZING", "OPPORTUNITIES_RANKED", "OPPORTUNITY_SELECTED",
  "VALIDATING", "RESULT_READY", "MISSION_CREATED", "MISSION_APPROVED",
  "EXECUTING", "EXECUTION_COMPLETED", "MEASURING", "RESULT_ANALYZING",
  "DECISION_READY", "SCALING", "ITERATING", "PIVOTING", "KILLING",
  "HUMAN_APPROVAL_REQUIRED", "BLOCKED", "ACHIEVED", "STOPPED",
] as const;
export type FsmState = (typeof FSM_STATES)[number];

export const TERMINAL_STATES: readonly FsmState[] = ["ACHIEVED", "STOPPED"];
export const HUMAN_INTERVENTION_STATES: readonly FsmState[] = ["HUMAN_APPROVAL_REQUIRED", "BLOCKED"];

export type FsmTrigger =
  | "create_objective" | "normalize" | "start_research" | "kimi_research_ok" | "kimi_fail"
  | "analyze" | "ranked" | "kimi_select" | "experiment_created" | "experiment_done"
  | "skip_experiment" | "kimi_mission" | "approve" | "gate" | "dispatch_glm"
  | "glm_result" | "glm_fail" | "measure_start" | "measured" | "kimi_analyze"
  | "kimi_decide" | "decision=SCALE" | "decision=ITERATE" | "decision=PIVOT"
  | "decision=KILL" | "decision=WAIT_FOR_INFORMATION" | "decision=ESCALATE"
  | "mission_v_next" | "research_new" | "research_fresh" | "reselect"
  | "kill_budget_exhausted" | "reject/timeout" | "resume" | "profit>=target"
  | "stop_objective" | "ev_negative";

/** Kunci guard — evaluator disuntik (data dari DB) agar tabel tetap data murni. */
export type GuardKey =
  | "none" | "schema_valid_and_horizon_and_capital" | "no_active_cycle" | "at_least_one_opportunity"
  | "retry_ge_3" | "all_scores_by_engine" | "selection_in_ranked_and_capital_gate"
  | "budget_le_max_single_experiment" | "autonomy_ge_3_and_risk_lt_high" | "mission_schema_valid"
  | "autonomy_ge_3_or_human_approve" | "capital_gate_or_irreversible_or_autonomy_le_2"
  | "no_active_execution" | "result_schema_valid" | "metric_window_complete"
  | "decision_schema_valid_and_evidence" | "ledger_support_and_gates" | "mission_version_next_created"
  | "pivot_count_lt_3" | "budget_gate" | "learnings_archived" | "alternative_exists_and_kill_lt_3"
  | "ranked_empty" | "kill_count_ge_3" | "human_action" | "profit_from_ledger"
  | "human_only" | "ev_negative_2_cycles";

export interface Transition {
  readonly id: "T01" | "T02" | "T03" | "T04" | "T05" | "T06" | "T07" | "T08" | "T09"
    | "T10" | "T11" | "T12" | "T13" | "T14" | "T15" | "T16" | "T17" | "T18" | "T19"
    | "T20" | "T21" | "T22" | "T23" | "T24" | "T25" | "T26" | "T27" | "T28" | "T29"
    | "T30" | "T31" | "T32" | "T33" | "T34" | "T35" | "T36" | "T37" | "T38" | "T39";
  readonly from: FsmState | "*";            // "*" = T38 (apa pun)
  readonly to: FsmState | "{resume_state}"; // T34 pseudo-target
  readonly trigger: FsmTrigger;
  readonly guard: GuardKey;
}

// ── Tabel transisi §5.2 — VERBATIM dari spec (diluar pseudo-state) ──────────

export const TRANSITIONS: readonly Transition[] = [
  { id: "T01", from: "IDLE", to: "OBJECTIVE_CREATED", trigger: "create_objective", guard: "none" },
  { id: "T02", from: "OBJECTIVE_CREATED", to: "OBJECTIVE_VALIDATED", trigger: "normalize", guard: "schema_valid_and_horizon_and_capital" },
  { id: "T03", from: "OBJECTIVE_VALIDATED", to: "RESEARCHING", trigger: "start_research", guard: "no_active_cycle" },
  { id: "T04", from: "RESEARCHING", to: "RESEARCH_COMPLETE", trigger: "kimi_research_ok", guard: "at_least_one_opportunity" },
  { id: "T05", from: "RESEARCHING", to: "BLOCKED", trigger: "kimi_fail", guard: "retry_ge_3" },
  { id: "T06", from: "RESEARCH_COMPLETE", to: "ANALYZING", trigger: "analyze", guard: "none" },
  { id: "T07", from: "ANALYZING", to: "OPPORTUNITIES_RANKED", trigger: "ranked", guard: "all_scores_by_engine" },
  { id: "T08", from: "OPPORTUNITIES_RANKED", to: "OPPORTUNITY_SELECTED", trigger: "kimi_select", guard: "selection_in_ranked_and_capital_gate" },
  { id: "T09", from: "OPPORTUNITY_SELECTED", to: "VALIDATING", trigger: "experiment_created", guard: "budget_le_max_single_experiment" },
  { id: "T10", from: "VALIDATING", to: "RESULT_READY", trigger: "experiment_done", guard: "metric_window_complete" },
  { id: "T11", from: "OPPORTUNITY_SELECTED", to: "MISSION_CREATED", trigger: "skip_experiment", guard: "autonomy_ge_3_and_risk_lt_high" },
  { id: "T12", from: "RESULT_READY", to: "MISSION_CREATED", trigger: "kimi_mission", guard: "mission_schema_valid" },
  { id: "T13", from: "MISSION_CREATED", to: "MISSION_APPROVED", trigger: "approve", guard: "autonomy_ge_3_or_human_approve" },
  { id: "T14", from: "MISSION_CREATED", to: "HUMAN_APPROVAL_REQUIRED", trigger: "gate", guard: "capital_gate_or_irreversible_or_autonomy_le_2" },
  { id: "T15", from: "MISSION_APPROVED", to: "EXECUTING", trigger: "dispatch_glm", guard: "no_active_execution" },
  { id: "T16", from: "EXECUTING", to: "EXECUTION_COMPLETED", trigger: "glm_result", guard: "result_schema_valid" },
  { id: "T17", from: "EXECUTING", to: "BLOCKED", trigger: "glm_fail", guard: "retry_ge_3" },
  { id: "T18", from: "EXECUTION_COMPLETED", to: "MEASURING", trigger: "measure_start", guard: "none" },
  { id: "T19", from: "MEASURING", to: "RESULT_READY", trigger: "measured", guard: "metric_window_complete" },
  { id: "T20", from: "RESULT_READY", to: "RESULT_ANALYZING", trigger: "kimi_analyze", guard: "none" },
  { id: "T21", from: "RESULT_ANALYZING", to: "DECISION_READY", trigger: "kimi_decide", guard: "decision_schema_valid_and_evidence" },
  { id: "T22", from: "DECISION_READY", to: "SCALING", trigger: "decision=SCALE", guard: "ledger_support_and_gates" },
  { id: "T23", from: "DECISION_READY", to: "ITERATING", trigger: "decision=ITERATE", guard: "mission_version_next_created" },
  { id: "T24", from: "DECISION_READY", to: "PIVOTING", trigger: "decision=PIVOT", guard: "pivot_count_lt_3" },
  { id: "T25", from: "DECISION_READY", to: "KILLING", trigger: "decision=KILL", guard: "none" },
  { id: "T26", from: "DECISION_READY", to: "RESEARCHING", trigger: "decision=WAIT_FOR_INFORMATION", guard: "none" },
  { id: "T27", from: "DECISION_READY", to: "HUMAN_APPROVAL_REQUIRED", trigger: "decision=ESCALATE", guard: "none" },
  { id: "T28", from: "SCALING", to: "MISSION_CREATED", trigger: "mission_v_next", guard: "budget_gate" },
  { id: "T29", from: "ITERATING", to: "MISSION_CREATED", trigger: "mission_v_next", guard: "none" },
  { id: "T30", from: "PIVOTING", to: "RESEARCHING", trigger: "research_new", guard: "learnings_archived" },
  { id: "T31", from: "KILLING", to: "OPPORTUNITIES_RANKED", trigger: "reselect", guard: "alternative_exists_and_kill_lt_3" },
  { id: "T32", from: "KILLING", to: "RESEARCHING", trigger: "research_fresh", guard: "ranked_empty" },
  { id: "T33", from: "KILLING", to: "BLOCKED", trigger: "kill_budget_exhausted", guard: "kill_count_ge_3" },
  { id: "T34", from: "HUMAN_APPROVAL_REQUIRED", to: "{resume_state}", trigger: "approve", guard: "human_action" },
  { id: "T35", from: "HUMAN_APPROVAL_REQUIRED", to: "BLOCKED", trigger: "reject/timeout", guard: "none" },
  { id: "T36", from: "BLOCKED", to: "RESEARCHING", trigger: "resume", guard: "human_action" },
  { id: "T37", from: "DECISION_READY", to: "ACHIEVED", trigger: "profit>=target", guard: "profit_from_ledger" },
  { id: "T38", from: "*", to: "STOPPED", trigger: "stop_objective", guard: "human_only" },
  { id: "T39", from: "DECISION_READY", to: "BLOCKED", trigger: "ev_negative", guard: "ev_negative_2_cycles" },
];

// ── Enumerasi domain lain (§6) ───────────────────────────────────────────────

export const VERIFICATION_TIERS = ["SELF_REPORTED", "EVIDENCED", "RECONCILED", "VERIFIED"] as const;
export type VerificationTier = (typeof VERIFICATION_TIERS)[number];
export const TIER_RANK: Readonly<Record<VerificationTier, number>> = {
  SELF_REPORTED: 0, EVIDENCED: 1, RECONCILED: 2, VERIFIED: 3,
};

export const DECISION_KINDS = ["SELECT", "ITERATE", "PIVOT", "KILL", "WAIT_FOR_INFORMATION", "SCALE", "BLOCKED", "ESCALATE_TO_HUMAN"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const OPPORTUNITY_STATUSES = ["DISCOVERED", "ANALYZED", "RANKED", "SELECTED", "VALIDATING", "ACTIVE", "PAUSED", "KILLED", "REJECTED"] as const;
export const EXPERIMENT_STATUSES = ["DESIGNED", "APPROVED", "RUNNING", "MEASURING", "COMPLETED", "FAILED", "KILLED"] as const;
export const MISSION_STATUSES = ["DRAFT", "CREATED", "APPROVED", "EXECUTING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export const EXECUTION_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "TIMED_OUT"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

// ── Mesin transisi (murni) ───────────────────────────────────────────────────

export type GuardResult = { ok: true } | { ok: false; reason: string };
export type GuardEvaluator = (ctx: GuardContext) => GuardResult;

/** Data yang dibutuhkan guard; diisi orchestrator dari DB. */
export interface GuardContext {
  readonly state: FsmState;
  readonly now: Date;
  readonly objective: {
    readonly id: string;
    readonly createdAt: string;                  // ISO — basis hitung deadline efektif T02 (GAP-07)
    readonly deadline: string | null;          // ISO date; NULL hanya legal di OBJECTIVE_CREATED (GAP-07)
    readonly capitalApproved: string;
    readonly horizonMonths: number;
    readonly autonomyLevel: number;
    readonly riskTolerance: "low" | "moderate" | "high";
  };
  readonly cycle?: { readonly activeCount: number };
  readonly research?: { readonly opportunityCount: number; readonly retryCount: number };
  readonly selection?: { readonly inRankedList: boolean; readonly capitalGatePass: boolean };
  readonly risk?: { readonly level: "low" | "moderate" | "high" }; // level risiko opportunity (guard T11)
  readonly experiment?: { readonly budget: string; readonly maxSingleExperimentLoss: string; readonly windowComplete: boolean };
  readonly mission?: { readonly schemaValid: boolean; readonly humanApproved: boolean; readonly activeExecutionCount: number; readonly nextVersionCreated: boolean; readonly budgetGatePass: boolean };
  readonly result?: { readonly schemaValid: boolean; readonly partial: boolean };
  readonly decision?: {
    readonly kind: DecisionKind; readonly schemaValid: boolean; readonly evidenceCount: number;
    readonly ledgerSupportsScale: boolean; readonly pivotCount: number; readonly killCount: number;
    readonly alternativesExist: boolean; readonly rankedEmpty: boolean; readonly learningsArchived: boolean;
  };
  readonly global?: {
    readonly stopRequested: boolean; readonly drawdown: string; readonly maxTotalDrawdown: string;
    readonly evNegativeStreak: number; readonly consecutiveMissionFailures: number;
    readonly providerErrorRate1h: number; readonly approvalPending: boolean; readonly securityAnomaly: boolean;
    readonly currentProfit: string; readonly targetProfit: string;
  };
  readonly glm?: { readonly retryCount: number };
}

export type FsmOutcome =
  | { ok: true; transition: Transition; resolvedTo: FsmState | "{resume_state}" }
  | { ok: false; code: "INVALID_TRANSITION" | "GUARD_FAILED" | "GLOBAL_STOP"; transitionId?: string; reason: string };

function isState(s: string): s is FsmState {
  return (FSM_STATES as readonly string[]).includes(s);
}

/** Stop conditions §41 — guard GLOBAL, dievaluasi sebelum transisi efek.
 *  Catatan: kondisi "EV<0 dua siklus" (T39) TIDAK memblok transisi `ev_negative`
 *  itu sendiri — T39 adalah JALUR menuju BLOCKED, jadi dikecualikan saat
 *  trigger = ev_negative (kalau tidak, T39 tak pernah bisa dieksekusi). */
export function evaluateStopConditions(
  ctx: GuardContext, trigger?: FsmTrigger,
): { active: boolean; reason: string } {
  const g = ctx.global;
  if (!g) return { active: false, reason: "" };
  if (g.stopRequested) return { active: true, reason: "stop_objective requested (T38)" };
  if (parseFloat(g.drawdown) >= parseFloat(g.maxTotalDrawdown)) return { active: true, reason: `drawdown ${g.drawdown} >= max ${g.maxTotalDrawdown}` };
  if (g.evNegativeStreak >= 2 && trigger !== "ev_negative") return { active: true, reason: "EV < 0 dua siklus berturut (T39)" };
  if (g.consecutiveMissionFailures >= 3) return { active: true, reason: "gagal misi 3x berturut" };
  if (g.providerErrorRate1h > 0.5) return { active: true, reason: "provider error rate > 50% dalam 1 jam" };
  if (g.securityAnomaly) return { active: true, reason: "anomali keamanan" };
  if (g.approvalPending) return { active: true, reason: "approval pending" };
  return { active: false, reason: "" };
}

/** Cari transisi kandidat dari (state, trigger); T38 ("*") selalu kandidat. */
export function findTransitions(state: FsmState, trigger: FsmTrigger): Transition[] {
  if (TERMINAL_STATES.includes(state)) return []; // terminal: tidak ada keluar (bahkan T38 — STOPPED sudah terminal; ACHIEVED berhenti)
  return TRANSITIONS.filter((t) => (t.from === state || t.from === "*") && t.trigger === trigger);
}

/**
 * Satu langkah FSM. Urutan: stop conditions global → cari transisi → evaluasi guard.
 * Terminal STOPPED via T38 tetap diizinkan dari state non-terminal.
 */
export function step(
  state: FsmState,
  trigger: FsmTrigger,
  ctx: GuardContext,
  evaluateGuard: (key: GuardKey, t: Transition, ctx: GuardContext) => GuardResult,
): FsmOutcome {
  const stop = evaluateStopConditions(ctx, trigger);
  if (stop.active && trigger !== "stop_objective") {
    return { ok: false, code: "GLOBAL_STOP", reason: `stop condition aktif: ${stop.reason}` };
  }
  const candidates = findTransitions(state, trigger);
  if (candidates.length === 0) {
    return { ok: false, code: "INVALID_TRANSITION", reason: `tidak ada transisi dari ${state} via trigger ${trigger}` };
  }
  for (const t of candidates) {
    const g = evaluateGuard(t.guard, t, ctx);
    if (g.ok) {
      if (t.to === "{resume_state}") {
        // T34: target sebenarnya = approvals.resume_state — layer DB yang me-resolve.
        return { ok: true, transition: t, resolvedTo: "{resume_state}" };
      }
      return { ok: true, transition: t, resolvedTo: t.to };
    }
    // guard gagal → coba kandidat berikutnya (mis. T38 wildcard vs transisi spesifik)
  }
  return {
    ok: false, code: "GUARD_FAILED", transitionId: candidates[0]?.id,
    reason: `guard gagal untuk ${candidates.map((c) => c.id).join(",")} dari ${state}`,
  };
}

// ── Properti tabel (untuk test & audit) ──────────────────────────────────────

export function statesReachableFromTable(): Set<FsmState> {
  const s = new Set<FsmState>();
  for (const t of TRANSITIONS) {
    if (t.from !== "*") s.add(t.from);
    if (t.to !== "{resume_state}") s.add(t.to);
  }
  return s;
}

export function isFsmState(v: string): v is FsmState { return isState(v); }

export const FSM_STATE_COUNT = FSM_STATES.length; // 25

// ── Multi-tenancy (Phase 16) ────────────────────────────────────────────────

export {
  PLAN_TIERS,
  MEMBERSHIP_ROLES,
  SUBSCRIPTION_STATUSES,
  withinLimit,
} from "./tenancy.js";
export type {
  PlanTier,
  MembershipRole,
  SubscriptionStatus,
  Organization,
  Membership,
  SubscriptionPlan,
  Subscription,
  UsageCredits,
  ApiKey,
} from "./tenancy.js";
