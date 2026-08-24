/**
 * @aee/orchestrator — runtime §11 (Phase 6).
 *
 * advance() = SATU transaksi DB per transisi:
 *   BEGIN → pg_advisory_xact_lock(objective) → SELECT FOR UPDATE →
 *   loadGuardContext (data DB) → step() murni → efek idempoten →
 *   UPDATE ... WHERE row_version = dibaca (optimistic concurrency) →
 *   INSERT events → COMMIT.
 * Panggilan LLM TIDAK PERNAH di dalam transaksi (§11): efek async = job
 * antrean (pg-boss D3), hasilnya memicu advance() berikutnya (rantai runner).
 */
import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  type FsmOutcome, type FsmState, type FsmTrigger, type GuardContext, type Transition,
  step,
} from "@aee/domain";
import {
  type DecisionRecord, type GlmResult, type MissionPackage, type ResearchOpportunity,
  intakeResult,
} from "@aee/contracts";
import {
  type ExecutionAgentProvider, type ModelRunRecord, type StrategicAgentProvider,
} from "@aee/agents";
import { Money } from "@aee/money";
import { computeOpportunityScores } from "@aee/economics";
import { evaluateGuard, isTerminal } from "./index.js";

export { evaluateGuard, isTerminal };

// ── Antrean (D3: pg-boss; InMemory utk test) ─────────────────────────────────

export const QUEUE_ADVANCE = "advance";

export type AgentJobKind =
  | "research" | "rank_select" | "human_select" | "design_experiment" | "design_mission" | "dispatch_glm"
  | "interpret_results" | "mission_next"; // Phase 8–9 (mission manager)

export interface AgentJob {
  readonly kind: AgentJobKind;
  readonly objectiveId: string;
  readonly idem: string;
  /** human_select: opportunity yang dipilih customer + alasan opsional. */
  readonly opportunityId?: string;
  readonly reason?: string;
}

export interface JobQueue {
  enqueue(job: AgentJob): Promise<void>;
}

export class InMemoryQueue implements JobQueue {
  readonly jobs: AgentJob[] = [];
  async enqueue(j: AgentJob): Promise<void> { this.jobs.push(j); }
}

/** pg-boss v10 — singletonKey = dedup antrean per idem (§21).
 *  v10 wajib createQueue() sebelum send (INSERT ke queue tak dikenal = gagal senyap).
 *  Queue dibuat sekali per proses (cache Set). */
export class PgBossQueue implements JobQueue {
  private readonly created = new Set<string>();
  constructor(
    private readonly boss: {
      createQueue(name: string): Promise<void>;
      send(name: string, data: object, options?: Record<string, unknown>): Promise<string | null>;
    },
  ) {}
  async enqueue(j: AgentJob): Promise<void> {
    if (!this.created.has(QUEUE_ADVANCE)) {
      await this.boss.createQueue(QUEUE_ADVANCE);
      this.created.add(QUEUE_ADVANCE);
    }
    await this.boss.send(QUEUE_ADVANCE, { ...j }, {
      singletonKey: j.idem, retryLimit: 3, retryDelay: 30, retryBackoff: true,
      expireIn: "30 minutes",
    });
  }
}

// ── Kesalahan & util ─────────────────────────────────────────────────────────

export class OrchestratorError extends Error {
  constructor(readonly code: "STALE_STATE" | "SYSTEM_ERROR" | "GUARD_FAILED", message: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

export interface OrchestratorDeps {
  readonly strategic: StrategicAgentProvider & { readonly runs?: readonly ModelRunRecord[] };
  readonly execution: ExecutionAgentProvider & { readonly runs?: readonly ModelRunRecord[] };
  readonly queue: JobQueue;
  readonly clock?: () => Date;
  readonly gates?: { maxSingleExperimentLoss?: string; maxCapitalDeployment?: string };
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Kunci advisory — dibuat oleh Postgres sendiri via hashtext() §11 (FNV/BigInt tidak dipakai). */
export const ADVISORY_SQL = "SELECT pg_advisory_xact_lock(hashtext($1))";

/** Deadline = created_at + horizon bulan (tanggal ISO, zona Asia/Jakarta konseptual). */
export function jakartaDeadline(from: Date, horizonMonths: number): string {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + horizonMonths);
  return d.toISOString().slice(0, 10);
}

/** Peta decision Kimi → trigger FSM (T22–T27). */
export function decisionTrigger(decision: DecisionRecord["decision"]): FsmTrigger | null {
  switch (decision) {
    case "SCALE": return "decision=SCALE";
    case "ITERATE": return "decision=ITERATE";
    case "PIVOT": return "decision=PIVOT";
    case "KILL": return "decision=KILL";
    case "WAIT_FOR_INFORMATION": return "decision=WAIT_FOR_INFORMATION";
    case "ESCALATE_TO_HUMAN": return "decision=ESCALATE";
    default: return null; // SELECT/BLOCKED bukan transisi post-analisis
  }
}

// ── Row shapes ───────────────────────────────────────────────────────────────

interface ObjectiveDb {
  id: string; user_id: string; title: string; target_profit: string; capital_approved: string;
  horizon_months: number; deadline: string | null; market: string;
  risk_tolerance: "low" | "moderate" | "high"; autonomy_level: number; state: FsmState;
  current_cycle: number; environment: string; row_version: number; created_at: Date;
  // Phase 15 business identity:
  business_venture_id: string | null; business_mode: "GIVEN" | "DISCOVERY";
  business_name?: string | null; business_industry?: string | null;
  business_customer?: string | null; business_problem?: string | null;
  business_solution?: string | null; business_business_model?: string | null;
}

interface CycleDb { id: string; cycle_number: number }

interface ObjectiveSummary {
  readonly id: string; readonly title: string; readonly market: string;
  readonly riskTolerance: "low" | "moderate" | "high"; readonly targetProfit: string;
  readonly capitalApproved: string; readonly horizonMonths: number; readonly environment: string;
  // Phase 15 business identity:
  readonly businessName?: string; readonly businessIndustry?: string;
  readonly businessCustomer?: string; readonly businessProblem?: string;
  readonly businessSolution?: string; readonly businessModel?: string;
  readonly businessMode?: "GIVEN" | "DISCOVERY";
}

interface RankedOpp { id: string; name: string; riskAdjustedScore: string; capitalRequired: string; expectedValue: string }

// ── Transaksi advance (§11) ──────────────────────────────────────────────────

type CtxPatch = (ctx: GuardContext & { cycleId: string | null }) => GuardContext & { cycleId: string | null };

async function emitEvent(
  client: PoolClient, objectiveId: string | null, cycleId: string | null,
  type: string, payload: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO events (objective_id, cycle_id, type, payload, correlation_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [objectiveId, cycleId, type, JSON.stringify(payload), randomUUID()],
  );
}

/**
 * Satu transisi FSM dalam SATU transaksi DB.
 * `patch` meng-overridе GuardContext dengan fakta yang baru ditulis runner
 * (hasil agen) — loader tetap menyuplai basis dari DB.
 */
export async function advance(
  client: PoolClient,
  objectiveId: string,
  trigger: FsmTrigger,
  deps: OrchestratorDeps,
  patch?: CtxPatch,
): Promise<FsmOutcome> {
  const now = deps.clock?.() ?? new Date();
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [objectiveId]);
    const sel = await client.query<ObjectiveDb>(
      `SELECT * FROM objectives WHERE id = $1 FOR UPDATE`, [objectiveId]);
    const obj = sel.rows[0];
    if (!obj) throw new OrchestratorError("SYSTEM_ERROR", `objective ${objectiveId} tidak ditemukan`);
    if (isTerminal(obj.state)) {
      await client.query("COMMIT");
      return { ok: false, code: "INVALID_TRANSITION", reason: `state terminal ${obj.state}: tanpa transisi keluar` };
    }
    const loaded = await loadGuardContext(client, obj, now);
    const ctx = patch ? patch(loaded) : loaded;
    const outcome = step(obj.state, trigger, ctx, evaluateGuard);
    if (!outcome.ok) {
      await emitEvent(client, obj.id, loaded.cycleId, "SYSTEM_ERROR", {
        trigger, from: obj.state, code: outcome.code, reason: outcome.reason,
      });
      await client.query("COMMIT");
      return outcome;
    }
    const t = outcome.transition;
    const target = await resolveTarget(client, outcome, objectiveId);
    await runEffect(client, t, obj, ctx, deps);

    const upd = await client.query<{ row_version: number }>(
      `UPDATE objectives SET state = $2, row_version = row_version + 1, updated_at = now()
       WHERE id = $1 AND row_version = $3 RETURNING row_version`,
      [objectiveId, target, obj.row_version]);
    if ((upd.rowCount ?? 0) !== 1) {
      throw new OrchestratorError("STALE_STATE",
        `row_version berubah (baca ${obj.row_version}) — optimistic concurrency; ulangi advance`);
    }
    const newVersion = upd.rows[0]!.row_version;
    await emitEvent(client, objectiveId, ctx.cycleId, "STATE_UPDATED", {
      transition: t.id, trigger: t.trigger, from: obj.state, to: target, rowVersion: newVersion,
    });
    await client.query("COMMIT");
    return outcome;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e instanceof OrchestratorError) throw e;
    throw new OrchestratorError("SYSTEM_ERROR", e instanceof Error ? e.message : String(e));
  }
}

/** T34: `{resume_state}` di-resolve dari approvals — PENDING terbaru bila ada,
 *  else approval terbaru yang BARU diputus (API meng-UPDATE status SEBELUM advance;
 *  urutan idempoten: approve handler → status APPROVED → advance approve). */
async function resolveTarget(
  client: PoolClient, outcome: FsmOutcome & { ok: true }, objectiveId: string,
): Promise<FsmState> {
  if (outcome.resolvedTo !== "{resume_state}") return outcome.resolvedTo;
  const ap = await client.query<{ resume_state: string }>(
    `SELECT resume_state FROM approvals WHERE objective_id = $1 AND status = 'PENDING'
     ORDER BY created_at DESC LIMIT 1`, [objectiveId]);
  const s = ap.rows[0]?.resume_state;
  if (s) return s as FsmState;
  // Fallback: keputusan terbaru (APPROVED/REJECTED) dalam 5 menit terakhir —
  // resume_state tetap konteks transisi tersebut.
  const ap2 = await client.query<{ resume_state: string }>(
    `SELECT resume_state FROM approvals WHERE objective_id = $1 AND status = 'APPROVED'
       AND decided_at > now() - interval '5 minutes'
     ORDER BY decided_at DESC LIMIT 1`, [objectiveId]);
  const s2 = ap2.rows[0]?.resume_state;
  if (s2) return s2 as FsmState;
  return "BLOCKED";
}

// ── GuardContext loader (fakta dari DB — D2 sumber kebenaran) ────────────────

async function loadGuardContext(
  client: PoolClient, obj: ObjectiveDb, now: Date,
): Promise<GuardContext & { cycleId: string | null }> {
  const cyc = await client.query<CycleDb & { cnt: string }>(
    `SELECT id, cycle_number,
            (SELECT count(*)::text FROM cycles c2 WHERE c2.objective_id = $1 AND c2.status = 'ACTIVE') AS cnt
     FROM cycles WHERE objective_id = $1 AND status = 'ACTIVE'
     ORDER BY cycle_number DESC LIMIT 1`, [obj.id]);
  const cycle = cyc.rows[0];
  const cycleId = cycle?.id ?? null;
  const opp = cycleId
    ? await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM opportunities WHERE cycle_id = $1`, [cycleId])
    : null;
  const drawdown = await client.query<{ d: string }>(
    `SELECT COALESCE(sum(amount) FILTER (WHERE debit_account = 'DRAWDOWN'), 0)::text AS d
     FROM capital_transactions WHERE objective_id = $1`, [obj.id]);
  const fails = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM executions
     WHERE status IN ('FAILED','TIMED_OUT')
       AND mission_id IN (SELECT id FROM missions WHERE objective_id = $1)`, [obj.id]);
  const activeExec = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM executions
     WHERE status IN ('QUEUED','RUNNING')
       AND mission_id IN (SELECT id FROM missions WHERE objective_id = $1)`, [obj.id]);
  return {
    state: obj.state,
    now,
    objective: {
      id: obj.id, createdAt: obj.created_at.toISOString(), deadline: obj.deadline,
      capitalApproved: obj.capital_approved,
      horizonMonths: obj.horizon_months, autonomyLevel: obj.autonomy_level,
      riskTolerance: obj.risk_tolerance,
    },
    cycle: { activeCount: parseInt(cycle?.cnt ?? "0", 10) },
    research: { opportunityCount: parseInt(opp?.rows[0]?.n ?? "0", 10), retryCount: 0 },
    mission: { schemaValid: true, humanApproved: false, activeExecutionCount: parseInt(activeExec.rows[0]?.n ?? "0", 10), nextVersionCreated: false, budgetGatePass: true },
    global: {
      stopRequested: obj.state === "STOPPED",
      drawdown: drawdown.rows[0]?.d ?? "0.00",
      maxTotalDrawdown: "4000000.00",
      evNegativeStreak: 0,
      consecutiveMissionFailures: parseInt(fails.rows[0]?.n ?? "0", 10),
      providerErrorRate1h: 0,
      approvalPending: false,
      securityAnomaly: false,
      currentProfit: "0.00",
      targetProfit: obj.target_profit,
    },
    cycleId,
  };
}

// ── Efek sync dalam transisi (idempoten) ─────────────────────────────────────

async function runEffect(
  client: PoolClient, t: Transition, obj: ObjectiveDb,
  ctx: GuardContext & { cycleId: string | null }, deps: OrchestratorDeps,
): Promise<void> {
  switch (t.trigger) {
    case "normalize": {
      // T02: isi deadline bila masih NULL (GAP-07) — idempoten via WHERE deadline IS NULL
      if (!obj.deadline) {
        await client.query(
          `UPDATE objectives SET deadline = $2 WHERE id = $1 AND deadline IS NULL`,
          [obj.id, jakartaDeadline(obj.created_at, obj.horizon_months)]);
      }
      return;
    }
    case "start_research": {
      // T03: buka cycle baru — idempoten: skip bila sudah ada ACTIVE
      if ((ctx.cycle?.activeCount ?? 0) > 0) return;
      const n = obj.current_cycle + 1;
      await client.query(
        `INSERT INTO cycles (objective_id, cycle_number, started_at, status)
         VALUES ($1, $2, now(), 'ACTIVE')`, [obj.id, n]);
      await client.query(
        `UPDATE objectives SET current_cycle = $2 WHERE id = $1`, [obj.id, n]);
      await deps.queue.enqueue({ kind: "research", objectiveId: obj.id, idem: `research:${obj.id}:c${n}` });
      return;
    }
    default:
      return; // efek lain = job async runner (LLM tidak pernah dalam transaksi)
  }
}

// ── Runner job agen (di luar transisi; menulis hasil lalu advance) ───────────

export interface RunnerResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly detail: string;
}

/** Kursor flush model_runs per provider (hindari INSERT ganda lintas job). */
const flushCursor = new WeakMap<object, number>();

// F10 fix: exported so mission-manager can flush KIMI runs after interpretResults/designMission.
export async function flushModelRuns(
  client: PoolClient, provider: { readonly runs?: readonly ModelRunRecord[] }, cycleId: string | null,
): Promise<void> {
  const runs = provider.runs;
  if (!runs || runs.length === 0) return;
  const from = flushCursor.get(provider) ?? 0;
  for (let i = from; i < runs.length; i += 1) {
    const r = runs[i]!;
    const pv = await client.query<{ id: string }>(
      `INSERT INTO prompt_versions (name, version, blocks, template_hash)
       VALUES ($1, 1, '[]'::jsonb, $2)
       ON CONFLICT (name, version) DO UPDATE SET template_hash = EXCLUDED.template_hash
       RETURNING id`, [r.promptVersionId, sha256(r.promptVersionId)]);
    await client.query(
      `INSERT INTO model_runs (cycle_id, agent, purpose, prompt_version_id, model, model_version,
         temperature, token_limit, input_context_hash, output_hash, input_tokens, output_tokens,
         cost, latency_ms, retries, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [cycleId, r.agent, r.purpose, pv.rows[0]!.id, r.model, r.modelVersion, r.temperature,
       r.tokenLimit, r.inputContextHash, r.outputHash, r.inputTokens, r.outputTokens,
       r.cost, r.latencyMs, r.retries, r.status, r.error]);
  }
  flushCursor.set(provider, runs.length);
}

async function objectiveSummary(client: PoolClient, id: string): Promise<ObjectiveDb> {
  // Phase 15: JOIN business_ventures — objective selalu punya konteks bisnis.
  const sel = await client.query<ObjectiveDb>(
    `SELECT o.*, v.name AS business_name, v.industry AS business_industry,
            v.target_customer AS business_customer, v.problem AS business_problem,
            v.solution AS business_solution, v.business_model AS business_business_model
     FROM objectives o
     LEFT JOIN business_ventures v ON v.id = o.business_venture_id
     WHERE o.id = $1`, [id]);
  const obj = sel.rows[0];
  if (!obj) throw new OrchestratorError("SYSTEM_ERROR", `objective ${id} tidak ditemukan`);
  return obj;
}

async function activeCycle(client: PoolClient, objectiveId: string): Promise<CycleDb> {
  const sel = await client.query<CycleDb>(
    `SELECT id, cycle_number FROM cycles WHERE objective_id = $1 AND status = 'ACTIVE'
     ORDER BY cycle_number DESC LIMIT 1`, [objectiveId]);
  const c = sel.rows[0];
  if (!c) throw new OrchestratorError("SYSTEM_ERROR", `tidak ada cycle ACTIVE utk ${objectiveId}`);
  return c;
}

async function insertOpportunity(
  client: PoolClient, objectiveId: string, cycleId: string, opp: ResearchOpportunity,
): Promise<void> {
  // T07: skor & EV dihitung ENGINE di sini — Kimi hanya menyuplai kualitatif.
  const scores = computeOpportunityScores({
    demandScore: 6, willingnessToPayScore: 6, profitabilityScore: 6, scalabilityScore: 6,
    defensibilityScore: 6, executionFeasibilityScore: 6, evidenceStrengthScore: 5,
    timeToRevenueScore: 5,
    revenuePotential: opp.revenue_potential ?? "1000000.00",
    costEstimate: opp.cost_estimate ?? "500000.00",
  });
  await client.query(
    `INSERT INTO opportunities (objective_id, cycle_id, name, customer_segment, problem, solution,
       business_model, price, revenue_potential, cost_estimate, capital_required,
       opportunity_score, risk_score, probability_of_success, expected_value, risk_adjusted_score,
       assumptions, unknowns, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,'DISCOVERED')`,
    [objectiveId, cycleId, opp.name, opp.customer_segment, opp.problem, opp.solution,
     opp.business_model, opp.price ?? null, opp.revenue_potential ?? null, opp.cost_estimate ?? null,
     opp.capital_required ?? null, scores.opportunityScore, scores.riskScore,
     scores.probabilityOfSuccess, scores.expectedValue, scores.riskAdjustedScore,
     JSON.stringify(opp.assumptions), JSON.stringify(opp.unknowns)]);
}

async function rankedList(client: PoolClient, cycleId: string): Promise<RankedOpp[]> {
  const { rows } = await client.query<RankedOpp>(
    `SELECT id, name, risk_adjusted_score::text AS "riskAdjustedScore",
            COALESCE(capital_required, 0)::text AS "capitalRequired",
            COALESCE(expected_value, 0)::text AS "expectedValue"
     FROM opportunities WHERE cycle_id = $1 AND status IN ('DISCOVERED','RANKED')
     ORDER BY risk_adjusted_score DESC NULLS LAST`, [cycleId]);
  return rows;
}

async function selectedOpportunity(client: PoolClient, cycleId: string): Promise<RankedOpp> {
  const { rows } = await client.query<RankedOpp>(
    `SELECT id, name, risk_adjusted_score::text AS "riskAdjustedScore",
            COALESCE(capital_required, 0)::text AS "capitalRequired",
            COALESCE(expected_value, 0)::text AS "expectedValue"
     FROM opportunities WHERE cycle_id = $1 AND status = 'SELECTED' LIMIT 1`, [cycleId]);
  const r = rows[0];
  if (!r) throw new OrchestratorError("SYSTEM_ERROR", `tidak ada opportunity SELECTED di cycle ${cycleId}`);
  return r;
}

/** Menjalankan SATU job agen: panggil LLM (async), tulis hasil, advance rantai. */
export async function runAgentJob(
  client: PoolClient, job: AgentJob, deps: OrchestratorDeps,
): Promise<RunnerResult> {
  const obj = await objectiveSummary(client, job.objectiveId);
  const summary: ObjectiveSummary = {
    id: obj.id, title: obj.title, market: obj.market, riskTolerance: obj.risk_tolerance,
    targetProfit: obj.target_profit, capitalApproved: obj.capital_approved,
    horizonMonths: obj.horizon_months, environment: obj.environment,
    businessName: obj.business_name ?? undefined,
    businessIndustry: obj.business_industry ?? undefined,
    businessCustomer: obj.business_customer ?? undefined,
    businessProblem: obj.business_problem ?? undefined,
    businessSolution: obj.business_solution ?? undefined,
    businessModel: obj.business_business_model ?? undefined,
    businessMode: obj.business_mode,
  };
  const maxExp = deps.gates?.maxSingleExperimentLoss ?? "1000000.00";
  const maxDep = deps.gates?.maxCapitalDeployment ?? "8000000.00";

  switch (job.kind) {
    // ── RESEARCHING: Kimi.research → INSERT opportunities (skor engine) → T04+T06+T07
    case "research": {
      if (obj.state !== "RESEARCHING") return { ok: true, detail: `state=${obj.state} — skip (idempoten)` };
      const cycle = await activeCycle(client, obj.id);
      const research = await deps.strategic.research({ objective: summary });
      for (const opp of research.opportunities) {
        const dup = await client.query(
          `SELECT 1 FROM opportunities WHERE cycle_id = $1 AND name = $2`, [cycle.id, opp.name]);
        if ((dup.rowCount ?? 0) === 0) await insertOpportunity(client, obj.id, cycle.id, opp);
      }
      await flushModelRuns(client, deps.strategic, cycle.id);
      const r4 = await advance(client, obj.id, "kimi_research_ok", deps);
      if (!r4.ok) return fail(r4);
      const r6 = await advance(client, obj.id, "analyze", deps);
      if (!r6.ok) return fail(r6);
      // T07 efek: tandai RANKED oleh engine (bukan LLM)
      await client.query(`UPDATE opportunities SET status = 'RANKED' WHERE cycle_id = $1`, [cycle.id]);
      const r7 = await advance(client, obj.id, "ranked", deps);
      if (!r7.ok) return fail(r7);
      // §19 Gerbang otonomi: autonomy >= 3 → AUREX memilih sendiri (rank_select);
      // autonomy <= 2 → berhenti; customer memilih via /opportunities/:oppId/select
      // atau "Let AUREX Decide" (enqueue rank_select manual).
      if (obj.autonomy_level >= 3) {
        await deps.queue.enqueue({ kind: "rank_select", objectiveId: obj.id, idem: `select:${cycle.id}` });
      } else {
        await client.query(
          `INSERT INTO events (objective_id, cycle_id, type, payload, correlation_id)
           VALUES ($1,$2,'OPPORTUNITY_AWAITING_CHOICE',$3::jsonb,gen_random_uuid())`,
          [obj.id, cycle.id, JSON.stringify({
            ranked_count: research.opportunities.length,
            message: "Opportunities siap — menunggu keputusan Anda.",
          })]);
      }
      return { ok: true, detail: `research → ${research.opportunities.length} opp → OPPORTUNITIES_RANKED${obj.autonomy_level >= 3 ? " → auto rank_select" : " → menunggu pilihan manusia"}` };
    }

    // ── OPPORTUNITIES_RANKED: Kimi.rank_select → validasi ∈ ranked (T08) → T08
    case "rank_select": {
      if (obj.state !== "OPPORTUNITIES_RANKED") return { ok: true, detail: `state=${obj.state} — skip` };
      const cycle = await activeCycle(client, obj.id);
      const ranked = await rankedList(client, cycle.id);
      const sel = await deps.strategic.rank_select({ objective: summary, opportunities: ranked });
      const chosen = ranked.find((r) => r.id === sel.selected_opportunity_id);
      if (!chosen) {
        throw new OrchestratorError("GUARD_FAILED",
          `pilihan ${sel.selected_opportunity_id} ∉ ranked list (T08) — REJECTED`);
      }
      const gatePass = !Money.parse(chosen.capitalRequired).gt(Money.parse(maxDep));
      await applyChosenSelection(client, obj, cycle.id, chosen, sel.reason, sel.assumptions, sel.confidence, gatePass, "KIMI_AUTO");
      await flushModelRuns(client, deps.strategic, cycle.id);
      const r8 = await advance(client, obj.id, "kimi_select", deps, (ctx) => ({
        ...ctx,
        selection: { inRankedList: true, capitalGatePass: gatePass },
      }));
      if (!r8.ok) return fail(r8);
      await deps.queue.enqueue({ kind: "design_experiment", objectiveId: obj.id, idem: `exp:${cycle.id}` });
      return { ok: true, detail: `select ${chosen.id} → OPPORTUNITY_SELECTED` };
    }

    // ── OPPORTUNITIES_RANKED + human choice (autonomy <= 2): pilihan customer
    //    memakai transisi T08 yang sama — guard identik, sumber keputusan berbeda.
    case "human_select": {
      if (obj.state !== "OPPORTUNITIES_RANKED") return { ok: true, detail: `state=${obj.state} — skip (idempoten)` };
      const cycle = await activeCycle(client, obj.id);
      const ranked = await rankedList(client, cycle.id);
      const chosen = ranked.find((r) => r.id === job.opportunityId);
      if (!chosen) {
        throw new OrchestratorError("GUARD_FAILED",
          `pilihan ${job.opportunityId} ∉ ranked list (T08) — REJECTED`);
      }
      const gatePass = !Money.parse(chosen.capitalRequired).gt(Money.parse(maxDep));
      await applyChosenSelection(client, obj, cycle.id, chosen, job.reason ?? "Dipilih oleh pemilik bisnis", [], null, gatePass, "HUMAN");
      const r8h = await advance(client, obj.id, "kimi_select", deps, (ctx) => ({
        ...ctx,
        selection: { inRankedList: true, capitalGatePass: gatePass },
      }));
      if (!r8h.ok) return fail(r8h);
      await deps.queue.enqueue({ kind: "design_experiment", objectiveId: obj.id, idem: `exp:${cycle.id}` });
      return { ok: true, detail: `human select ${chosen.id} → OPPORTUNITY_SELECTED` };
    }

    // ── (applyChosenSelection didefinisikan di bawah switch) ──

    // ── OPPORTUNITY_SELECTED: Kimi.designExperiment → gate budget (T09) → [SIMULATED] T10
    case "design_experiment": {
      if (obj.state !== "OPPORTUNITY_SELECTED") return { ok: true, detail: `state=${obj.state} — skip` };
      const cycle = await activeCycle(client, obj.id);
      const chosen = await selectedOpportunity(client, cycle.id);
      const spec = await deps.strategic.designExperiment({
        objective: summary, opportunity: chosen,
        policies: { maxSingleExperimentLoss: maxExp },
      });
      if (Money.parse(spec.budget).gt(Money.parse(maxExp))) {
        throw new OrchestratorError("GUARD_FAILED", `budget ${spec.budget} > MAX_SINGLE_EXPERIMENT_LOSS ${maxExp} (T09)`);
      }
      const dup = await client.query(`SELECT 1 FROM experiments WHERE cycle_id = $1`, [cycle.id]);
      if ((dup.rowCount ?? 0) === 0) {
        await client.query(
          `INSERT INTO experiments (objective_id, opportunity_id, cycle_id, hypothesis, objective,
             budget, duration_days, success_metric, success_threshold, failure_threshold,
             kill_criteria, scale_criteria, information_gain_target, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$11::jsonb,$12,'DESIGNED')`,
          [obj.id, spec.opportunity_id, cycle.id, spec.hypothesis, spec.objective, spec.budget,
           spec.duration_days, spec.success_metric, spec.success_threshold, spec.failure_threshold,
           JSON.stringify(spec.kill_criteria), spec.information_gain_target]);
      }
      await flushModelRuns(client, deps.strategic, cycle.id);
      const r9 = await advance(client, obj.id, "experiment_created", deps, (ctx) => ({
        ...ctx,
        experiment: { budget: spec.budget, maxSingleExperimentLoss: maxExp, windowComplete: false },
      }));
      if (!r9.ok) return fail(r9);
      // SIMULATED (§36): jendela pengukuran disimulasikan selesai; metrik 0 = jujur.
      await client.query(
        `UPDATE experiments SET status = 'COMPLETED', result = $2::jsonb, measured_value = 0
         WHERE cycle_id = $1`,
        [cycle.id, JSON.stringify({ simulated: true, note: "window disimulasikan; tanpa klaim sukses" })]);
      const r10 = await advance(client, obj.id, "experiment_done", deps, (ctx) => ({
        ...ctx, experiment: { budget: spec.budget, maxSingleExperimentLoss: maxExp, windowComplete: true },
      }));
      if (!r10.ok) return fail(r10);
      await deps.queue.enqueue({ kind: "design_mission", objectiveId: obj.id, idem: `mission:${cycle.id}` });
      return { ok: true, detail: `experiment → VALIDATING → RESULT_READY` };
    }

    // ── RESULT_READY: Kimi.designMission → INSERT missions+versions → T12 → T13/T14
    case "design_mission": {
      if (obj.state !== "RESULT_READY") return { ok: true, detail: `state=${obj.state} — skip` };
      const cycle = await activeCycle(client, obj.id);
      const chosen = await selectedOpportunity(client, cycle.id);
      // Siklus-1: belum ada decision Kimi (interpret_results = Phase 8) →
      // catat decision SYSTEM ITERATE sebagai rationale mission v1 (§16:
      // mission pertama mengeksekusi eksperimen terpilih, iterasi implisit).
      let decision = await latestDecisionOrNull(client, obj.id);
      if (!decision) {
        decision = await insertSystemIterateDecision(client, obj.id, cycle.id, chosen.id);
      }
      const pkg = await deps.strategic.designMission({
        objective: summary, opportunity: chosen, decision,
      });
      const budgetGatePass = !Money.parse(pkg.budget).gt(Money.parse(maxDep));
      const missionId = await insertMission(client, obj.id, chosen.id, cycle.id, pkg);
      await flushModelRuns(client, deps.strategic, cycle.id);
      const missionCtx = (approved: boolean) => (ctx: GuardContext & { cycleId: string | null }) => ({
        ...ctx,
        mission: { ...ctx.mission!, schemaValid: true, humanApproved: approved, activeExecutionCount: 0, nextVersionCreated: false, budgetGatePass },
      });
      const r12 = await advance(client, obj.id, "kimi_mission", deps, missionCtx(false));
      if (!r12.ok) return fail(r12);
      // Gerbang otonomi (T13 vs T14) — deterministik dari autonomy_level.
      if (obj.autonomy_level >= 3) {
        const r13 = await advance(client, obj.id, "approve", deps, missionCtx(false));
        if (!r13.ok) return fail(r13);
        await deps.queue.enqueue({ kind: "dispatch_glm", objectiveId: obj.id, idem: `dispatch:${missionId}:1` });
        return { ok: true, detail: `mission ${missionId} v1 → APPROVED → dispatch queued` };
      }
      await client.query(
        `INSERT INTO approvals (objective_id, category, why_required, what_will_happen,
           capital_at_risk, resume_state, payload)
         VALUES ($1,'LARGE_CAPITAL','autonomy_level < 3 — eksekusi butuh persetujuan manusia (T14)',
           'Menunggu approve/reject manusia; resume_state=MISSION_CREATED',$2,'MISSION_CREATED',$3::jsonb)`,
        [obj.id, pkg.budget, JSON.stringify({ missionId })]);
      const r14 = await advance(client, obj.id, "gate", deps, missionCtx(false));
      if (!r14.ok) return fail(r14);
      return { ok: true, detail: `mission ${missionId} → HUMAN_APPROVAL_REQUIRED (autonomy ${obj.autonomy_level})` };
    }

    // ── MISSION_APPROVED: T15 → INSERT executions → GLM → intake → T16 → T18+T19
    case "dispatch_glm": {
      let recovery = false;
      if (obj.state !== "MISSION_APPROVED") {
        // Crash-recovery: proses mati setelah T15 (state=EXECUTING) tapi sebelum
        // result intake — execution stuck RUNNING tanpa hasil. Re-drive GLM
        // idempoten: idemKey sama → ON CONFLICT DO NOTHING → execution lama
        // dipakai ulang; attempt tidak dinaikkan (eksplisit recovery, bukan retry bisnis).
        if (obj.state !== "EXECUTING") return { ok: true, detail: `state=${obj.state} — skip` };
        const stuck = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM executions e
             JOIN missions m ON e.mission_id = m.id
            WHERE m.objective_id = $1 AND e.status = 'RUNNING'
              AND NOT EXISTS (SELECT 1 FROM execution_results er WHERE er.execution_id = e.id)`,
          [obj.id]);
        if (parseInt(stuck.rows[0]?.n ?? "0", 10) === 0) {
          return { ok: true, detail: `state=EXECUTING tanpa execution RUNNING tanpa-hasil — skip` };
        }
        recovery = true;
      }
      const cycle = await activeCycle(client, obj.id);
      const { missionId, version, pkg } = await latestMission(client, obj.id);
      if (!recovery) {
        const r15 = await advance(client, obj.id, "dispatch_glm", deps, (ctx) => ({
          ...ctx, mission: { ...ctx.mission!, activeExecutionCount: 0 },
        }));
        if (!r15.ok) return fail(r15);
      }
      // §22: idempotency_key memakai identitas PAKET (pkg.mission_id) — identitas
      // yang sama yang di-echo GLM dalam result (§10-2 anti-halusinasi referensi).
      // PENTING: intake membandingkan vs identitas PAKET yang benar-benar dikirim
      // ke GLM (pkg.mission_version — bisa ≠ version baris DB bila provider
      // meng-echo identitas paket), bukan versi baris mission_versions.
      const idemKey = `${pkg.mission_id}:${version}:1`;
      const ins = await client.query<{ id: string }>(
        `INSERT INTO executions (mission_id, mission_version, cycle_id, idempotency_key, attempt, status, provider)
         VALUES ($1,$2,$3,$4,1,'RUNNING','mock')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`, [missionId, version, cycle.id, idemKey]);
      const executionId = ins.rows[0]?.id
        ?? (await client.query<{ id: string }>(
          `SELECT id FROM executions WHERE idempotency_key = $1`, [idemKey])).rows[0]!.id;
      const handle = await deps.execution.executeMission(pkg, idemKey, { executionId, cycleId: cycle.id });
      await client.query(
        `UPDATE executions SET provider_job_ref = $2, started_at = now() WHERE id = $1`,
        [executionId, handle.ref]);
      await flushModelRuns(client, deps.execution, cycle.id);
      const result = handle.result;
      if (!result) return { ok: false, detail: `provider belum mengembalikan hasil (async polling = fase berikut)` };
      const intake = intakeResult({
        result,
        execution: { missionId: pkg.mission_id, missionVersion: pkg.mission_version, executionId, status: "RUNNING" },
      });
      if (!intake.accepted) {
        await client.query(`UPDATE executions SET status = 'FAILED', finished_at = now() WHERE id = $1`, [executionId]);
        return { ok: false, detail: `RESULT_REJECTED: ${intake.reason}` };
      }
      await client.query(
        `INSERT INTO execution_results (execution_id, payload, payload_hash, schema_valid,
           verification_tier, revenue_claimed, cost_claimed)
         VALUES ($1,$2::jsonb,$3,true,$4,$5,$6)
         ON CONFLICT (execution_id) DO NOTHING`,
        [executionId, JSON.stringify(result), sha256(JSON.stringify(result)),
         intake.verificationTier, result.business_metrics.revenue, result.business_metrics.cost]);
      await client.query(`UPDATE executions SET status = 'SUCCEEDED', finished_at = now() WHERE id = $1`, [executionId]);
      const r16 = await advance(client, obj.id, "glm_result", deps, (ctx) => ({
        ...ctx, result: { schemaValid: true, partial: intake.partial },
      }));
      if (!r16.ok) return fail(r16);
      const r18 = await advance(client, obj.id, "measure_start", deps);
      if (!r18.ok) return fail(r18);
      // SIMULATED: window pengukuran pasca-eksekusi dianggap selesai (metrik tetap 0).
      const r19 = await advance(client, obj.id, "measured", deps, (ctx) => ({
        ...ctx, experiment: { budget: "0.00", maxSingleExperimentLoss: maxExp, windowComplete: true },
      }));
      if (!r19.ok) return fail(r19);
      // Analisis hasil (T20+T21) → mission manager Phase 8 — job terpisah (§11:
      // LLM tidak pernah dalam transaksi). Metrik 0 (SIMULATED) jujur.
      await deps.queue.enqueue({
        kind: "interpret_results", objectiveId: obj.id, idem: `interpret:${cycle.id}`,
      });
      return { ok: true, detail: `execution ${executionId} → EXECUTION_COMPLETED → MEASURING → RESULT_READY (interpret queued)` };
    }

    case "interpret_results":
    case "mission_next": {
      // Didelegasikan ke mission manager (Phase 8–9) via dispatcher terpisah —
      // runtime.ts bebas dependensi balik ke mission-manager.
      throw new OrchestratorError("SYSTEM_ERROR",
        `job ${job.kind} harus lewat dispatchJob() mission-manager`);
    }

    default: {
      const _x: never = job.kind;
      void _x;
      return { ok: false, detail: "job tidak dikenal" };
    }
  }
}

function fail(o: FsmOutcome): RunnerResult {
  if (o.ok) throw new Error("fail() dipanggil dengan outcome sukses — bug runner");
  return { ok: false, code: o.code, detail: `${o.code}: ${o.reason}` };
}

async function latestDecisionOrNull(
  client: PoolClient, objectiveId: string,
): Promise<DecisionRecord | null> {
  const sel = await client.query(`SELECT 1 FROM decisions WHERE objective_id = $1 LIMIT 1`, [objectiveId]);
  if ((sel.rowCount ?? 0) === 0) return null;
  return latestDecision(client, objectiveId);
}

/** Decision SYSTEM ITERATE untuk mission v1 siklus-1 (belum ada hasil terukur). */
async function insertSystemIterateDecision(
  client: PoolClient, objectiveId: string, cycleId: string, opportunityId: string,
): Promise<DecisionRecord> {
  const metrics = { expected_value_next: 0, cycle: 1 };
  await client.query(
    `INSERT INTO decisions (objective_id, cycle_id, decision, subject_type, subject_id,
       reason, evidence_ids, metrics, assumptions, confidence, decided_by)
     VALUES ($1,$2,'ITERATE','OPPORTUNITY',$3,
       'Mission v1 pertama: eksekusi eksperimen terpilih (belum ada hasil terukur — iterasi implisit)',
       $4::uuid[], $5::jsonb, $6::jsonb, 0.5000, 'SYSTEM')`,
    [objectiveId, cycleId, opportunityId, [opportunityId],
     JSON.stringify(metrics), JSON.stringify(["Belum ada hasil pengukuran — siklus pertama"])]);
  return {
    decision: "ITERATE", subject_id: opportunityId,
    reason: "Mission v1 pertama: eksekusi eksperimen terpilih",
    evidence_ids: [opportunityId], metrics, assumptions: ["siklus pertama"],
    confidence: 0.5, expected_value_next: "0.00",
  };
}

/**
 * §19 applyChosenSelection — efek samping pilihan opportunity (KIMI_AUTO maupun HUMAN):
 * tandai SELECTED, buat venture DISCOVERY bila perlu, catat event lineage
 * OPPORTUNITY_SELECTED (reason/assumptions/confidence + capital gate).
 * Dipakai bersama case "rank_select" dan "human_select" — satu jalur, guard T08 tetap
 * di advance() sehingga human choice tidak bisa bypass capital gate.
 */
async function applyChosenSelection(
  client: PoolClient, obj: ObjectiveDb, cycleId: string,
  chosen: RankedOpp, reason: string, assumptions: string[],
  confidence: number | null, gatePass: boolean, source: "KIMI_AUTO" | "HUMAN",
): Promise<void> {
  await client.query(`UPDATE opportunities SET status = 'SELECTED' WHERE id = $1`, [chosen.id]);
  // ── Phase 15 Mode B (DISCOVERY): opportunity terpilih → BUSINESS VENTURE.
  //    Objective tanpa venture mendapat identitas bisnis dari pilihan;
  //    event BUSINESS_SELECTED tercatat di lineage (business_name di payload).
  if (!obj.business_venture_id) {
    const chosenFull = (await client.query<{ name: string; customer_segment: string;
        problem: string; solution: string; business_model: string }>(
      `SELECT name, customer_segment, problem, solution, business_model
       FROM opportunities WHERE id = $1`, [chosen.id])).rows[0];
    if (chosenFull) {
      const vid = randomUUID();
      await client.query(
        `INSERT INTO business_ventures (id, user_id, name, industry, market, target_customer,
           problem, solution, business_model, price, origin, source_objective_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11)`,
        [vid, obj.user_id, chosenFull.name, obj.market, obj.market,
         chosenFull.customer_segment, chosenFull.problem, chosenFull.solution,
         chosenFull.business_model, source === "HUMAN" ? "HUMAN_SELECTED" : "KIMI_DISCOVERED", obj.id]);
      await client.query(
        `UPDATE objectives SET business_venture_id = $1 WHERE id = $2`, [vid, obj.id]);
      await client.query(
        `INSERT INTO events (objective_id, cycle_id, type, payload, correlation_id)
         VALUES ($1,$2,'BUSINESS_SELECTED',$3::jsonb,gen_random_uuid())`,
        [obj.id, cycleId, JSON.stringify({
          venture_id: vid, business_name: chosenFull.name,
          business_model: chosenFull.business_model,
          origin: source === "HUMAN" ? "HUMAN_SELECTED" : "KIMI_DISCOVERED",
        })]);
    }
  }
  // F11 fix: simpan reason + assumptions + confidence ke events (Q6 exposure).
  await client.query(
    `INSERT INTO events (objective_id, cycle_id, type, payload, correlation_id)
     VALUES ($1,$2,'OPPORTUNITY_SELECTED',$3::jsonb,gen_random_uuid())`,
    [obj.id, cycleId, JSON.stringify({
      opportunity_id: chosen.id, opportunity_name: chosen.name,
      reason, assumptions, confidence, capital_gate: gatePass, source,
    })]);
}

async function latestDecision(client: PoolClient, objectiveId: string): Promise<DecisionRecord> {
  // expected_value_next hidup di metrics jsonb (bukan kolom) — DDL §decisions
  const { rows } = await client.query<{
    decision: DecisionRecord["decision"]; subject_id: string; reason: string;
    evidence_ids: string[]; metrics: Record<string, number>; assumptions: string[];
    confidence: string;
  }>(
    `SELECT decision, subject_id, reason, evidence_ids, metrics, assumptions,
            confidence::text
     FROM decisions WHERE objective_id = $1 ORDER BY created_at DESC LIMIT 1`, [objectiveId]);
  const r = rows[0];
  if (!r) throw new OrchestratorError("SYSTEM_ERROR", `tidak ada decisions utk ${objectiveId}`);
  const ev = r.metrics["expected_value_next"];
  return {
    decision: r.decision, subject_id: r.subject_id, reason: r.reason, evidence_ids: r.evidence_ids,
    metrics: r.metrics, assumptions: r.assumptions, confidence: parseFloat(r.confidence),
    expected_value_next: typeof ev === "string" ? ev : String(ev ?? "0.00"),
  };
}

async function insertMission(
  client: PoolClient, objectiveId: string, opportunityId: string, cycleId: string, pkg: MissionPackage,
): Promise<string> {
  const ins = await client.query<{ id: string }>(
    `INSERT INTO missions (objective_id, opportunity_id, cycle_id, current_version, status)
     VALUES ($1,$2,$3,$4,'CREATED') RETURNING id`,
    [objectiveId, opportunityId, cycleId, pkg.mission_version]);
  const missionId = ins.rows[0]!.id;
  await client.query(
    `INSERT INTO mission_versions (mission_id, version, package, package_hash, created_by)
     VALUES ($1,$2,$3::jsonb,$4,'KIMI')`,
    [missionId, pkg.mission_version, JSON.stringify(pkg), sha256(JSON.stringify(pkg))]);
  return missionId;
}

async function latestMission(
  client: PoolClient, objectiveId: string,
): Promise<{ missionId: string; version: number; pkg: MissionPackage }> {
  const { rows } = await client.query<{ missionId: string; version: number; pkg: MissionPackage }>(
    `SELECT m.id AS "missionId", mv.version, mv.package AS pkg
     FROM missions m JOIN mission_versions mv ON mv.mission_id = m.id
     WHERE m.objective_id = $1 ORDER BY mv.version DESC LIMIT 1`, [objectiveId]);
  const r = rows[0];
  if (!r) throw new OrchestratorError("SYSTEM_ERROR", `tidak ada misi utk ${objectiveId}`);
  return r;
}
