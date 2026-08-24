/**
 * @aee/contracts — D6: Zod end-to-end.
 * Satu schema untuk: validasi output agen, OpenAPI, tipe TS, fixture test.
 * Semua schema STRICT — field tak dikenal ditolak (§10 aturan 1).
 */
import { z } from "zod";

// ── Primitif ─────────────────────────────────────────────────────────────────

/** Angka finansial dari agen = STRING desimal kanonik (bukan float!) — lihat D5. */
export const MoneyString = z.string().regex(/^-?\d+(\.\d{1,2})?$/, "NUMERIC(20,2) string, contoh '1000000.00'");

export const Uuid = z.string().uuid();

/** confidence ∈ [0,1] (§9). */
export const Confidence = z.number().min(0).max(1);

// ── Verifikasi & enumerasi (selaras CHECK constraint ddl_patched.sql) ────────

export const VerificationTierSchema = z.enum(["SELF_REPORTED", "EVIDENCED", "RECONCILED", "VERIFIED"]);
export const DecisionKindSchema = z.enum([
  "SELECT", "ITERATE", "PIVOT", "KILL", "WAIT_FOR_INFORMATION", "SCALE", "BLOCKED", "ESCALATE_TO_HUMAN",
]);
export const LedgerAccountSchema = z.enum([
  "CASH", "CAPITAL_DEPLOYED", "REVENUE", "COGS", "OPEX", "EXPERIMENT_COST", "LLM_COST", "DRAWDOWN",
]);

// ── §9 Kimi: DecisionRecord ──────────────────────────────────────────────────

export const DecisionRecordSchema = z.object({
  decision: DecisionKindSchema,
  subject_id: Uuid,
  reason: z.string().min(50, "alasan wajib ≥ 50 karakter"),
  evidence_ids: z.array(Uuid).min(1, "evidence_ids wajib ≥ 1 (GAP-05)"),
  metrics: z.record(z.string(), z.number()),
  assumptions: z.array(z.string()),
  confidence: Confidence,
  expected_value_next: MoneyString,
}).strict();

export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

// ── §10 GLM: GlmResult ───────────────────────────────────────────────────────

export const GlmResultSchema = z.object({
  mission_id: Uuid,
  mission_version: z.number().int().min(1),
  execution_id: Uuid,
  status: z.enum(["SUCCEEDED", "PARTIAL", "FAILED"]),
  objective_status: z.enum(["ON_TRACK", "AT_RISK", "FAILED", "UNKNOWN"]),
  summary: z.string(),
  work: z.object({
    completed: z.array(z.string()),
    files_created: z.array(z.string()),
    files_modified: z.array(z.string()),
    files_deleted: z.array(z.string()),
    systems_changed: z.array(z.string()),
  }).strict(),
  verification: z.object({
    tests_run: z.number().int().min(0),
    test_results: z.object({ passed: z.number().int().min(0), failed: z.number().int().min(0) }).strict(),
    build_result: z.enum(["PASS", "FAIL", "NOT_RUN"]),
    deployment_result: z.string(),
    runtime_result: z.string(),
  }).strict(),
  business_metrics: z.object({
    traffic: z.number().int().min(0),
    leads: z.number().int().min(0),
    customers: z.number().int().min(0),
    conversions: z.number().int().min(0),
    revenue: MoneyString,
    cost: MoneyString,
    profit: MoneyString,
    cac: MoneyString,
    retention: z.number().min(0).max(1),
  }).strict(),
  signals: z.object({
    observed_market_signal: z.string(),
    customer_signal: z.string(),
  }).strict(),
  errors: z.array(z.string()),
  blockers: z.array(z.string()),
  assumptions: z.array(z.string()),
  unverified_items: z.array(z.string()),
  recommendation: z.enum(["CONTINUE", "STOP", "ESCALATE"]),
  evidence: z.array(z.object({
    kind: z.enum(["url", "file", "metric"]),
    uri: z.string().min(1),
    sha256: z.string().length(64).regex(/^[0-9a-f]{64}$/i, "sha256 hex"),
  }).strict()),
}).strict();

export type GlmResult = z.infer<typeof GlmResultSchema>;

// ── §9/§10 Agent I/O contracts (Phase 4–5) ───────────────────────────────────

/** NUMERIC(20,4) — threshold eksperimen (4 desimal). */
export const ThresholdString = z.string().regex(/^-?\d+(\.\d{1,4})?$/, "NUMERIC(20,4) string, contoh '0.2500'");

// Kimi.research — proposal kualitatif; skor & EV dihitung ENGINE (bukan Kimi).
export const ResearchOpportunitySchema = z.object({
  name: z.string().min(1),
  customer_segment: z.string().min(1),
  problem: z.string().min(1),
  solution: z.string().min(1),
  business_model: z.string().min(1),
  price: MoneyString.optional(),
  revenue_potential: MoneyString.optional(),
  cost_estimate: MoneyString.optional(),
  capital_required: MoneyString.optional(),
  time_to_revenue_days: z.number().int().min(0).optional(),
  assumptions: z.array(z.string()),
  unknowns: z.array(z.string()),
}).strict();
export type ResearchOpportunity = z.infer<typeof ResearchOpportunitySchema>;

export const ResearchOutputSchema = z.object({
  opportunities: z.array(ResearchOpportunitySchema).min(1, "≥1 opportunity (guard T04)"),
}).strict();
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

// Kimi.rank_select
export const SelectDecisionSchema = z.object({
  selected_opportunity_id: Uuid,
  reason: z.string().min(50),
  confidence: Confidence,
  assumptions: z.array(z.string()),
}).strict();
export type SelectDecision = z.infer<typeof SelectDecisionSchema>;

// Kimi.designExperiment
export const ExperimentSpecSchema = z.object({
  opportunity_id: Uuid,
  hypothesis: z.string().min(1),
  objective: z.string().min(1),
  budget: MoneyString,
  duration_days: z.number().int().min(1),
  success_metric: z.string().min(1),
  success_threshold: ThresholdString,
  failure_threshold: ThresholdString,
  kill_criteria: z.array(z.string()).min(1),
  scale_criteria: z.array(z.string()).min(1),
  information_gain_target: z.string().min(1),
}).strict();
export type ExperimentSpec = z.infer<typeof ExperimentSpecSchema>;

// Kimi.designMission — §10 misi asli: 39 field (MISSION_ID..ESCALATION_CONDITIONS).
export const MissionTaskSchema = z.object({
  task_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  depends_on: z.array(z.string()),
}).strict();
export type MissionTask = z.infer<typeof MissionTaskSchema>;

export const MissionPackageSchema = z.object({
  mission_id: Uuid,
  mission_version: z.number().int().min(1),
  objective: z.string().min(1),
  strategic_goal: z.string().min(1),
  business_context: z.string().min(1),
  target_customer: z.string().min(1),
  customer_problem: z.string().min(1),
  value_proposition: z.string().min(1),
  product_or_service: z.string().min(1),
  business_model: z.string().min(1),
  pricing: z.string().min(1),
  expected_economics: z.object({
    revenue_target: MoneyString,
    cost_estimate: MoneyString,
    expected_profit: MoneyString,
    assumptions: z.array(z.string()),
  }).strict(),
  strategic_rationale: z.string().min(1),
  priority: z.number().int().min(1).max(5),
  tasks: z.array(MissionTaskSchema).min(1),
  technical_requirements: z.array(z.string()),
  data_requirements: z.array(z.string()),
  api_requirements: z.array(z.string()),
  architecture_requirements: z.array(z.string()),
  ui_requirements: z.array(z.string()),
  automation_requirements: z.array(z.string()),
  security_requirements: z.array(z.string()),
  deployment_requirements: z.array(z.string()),
  analytics_requirements: z.array(z.string()),
  operational_requirements: z.array(z.string()),
  budget: MoneyString,
  time_limit: z.object({
    hard_deadline_hours: z.number().int().min(1),
    soft_deadline_hours: z.number().int().min(1).optional(),
  }).strict(),
  hard_constraints: z.array(z.string()),
  soft_constraints: z.array(z.string()),
  acceptance_criteria: z.array(z.string()).min(1),
  test_requirements: z.array(z.string()),
  success_metrics: z.array(z.string()).min(1),
  success_thresholds: z.record(z.string(), ThresholdString),
  failure_thresholds: z.record(z.string(), ThresholdString),
  kill_criteria: z.array(z.string()).min(1),
  scale_criteria: z.array(z.string()).min(1),
  deliverables: z.array(z.string()).min(1),
  reporting_requirements: z.array(z.string()),
  escalation_conditions: z.array(z.string()),
}).strict();
export type MissionPackage = z.infer<typeof MissionPackageSchema>;

/** §10: field yang TIDAK boleh diubah GLM (what/why — bukan how). */
export const MISSION_PROTECTED_FIELDS = ["objective", "target_customer", "business_model", "pricing"] as const;

function canonicalThresholds(r: Record<string, string>): string {
  return JSON.stringify(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
}

/** Deteksi drift misi vs kontrak — dipakai validator versi misi (§10 penutup). */
export function detectMissionDrift(a: MissionPackage, b: MissionPackage): { drift: boolean; fields: string[] } {
  const fields: string[] = [];
  for (const f of MISSION_PROTECTED_FIELDS) {
    if (a[f] !== b[f]) fields.push(f);
  }
  if (JSON.stringify([...a.success_metrics].sort()) !== JSON.stringify([...b.success_metrics].sort())) fields.push("success_metrics");
  if (canonicalThresholds(a.success_thresholds) !== canonicalThresholds(b.success_thresholds)) fields.push("success_thresholds");
  return { drift: fields.length > 0, fields };
}

// ── Phase 15: BUSINESS VENTURE (business-identity domain redesign) ───────────
// Objective bukan lagi record terisolasi — wajib menempel ke Business Venture
// (Mode A GIVEN) atau ber-mode DISCOVERY (Mode B: Kimi memilih bisnis di rank_select).

export const BusinessVentureSchema = z.object({
  id: Uuid,
  name: z.string().min(1),          // "SaaS B2B Audit Kepatuhan"
  industry: z.string().min(1),
  market: z.string().min(1),
  target_customer: z.string().min(1),
  problem: z.string().min(1),
  solution: z.string().min(1),
  business_model: z.string().min(1),
  price: z.string().nullable(),
  origin: z.enum(["USER", "KIMI_DISCOVERED"]),
  created_at: z.string(),
}).strict();
export type BusinessVenture = z.infer<typeof BusinessVentureSchema>;

export const CreateVentureRequestSchema = z.object({
  name: z.string().min(1),
  industry: z.string().min(1),
  market: z.string().min(1),
  target_customer: z.string().min(1),
  problem: z.string().min(1),
  solution: z.string().min(1),
  business_model: z.string().min(1),
  price: z.string().optional(),
}).strict();
export type CreateVentureRequest = z.infer<typeof CreateVentureRequestSchema>;

// ── §8 API: pembuatan objective ──────────────────────────────────────────────

export const CreateObjectiveRequestSchema = z.object({
  title: z.string().min(1),
  business_mode: z.enum(["GIVEN", "DISCOVERY"]).default("DISCOVERY"),
  business_venture_id: Uuid.optional(),          // wajib saat mode GIVEN
  business: CreateVentureRequestSchema.optional(), // definisi inline (dipakai dashboard)
  assets: z.array(z.string()).optional(),          // existing assets/customers/distribution/...
  constraints: z.array(z.string()).optional(),
  target_profit: MoneyString.refine((v) => parseFloat(v) > 0, "target_profit > 0"),
  capital_approved: MoneyString.refine((v) => parseFloat(v) > 0, "capital_approved > 0"),
  horizon_months: z.number().int().min(1).max(60),
  market: z.string().min(1),
  risk_tolerance: z.enum(["low", "moderate", "high"]),
  autonomy_level: z.number().int().min(0).max(4).optional(),
  environment: z.enum(["SIMULATED", "TEST", "REAL"]).optional(),
}).strict();

export type CreateObjectiveRequest = z.infer<typeof CreateObjectiveRequestSchema>;

// ── §7 DB row shapes (subset yang dipakai app) ───────────────────────────────

export const ObjectiveRowSchema = z.object({
  id: Uuid,
  user_id: Uuid,
  title: z.string(),
  target_profit: MoneyString,
  capital_approved: MoneyString,
  horizon_months: z.number().int(),
  deadline: z.string().nullable(),           // NULL hanya di OBJECTIVE_CREATED (GAP-07)
  market: z.string(),
  risk_tolerance: z.enum(["low", "moderate", "high"]),
  autonomy_level: z.number().int().min(0).max(4),
  state: z.string(),
  current_cycle: z.number().int(),
  environment: z.enum(["SIMULATED", "TEST", "REAL"]),
  row_version: z.number().int().min(1),
});
export type ObjectiveRow = z.infer<typeof ObjectiveRowSchema>;

// ── Error codes §8 ───────────────────────────────────────────────────────────

export const API_ERROR_CODES = [
  "VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT",
  "STATE_VIOLATION", "GATE_VIOLATION", "BUDGET_EXCEEDED", "RATE_LIMITED",
  "IDEMPOTENCY_CONFLICT", "INTERNAL",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode, message: string, readonly details?: unknown) {
    super(message);
  }
}

// ── Result processing (§10 aturan 2–4) ───────────────────────────────────────

export interface ResultIntakeInput {
  readonly result: GlmResult;
  readonly execution: {
    readonly missionId: string;
    readonly missionVersion: number;
    readonly executionId: string;
    readonly status: string; // harus RUNNING untuk diterima
  };
}

export type ResultIntakeOutcome =
  | { accepted: true; verificationTier: "SELF_REPORTED" | "EVIDENCED" | "RECONCILED"; ledgerWritten: boolean; partial: boolean }
  | { accepted: false; code: "RESULT_REJECTED"; reason: string };

/**
 * Menentukan tier hasil GLM (§10 aturan 3):
 * - revenue > 0 tanpa evidence → SELF_REPORTED → TIDAK menyentuh ledger
 * - revenue > 0 dengan evidence sha-verified → EVIDENCED
 * - RECONCILED hanya via webhook pembayaran / verifikasi owner (bukan di sini)
 */
export function determineTier(result: GlmResult): { tier: "SELF_REPORTED" | "EVIDENCED"; ledgerWritten: boolean } {
  const revenue = parseFloat(result.business_metrics.revenue);
  if (revenue > 0 && result.evidence.length > 0) {
    return { tier: "EVIDENCED", ledgerWritten: false };
  }
  return { tier: "SELF_REPORTED", ledgerWritten: false };
}

/** Validasi intake hasil GLM — aturan 1–2 §10. */
export function intakeResult(input: ResultIntakeInput): ResultIntakeOutcome {
  const r = input.result;
  if (input.execution.status !== "RUNNING") {
    return { accepted: false, code: "RESULT_REJECTED", reason: `execution status ${input.execution.status} ≠ RUNNING (anti-duplikat)` };
  }
  if (r.mission_id !== input.execution.missionId || r.mission_version !== input.execution.missionVersion || r.execution_id !== input.execution.executionId) {
    return { accepted: false, code: "RESULT_REJECTED", reason: "mission_id/version/execution_id tidak cocok execution RUNNING (anti-halusinasi referensi)" };
  }
  const { tier } = determineTier(r);
  return {
    accepted: true,
    verificationTier: tier,
    ledgerWritten: false, // hanya RECONCILED+ yang menulis ledger (D8) — via jalur webhook
    partial: r.status === "PARTIAL",
  };
}
