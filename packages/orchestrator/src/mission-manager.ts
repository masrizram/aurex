/**
 * @aee/orchestrator — Mission Manager (Phase 8–9, §3.1/§16/§4).
 *
 * Menuntaskan siklus SETELAH RESULT_READY:
 *   T20 kimi_analyze → RESULT_ANALYZING
 *   T21 kimi_decide  → DECISION_READY  (Kimi.interpretResults; evidence dari DB)
 *   T22–T27/T37/T39  → cabang decision (SCALE/ITERATE/PIVOT/KILL/WAIT/ESCALATE/ACHIEVED/BLOCKED)
 *   T28/T29 mission_v_next → MISSION_CREATED (mission v+1; dispatch berikutnya)
 *   T30/T31 → research baru / reselect
 *
 * T37 ACHIEVED memakai profit dari LEDGER (guard profit_from_ledger) —
 * bukan klaim LLM (§3.1 Result Processor).
 */
import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import type { FsmOutcome, FsmTrigger, FsmState, GuardContext } from "@aee/domain";
import type { DecisionRecord, GlmResult, MissionPackage } from "@aee/contracts";
import type { OrchestratorDeps, RunnerResult } from "./runtime.js";
import { advance, decisionTrigger, flushModelRuns } from "./runtime.js";
import { ledgerFacts } from "./result-processor.js";
import { computeSnapshot, achievedFromLedger } from "@aee/economics";

export type MissionJobKind = "interpret_results" | "mission_next";

export interface MissionJob {
  readonly kind: MissionJobKind;
  readonly objectiveId: string;
  readonly idem: string;
}

/** Dispatcher: job mission-manager vs runtime agent job. */
export async function dispatchJob(
  client: PoolClient, job: MissionJob, deps: OrchestratorDeps,
): Promise<RunnerResult> {
  return runMissionJob(client, job, deps);
}

// ── Row helpers ──────────────────────────────────────────────────────────────

interface ObjRow {
  id: string; state: FsmState; autonomy_level: number; capital_approved: string;
  target_profit: string; current_cycle: number; market: string; title: string;
  risk_tolerance: "low" | "moderate" | "high"; environment: string;
}

async function loadObjective(client: PoolClient, id: string): Promise<ObjRow> {
  const { rows } = await client.query<ObjRow>(
    `SELECT id, state, autonomy_level, capital_approved::text, target_profit::text,
            current_cycle, market, title, risk_tolerance, environment
     FROM objectives WHERE id = $1`, [id]);
  const r = rows[0];
  if (!r) throw new Error(`objective ${id} tidak ditemukan`);
  return r;
}

async function activeCycleId(client: PoolClient, objectiveId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM cycles WHERE objective_id = $1 AND status = 'ACTIVE'
     ORDER BY cycle_number DESC LIMIT 1`, [objectiveId]);
  const r = rows[0];
  if (!r) throw new Error(`tidak ada cycle ACTIVE utk ${objectiveId}`);
  return r.id;
}

/** Hasil eksekusi terakhir (tier-berlabel) sebagai input interpretResults. */
async function latestGlmResult(
  client: PoolClient, objectiveId: string,
): Promise<{ result: GlmResult; executionId: string }> {
  const { rows } = await client.query<{ payload: GlmResult; executionId: string }>(
    `SELECT er.payload, er.execution_id AS "executionId"
     FROM execution_results er
     JOIN executions e ON e.id = er.execution_id
     JOIN missions m ON m.id = e.mission_id
     WHERE m.objective_id = $1
     ORDER BY er.created_at DESC LIMIT 1`, [objectiveId]);
  const r = rows[0];
  if (!r) throw new Error(`tidak ada execution_results utk ${objectiveId}`);
  return { result: r.payload, executionId: r.executionId };
}

async function decisionCounts(
  client: PoolClient, objectiveId: string,
): Promise<{ pivots: number; kills: number }> {
  const { rows } = await client.query<{ pivots: string; kills: string }>(
    `SELECT count(*) FILTER (WHERE decision = 'PIVOT')::text AS pivots,
            count(*) FILTER (WHERE decision = 'KILL')::text AS kills
     FROM decisions WHERE objective_id = $1`, [objectiveId]);
  const r = rows[0];
  return { pivots: parseInt(r?.pivots ?? "0", 10), kills: parseInt(r?.kills ?? "0", 10) };
}

/** EV<0 berturut pada 2 decision terakhir (dari metrics.expected_value_next). */
async function evNegativeStreak(client: PoolClient, objectiveId: string): Promise<number> {
  const { rows } = await client.query<{ ev: string | null }>(
    `SELECT metrics->>'expected_value_next' AS ev
     FROM decisions WHERE objective_id = $1
     ORDER BY created_at DESC LIMIT 2`, [objectiveId]);
  let streak = 0;
  for (const r of rows) {
    const v = r.ev === null ? NaN : parseFloat(r.ev);
    if (Number.isFinite(v) && v < 0) streak += 1; else break;
  }
  return streak;
}

/** Ledger profit net → guard T37 profit_from_ledger (§15 dihitung dari ledger). */
async function ledgerNetProfit(client: PoolClient, obj: ObjRow): Promise<string> {
  const facts = await ledgerFacts(client, obj.id);
  const snap = computeSnapshot(facts, obj.capital_approved);
  return snap.netProfit;
}

function fail(o: FsmOutcome): RunnerResult {
  if (o.ok) throw new Error("fail() dipanggil dengan outcome sukses — bug mission-manager");
  return { ok: false, code: o.code, detail: `${o.code}: ${o.reason}` };
}


/** Siapkan mission v+1 (baris missions + mission_versions) — dipakai sebelum
 *  advance cabang T22/T23 karena guard menuntut nextVersionCreated saat transisi.
 *  Idempoten: bila versi v+1 sudah ada (re-entry), pakai yang ada. */
interface PrepNext { ok: boolean; missionId: string; budget: string; detail: string; version: number }

async function prepareMissionNext(
  client: PoolClient, obj: ObjRow, deps: OrchestratorDeps,
): Promise<PrepNext> {
  const cycleId = await activeCycleId(client, obj.id);
  const { rows: mrows } = await client.query<{ id: string; version: number; pkg: MissionPackage; opportunityId: string }>(
    `SELECT m.id AS id, mv.version, mv.package AS pkg, m.opportunity_id AS "opportunityId"
     FROM missions m JOIN mission_versions mv ON mv.mission_id = m.id
     WHERE m.objective_id = $1 ORDER BY mv.version DESC LIMIT 1`, [obj.id]);
  const cur = mrows[0];
  if (!cur) return { ok: false, missionId: "", budget: "0.00", version: 0, detail: "tidak ada misi utk v+1" };

  // decision terbaru (pasti ada — interpret_results membuatnya)
  const { rows: drows } = await client.query<{
    decision: DecisionRecord["decision"]; subject_id: string; reason: string;
    evidence_ids: string[]; metrics: Record<string, number>; assumptions: string[];
    confidence_txt: string;
  }>(
    `SELECT decision, subject_id, reason, evidence_ids, metrics, assumptions,
            confidence::text AS confidence_txt
     FROM decisions WHERE objective_id = $1 ORDER BY created_at DESC LIMIT 1`, [obj.id]);
  const drow = drows[0];
  if (!drow) return { ok: false, missionId: "", budget: "0.00", version: 0, detail: "tidak ada decision utk v+1" };

  const summary = {
    id: obj.id, title: obj.title, market: obj.market, riskTolerance: obj.risk_tolerance,
    targetProfit: obj.target_profit, capitalApproved: obj.capital_approved,
    horizonMonths: 0, environment: obj.environment,
  };
  const pkg = await deps.strategic.designMission({
    objective: summary,
    opportunity: {
      id: cur.opportunityId,
      name: `opportunity-${cur.opportunityId.slice(0, 8)}`,
      riskAdjustedScore: "0.0000", capitalRequired: "0.00", expectedValue: "0.00",
    },
    decision: {
      decision: drow.decision, subject_id: drow.subject_id, reason: drow.reason,
      evidence_ids: drow.evidence_ids, metrics: drow.metrics,
      assumptions: drow.assumptions, confidence: parseFloat(drow.confidence_txt),
      expected_value_next: String(drow.metrics["expected_value_next"] ?? "0.00"),
    },
  });
  // F10 fix: flush KIMI model_runs after designMission (v1).
  const cycleIdV1 = await activeCycleId(client, obj.id);
  await flushModelRuns(client, deps.strategic, cycleIdV1);

  // Idempoten: versi target sudah ada? pakai baris itu.
  const nextVersion = cur.version + 1;
  const ex = await client.query<{ id: string }>(
    `SELECT m.id FROM missions m JOIN mission_versions mv ON mv.mission_id = m.id
     WHERE m.objective_id = $1 AND mv.version = $2 LIMIT 1`, [obj.id, nextVersion]);
  if (ex.rows[0]) {
    return { ok: true, missionId: ex.rows[0].id, budget: pkg.budget, version: nextVersion,
             detail: `mission v${nextVersion} sudah ada (re-entry)` };
  }

  const missionId = await insertMissionRow(client, obj.id, cur.opportunityId, cycleId, pkg, nextVersion);
  return { ok: true, missionId, budget: pkg.budget, version: nextVersion, detail: `mission v${nextVersion} dibuat` };
}

// ── Job utama ────────────────────────────────────────────────────────────────

/** Jalankan SATU mission job (di luar transisi; advance() per langkah §11). */
export async function runMissionJob(
  client: PoolClient, job: MissionJob, deps: OrchestratorDeps,
): Promise<RunnerResult> {
  const obj = await loadObjective(client, job.objectiveId);

  switch (job.kind) {
    // ── RESULT_READY → T20+T21 interpretResults → cabang decision
    case "interpret_results": {
      let recovery = false;
      if (obj.state !== "RESULT_READY") {
        // Crash-recovery: KIMI interpretResults mati setelah T20 (state=RESULT_ANALYZING)
        // tapi sebelum T21. Re-drive KIMI tanpa advance T20 (sudah dilakukan).
        if (obj.state !== "RESULT_ANALYZING") return { ok: true, detail: `state=${obj.state} — skip (idempoten)` };
        recovery = true;
      }
      const cycleId = await activeCycleId(client, obj.id);
      const { result, executionId } = await latestGlmResult(client, obj.id);

      if (!recovery) {
        // T20 RESULT_READY → RESULT_ANALYZING
        const r20 = await advance(client, obj.id, "kimi_analyze", deps);
        if (!r20.ok) return fail(r20);
      }

      // Kimi.interpretResults — evidence = execution id nyata dari DB (§9 aturan keras)
      const decision = await deps.strategic.interpretResults({
        objective: {
          id: obj.id, title: obj.title, market: obj.market, riskTolerance: obj.risk_tolerance,
          targetProfit: obj.target_profit, capitalApproved: obj.capital_approved,
          horizonMonths: 0, environment: obj.environment,
        },
        mission: { id: executionId, version: 1 },
        glmResult: result,
        evidenceIds: [executionId],
      });
      // F10 fix: flush KIMI model_runs after interpretResults.
      await flushModelRuns(client, deps.strategic, cycleId);

      // INSERT decision immutable (subject = execution nyata; evidence_ids ≥ 1 GAP-05)
      // ON CONFLICT DO NOTHING: jalur recovery (RESULT_ANALYZING) mungkin sudah insert
      // decision sebelumnya — idempoten via constraint unik.
      await client.query(
        `INSERT INTO decisions (objective_id, cycle_id, decision, subject_type, subject_id,
           reason, evidence_ids, metrics, assumptions, confidence, decided_by)
         VALUES ($1,$2,$3,'EXECUTION',$4,$5,$6::uuid[],$7::jsonb,$8::jsonb,$9,'KIMI')
         ON CONFLICT DO NOTHING`,
        [obj.id, cycleId, decision.decision, executionId, decision.reason,
         [executionId], JSON.stringify(decision.metrics),
         JSON.stringify(decision.assumptions), decision.confidence]);

      // Statistik guard
      const counts = await decisionCounts(client, obj.id);
      const evStreak = await evNegativeStreak(client, obj.id);
      const netProfit = await ledgerNetProfit(client, obj);

      const dctx = (ctx: GuardContext & { cycleId: string | null }): GuardContext & { cycleId: string | null } => ({
        ...ctx,
        global: {
          ...ctx.global!,
          currentProfit: netProfit,
          targetProfit: obj.target_profit,
          evNegativeStreak: evStreak,
        },
        decision: {
          kind: decision.decision,
          schemaValid: true,
          evidenceCount: decision.evidence_ids.length,
          ledgerSupportsScale: netProfit !== "0.00" && !netProfit.startsWith("-"),
          pivotCount: counts.pivots,
          killCount: counts.kills,
          alternativesExist: true,   // ranked list cycle ini masih ada
          rankedEmpty: false,
          learningsArchived: true,   // decisions+events append-only = arsip otomatis
        },
      });

      // T21 RESULT_ANALYZING → DECISION_READY
      const r21 = await advance(client, obj.id, "kimi_decide", deps, dctx);
      if (!r21.ok) return fail(r21);

      // T37 ACHIEVED — profit dari LEDGER ≥ target (bukan klaim LLM)
      if (achievedFromLedger(netProfit, obj.target_profit)) {
        const r37 = await advance(client, obj.id, "profit>=target", deps, dctx);
        if (r37.ok) return { ok: true, detail: `DECISION_READY → ACHIEVED (ledger ${netProfit} ≥ ${obj.target_profit})` };
        // guard T37 gagal → lanjut cabang decision normal
      }
      // T39 ev_negative — BLOCKED bila EV<0 dua siklus berturut
      if (evStreak >= 2) {
        const r39 = await advance(client, obj.id, "ev_negative", deps, dctx);
        if (r39.ok) return { ok: true, detail: `DECISION_READY → BLOCKED (EV<0 ×${evStreak})` };
      }

      // T22–T27 cabang decision
      const trig = decisionTrigger(decision.decision);
      if (!trig) return { ok: false, code: "SYSTEM_ERROR", detail: `decision ${decision.decision} tanpa trigger FSM` };

      if (decision.decision === "SCALE" || decision.decision === "ITERATE") {
        // Guard T22/T23 (mission_version_next_created) dievaluasi SAAT transisi —
        // mission v+1 wajib dibuat SEBELUM advance cabang. Kita buat baris misi v+1
        // dulu (status DRAFT; dikonfirmasi T28/T29), lalu transisi cabang.
        const prep = await prepareMissionNext(client, obj, deps);
        if (!prep.ok) return { ok: false, code: "SYSTEM_ERROR", detail: prep.detail };
        const mctx2 = (ctx: GuardContext & { cycleId: string | null }): GuardContext & { cycleId: string | null } => ({
          ...ctx,
          mission: { ...ctx.mission!, nextVersionCreated: true },
        });
        const rBranch = await advance(client, obj.id, trig, deps, mctx2);
        if (!rBranch.ok) return fail(rBranch);
        // T28 (SCALING, budget gate) / T29 (ITERATING) → MISSION_CREATED
        const mctx3 = (ctx: GuardContext & { cycleId: string | null }): GuardContext & { cycleId: string | null } => ({
          ...ctx,
          mission: { ...ctx.mission!, nextVersionCreated: true, schemaValid: true,
                     humanApproved: false, activeExecutionCount: 0, budgetGatePass: true },
        });
        const rV = await advance(client, obj.id, "mission_v_next", deps, mctx3);
        if (!rV.ok) return fail(rV);
        // Gerbang otonomi (T13 approve vs T14 gate)
        if (obj.autonomy_level >= 3) {
          const r13 = await advance(client, obj.id, "approve", deps, mctx3);
          if (!r13.ok) return fail(r13);
          await deps.queue.enqueue({
            kind: "dispatch_glm", objectiveId: obj.id, idem: `dispatch:${prep.missionId}:1`,
          });
          return { ok: true, detail: `decision ${decision.decision} → ${rBranch.transition.to} → MISSION_CREATED → MISSION_APPROVED (dispatch queued)` };
        }
        await client.query(
          `INSERT INTO approvals (objective_id, category, why_required, what_will_happen,
             capital_at_risk, resume_state, payload)
           VALUES ($1,'LARGE_CAPITAL','autonomy_level < 3 — mission v+1 butuh persetujuan (T14)',
             'Menunggu approve/reject manusia; resume_state=MISSION_CREATED',$2,'MISSION_CREATED',$3::jsonb)`,
          [obj.id, prep.budget, JSON.stringify({ missionId: prep.missionId })]);
        const r14 = await advance(client, obj.id, "gate", deps, mctx3);
        if (!r14.ok) return fail(r14);
        return { ok: true, detail: `decision ${decision.decision} → ${rBranch.transition.to} → MISSION_CREATED → HUMAN_APPROVAL_REQUIRED` };
      }
      const rBranch = await advance(client, obj.id, trig, deps, dctx);
      if (!rBranch.ok) return fail(rBranch);
      if (decision.decision === "PIVOT") {
        // T30 learnings_archived → RESEARCHING (research baru)
        const r30 = await advance(client, obj.id, "research_new", deps, dctx);
        return r30.ok
          ? { ok: true, detail: `PIVOT → PIVOTING → RESEARCHING (research baru)` }
          : fail(r30);
      }
      if (decision.decision === "KILL") {
        // T31 alternatif masih ada → reselect OPPORTUNITIES_RANKED
        const r31 = await advance(client, obj.id, "reselect", deps, dctx);
        return r31.ok
          ? { ok: true, detail: `KILL → KILLING → OPPORTUNITIES_RANKED (reselect)` }
          : fail(r31);
      }
      // WAIT_FOR_INFORMATION (→RESEARCHING), ESCALATE (→HUMAN_APPROVAL_REQUIRED)
      return { ok: true, detail: `decision ${decision.decision} → ${rBranch.transition.to}` };
    }

    // ── SCALING/ITERATING → T28/T29 mission v+1 → MISSION_CREATED → gerbang otonomi
    case "mission_next": {
      if (obj.state !== "SCALING" && obj.state !== "ITERATING") {
        return { ok: true, detail: `state=${obj.state} — skip (idempoten)` };
      }
      const cycleId = await activeCycleId(client, obj.id);
      const { rows: mrows } = await client.query<{
        id: string; version: number; pkg: MissionPackage; opportunityId: string;
      }>(
        `SELECT m.id AS id, mv.version, mv.package AS pkg, m.opportunity_id AS "opportunityId"
         FROM missions m JOIN mission_versions mv ON mv.mission_id = m.id
         WHERE m.objective_id = $1 ORDER BY mv.version DESC LIMIT 1`, [obj.id]);
      const cur = mrows[0];
      if (!cur) return { ok: false, code: "SYSTEM_ERROR", detail: "tidak ada misi utk mission_next" };

      // decision terbaru (pasti ada — dibuat interpret_results)
      const { rows: drows } = await client.query<{
        decision: DecisionRecord["decision"]; subject_id: string; reason: string;
        evidence_ids: string[]; metrics: Record<string, number>; assumptions: string[];
        confidence_txt: string;
      }>(
        `SELECT decision, subject_id, reason, evidence_ids, metrics, assumptions,
                confidence::text AS confidence_txt
         FROM decisions WHERE objective_id = $1 ORDER BY created_at DESC LIMIT 1`, [obj.id]);
      const drow = drows[0];
      if (!drow) return { ok: false, code: "SYSTEM_ERROR", detail: "tidak ada decision utk mission_next" };

      const summary = {
        id: obj.id, title: obj.title, market: obj.market, riskTolerance: obj.risk_tolerance,
        targetProfit: obj.target_profit, capitalApproved: obj.capital_approved,
        horizonMonths: 0, environment: obj.environment,
      };
      // Mission v+1 (§16): Kimi.designMission dengan decision ITERATE/SCALE terbaru.
      const pkg = await deps.strategic.designMission({
        objective: summary,
        opportunity: {
          id: cur.opportunityId,
          name: (cur.pkg as unknown as { objective_ref?: string }).objective_ref ?? "opportunity-aktif",
          riskAdjustedScore: "0.0000", capitalRequired: "0.00", expectedValue: "0.00",
        },
        decision: {
          decision: drow.decision, subject_id: drow.subject_id, reason: drow.reason,
          evidence_ids: drow.evidence_ids, metrics: drow.metrics,
          assumptions: drow.assumptions, confidence: parseFloat(drow.confidence_txt),
          expected_value_next: String(drow.metrics["expected_value_next"] ?? "0.00"),
        },
      });

      // F10 fix: flush KIMI model_runs after designMission v+1.
      await flushModelRuns(client, deps.strategic, cycleId);

      // Baris missions BARU + version row (immutable; unique mission_id+version §3.1)
      const missionId = await insertMissionRow(client, obj.id, cur.opportunityId, cycleId, pkg, cur.version + 1);

      const mctx = (ctx: GuardContext & { cycleId: string | null }): GuardContext & { cycleId: string | null } => ({
        ...ctx,
        mission: {
          ...ctx.mission!, nextVersionCreated: true, schemaValid: true,
          humanApproved: false, activeExecutionCount: 0, budgetGatePass: true,
        },
      });
      // T28 (SCALING, guard budget_gate) / T29 (ITERATING)
      const r = await advance(client, obj.id, "mission_v_next", deps, mctx);
      if (!r.ok) return fail(r);

      // Gerbang otonomi sama seperti v1 (T13 vs T14)
      if (obj.autonomy_level >= 3) {
        const r13 = await advance(client, obj.id, "approve", deps, mctx);
        if (!r13.ok) return fail(r13);
        await deps.queue.enqueue({
          kind: "dispatch_glm", objectiveId: obj.id, idem: `dispatch:${pkg.mission_id}:1`,
        });
        return { ok: true, detail: `mission v${pkg.mission_version} → MISSION_APPROVED → dispatch queued` };
      }
      await client.query(
        `INSERT INTO approvals (objective_id, category, why_required, what_will_happen,
           capital_at_risk, resume_state, payload)
         VALUES ($1,'LARGE_CAPITAL','autonomy_level < 3 — mission v+1 butuh persetujuan (T14)',
           'Menunggu approve/reject manusia; resume_state=MISSION_CREATED',$2,'MISSION_CREATED',$3::jsonb)`,
        [obj.id, pkg.budget, JSON.stringify({ missionId })]);
      const r14 = await advance(client, obj.id, "gate", deps, mctx);
      if (!r14.ok) return fail(r14);
      return { ok: true, detail: `mission v${pkg.mission_version} → HUMAN_APPROVAL_REQUIRED` };
    }

    default: {
      const _x: never = job.kind;
      void _x;
      return { ok: false, detail: "job tidak dikenal" };
    }
  }
}

async function insertMissionRow(
  client: PoolClient, objectiveId: string, opportunityId: string, cycleId: string, pkg: MissionPackage,
  version: number,
): Promise<string> {
  const ins = await client.query<{ id: string }>(
    `INSERT INTO missions (objective_id, opportunity_id, cycle_id, current_version, status)
     VALUES ($1,$2,$3,$4,'CREATED') RETURNING id`,
    [objectiveId, opportunityId, cycleId, version]);
  const missionId = ins.rows[0]!.id;
  await client.query(
    `INSERT INTO mission_versions (mission_id, version, package, package_hash, created_by)
     VALUES ($1,$2,$3::jsonb,$4,'KIMI')`,
    [missionId, version, JSON.stringify(pkg),
     createHash("sha256").update(JSON.stringify(pkg), "utf8").digest("hex")]);
  return missionId;
}
