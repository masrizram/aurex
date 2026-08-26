/**
 * @aee/api — rute objectives: create/list/detail, start/stop/abort/retry,
 * opportunity actions §19 (select/save/reject/let-aurex-decide), reads
 * experiments/missions/results/economics, decisions & events.
 * (Diekstrak verbatim dari index.ts saat split §12/§13.)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { advance, type AgentJobKind } from "@aee/orchestrator/runtime";
import { CreateVentureRequestSchema } from "@aee/contracts";
import { ApiError, checkAiCreditsAvailable, checkObjectiveQuota, type RouteCtx } from "../context.js";
import { getOrgForUser } from "../auth.js";
import { buildScenarios } from "@aee/economics";
import { Decimal } from "decimal.js";

const CreateObjectiveSchema = z.object({
  title: z.string().min(3).max(200),
  business_mode: z.enum(["GIVEN", "DISCOVERY"]).default("DISCOVERY"),
  business_venture_id: z.string().uuid().optional(),     // mode GIVEN: venture existing
  business: CreateVentureRequestSchema.optional(),       // mode GIVEN: definisi inline
  assets: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  goal_type: z.enum(["increase_profit", "reduce_cost", "find_opportunities", "launch_new", "improve_growth"]).optional(), // G4: customer intent
  target_profit: z.string().regex(/^\d+(\.\d{1,2})?$/, "MoneyString '1000000.00'"),
  capital_approved: z.string().regex(/^\d+(\.\d{1,2})?$/),
  horizon_months: z.number().int().min(1).max(60),
  market: z.string().min(2).max(100),
  risk_tolerance: z.enum(["low", "moderate", "high"]),
  autonomy_level: z.number().int().min(0).max(4).optional(),
  environment: z.enum(["SIMULATED", "TEST", "REAL"]).optional(),
}).strict();

const StopSchema = z.object({ reason: z.string().min(3).max(500) }).strict();

/** Daftarkan rute objectives + opportunities + product reads. */
export function registerObjectivesRoutes(app: FastifyInstance, ctx: RouteCtx): void {
  const { withClient, requireRole, parseBody, requireOwnedObjective, idemKey } = ctx;
  const opts = ctx;
  app.post<{ Body: unknown }>("/objectives", async (req, reply) => {
    return withClient(async (client, session) => {
      requireRole(session, "owner");
      const body = parseBody(CreateObjectiveSchema, req.body);
      const key = idemKey(req);
      if (!key) throw new ApiError(400, "VALIDATION_ERROR", "header Idempotency-Key wajib");
      // G2: Entitlement check — D1 fix: satu helper quota untuk semua jalur create.
      const org = await getOrgForUser(client, session.userId);
      if (!org) throw new ApiError(404, "NOT_FOUND", "organization tidak ditemukan");
      await checkObjectiveQuota(client, session.userId, org.id, org.planTier);
      // Idempotensi §7 idempotency_keys: key PK; hash beda → CONFLICT;
      // hash sama → replay response tersimpan (status DONE).
      // Hash dari body MENTAH (req.body) — bukan hasil Zod — sehingga key order = client order.
      const hash = createHash("sha256").update(JSON.stringify(req.body), "utf8").digest("hex");
      const prev = await client.query<{ request_hash: string; response: unknown }>(
        `SELECT request_hash, response FROM idempotency_keys WHERE key = $1`, [key]);
      if (prev.rows[0]) {
        if (prev.rows[0].request_hash !== hash) {
          throw new ApiError(409, "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key sama dipakai untuk body berbeda");
        }
        return void reply.status(200).send(prev.rows[0].response ?? { replay: true });
      }
      // ── Business identity (Phase 15): Mode GIVEN = venture di-resolve/insert;
      //    Mode DISCOVERY = venture dipilih Kimi di rank_select (event BUSINESS_SELECTED).
      let ventureId: string | null = null;
      if (body.business_mode === "GIVEN") {
        if (body.business_venture_id) {
          const v = await client.query<{ id: string }>(
            `SELECT id FROM business_ventures WHERE id = $1 AND user_id = $2`,
            [body.business_venture_id, session.userId]);
          if (!v.rows[0]) throw new ApiError(404, "NOT_FOUND", "venture tidak ada / bukan milik user");
          ventureId = v.rows[0].id;
        } else if (body.business) {
          const vid = randomUUID();
          await client.query(
            `INSERT INTO business_ventures (id, user_id, name, industry, market, target_customer,
               problem, solution, business_model, price, origin)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'USER')`,
            [vid, session.userId, body.business.name, body.business.industry,
             body.business.market, body.business.target_customer, body.business.problem,
             body.business.solution, body.business.business_model, body.business.price ?? null]);
          ventureId = vid;
        } else {
          throw new ApiError(400, "VALIDATION_ERROR",
            "mode GIVEN wajib menyertakan business_venture_id atau business");
        }
      }
      const objId = randomUUID();
      await client.query(
        `INSERT INTO objectives (id, user_id, organization_id, title, target_profit, capital_approved, horizon_months,
           deadline, market, risk_tolerance, autonomy_level, state, current_cycle, environment,
           business_venture_id, business_mode, goal_type)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,'OBJECTIVE_CREATED',0,$11,$12,$13,$14)`,
                   [objId, session.userId, org.id, body.title, body.target_profit, body.capital_approved,
                    body.horizon_months, body.market, body.risk_tolerance,
                    body.autonomy_level ?? 1, body.environment ?? "SIMULATED",
                    ventureId, body.business_mode, body.goal_type ?? null]);
      const respBody = { id: objId, state: "OBJECTIVE_CREATED", row_version: 1 };
      await client.query(
        `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, response, status)
         VALUES ($1,$2,'POST /objectives',$3,$4::jsonb,'DONE')`,
        [key, session.userId, hash, JSON.stringify(respBody)]);
      return void reply.status(201).send(respBody);
    }, req);
  });

  app.get<{ Params: { id: string } }>("/objectives/:id", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      await requireOwnedObjective(client, req.params.id, session);
      const o = (await client.query(
        `SELECT o.id, o.title, o.state, o.row_version, o.current_cycle, o.autonomy_level,
                o.target_profit::text AS target_profit, o.capital_approved::text AS capital_approved,
                o.horizon_months, o.market, o.risk_tolerance, o.business_mode, o.environment,
                o.goal_type,
                v.id AS venture_id, v.name AS venture_name, v.industry AS venture_industry,
                v.market AS venture_market, v.target_customer AS venture_target_customer,
                v.problem AS venture_problem, v.solution AS venture_solution,
                v.business_model AS venture_business_model, v.price AS venture_price,
                v.origin AS venture_origin
         FROM objectives o
         LEFT JOIN business_ventures v ON v.id = o.business_venture_id
         WHERE o.id = $1 AND o.user_id = $2`, [req.params.id, session.userId])).rows[0];
      if (!o) throw new ApiError(404, "NOT_FOUND", `objective ${req.params.id} tidak ada`);
      // ── Strategic state: opportunity terpilih + hipotesis eksperimen aktif
      const strat = (await client.query(
        `SELECT opp.name AS opportunity_name,
                COALESCE(ex.hypothesis, opp.problem) AS hypothesis
         FROM cycles c
         LEFT JOIN opportunities opp ON opp.cycle_id = c.id AND opp.status = 'SELECTED'
         LEFT JOIN experiments ex ON ex.cycle_id = c.id
         WHERE c.objective_id = $1 AND c.status = 'ACTIVE'
         ORDER BY ex.created_at DESC NULLS LAST LIMIT 1`, [req.params.id])).rows[0] ?? null;
      // ── Execution state: mission + execution terakhir (judul dari package JSONB)
      const exec = (await client.query(
        `SELECT m.id AS mission_id, mv.package->>'title' AS mission_title,
                e.status AS execution_status, e.provider AS execution_provider
         FROM missions m
         LEFT JOIN mission_versions mv ON mv.mission_id = m.id AND mv.version = m.current_version
         LEFT JOIN executions e ON e.mission_id = m.id
         WHERE m.objective_id = $1
         ORDER BY m.created_at DESC, e.started_at DESC NULLS LAST LIMIT 1`, [req.params.id])).rows[0] ?? null;
      // ── Last Kimi decision
      const dec = (await client.query(
        `SELECT decision, reason, confidence::text AS confidence, decided_by
         FROM decisions WHERE objective_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.params.id])).rows[0] ?? null;
      const snap = (await client.query(
        `SELECT revenue::text, cogs::text, gross_profit::text, gross_margin::text,
                opex::text, operating_profit::text, capital_deployed::text,
                capital_remaining::text, drawdown::text, roi::text, created_at
         FROM economic_snapshots WHERE objective_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [req.params.id])).rows[0] ?? null;
      // ── Nilai TERVERIFIKASI (ledger RECONCILED saja — Rule 4/§5) ──
      const ver = (await client.query<{ verified_revenue: string; verified_cost: string }>(
        `SELECT COALESCE(sum(amount) FILTER (WHERE credit_account='REVENUE'),0)::text AS verified_revenue,
                COALESCE(sum(amount) FILTER (WHERE debit_account='COGS'),0)::text AS verified_cost
         FROM capital_transactions
         WHERE objective_id = $1 AND verification_tier = 'RECONCILED'`, [req.params.id])).rows[0]
        ?? { verified_revenue: "0", verified_cost: "0" };
      // ── Hitungan entitas lifecycle untuk tab + traceability (§28) ──
      const counts = (await client.query<{
        opportunities: number; experiments: number; missions: number;
        decisions: number; results: number; approvals_pending: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM opportunities WHERE objective_id = $1) AS opportunities,
           (SELECT count(*)::int FROM experiments WHERE objective_id = $1) AS experiments,
           (SELECT count(*)::int FROM missions WHERE objective_id = $1) AS missions,
           (SELECT count(*)::int FROM decisions WHERE objective_id = $1) AS decisions,
           (SELECT count(*)::int FROM execution_results er
              JOIN executions ex ON ex.id = er.execution_id
              JOIN missions m ON m.id = ex.mission_id WHERE m.objective_id = $1) AS results,
           (SELECT count(*)::int FROM approvals WHERE objective_id = $1 AND status = 'PENDING') AS approvals_pending`,
        [req.params.id])).rows[0]
        ?? { opportunities: 0, experiments: 0, missions: 0, decisions: 0, results: 0, approvals_pending: 0 };
      // ── Timestamp lifecycle: created_at + deadline turunan horizon ──
      const objTimes = (await client.query<{ created_at: string; deadline: string | null }>(
        `SELECT created_at::text AS created_at,
                deadline::text AS deadline
         FROM objectives WHERE id = $1`, [req.params.id])).rows[0]
        ?? { created_at: null as unknown as string, deadline: null };
      return {
        objective: {
          id: o.id, title: o.title, state: o.state, row_version: o.row_version,
          current_cycle: o.current_cycle, autonomy_level: o.autonomy_level,
          target_profit: o.target_profit, capital_approved: o.capital_approved,
          horizon_months: o.horizon_months, market: o.market,
          risk_tolerance: o.risk_tolerance, business_mode: o.business_mode,
          environment: o.environment ?? "SIMULATED",
          goal_type: o.goal_type ?? null,
          created_at: objTimes.created_at,
          deadline: objTimes.deadline,
        },
        business: o.venture_id ? {
          id: o.venture_id, name: o.venture_name, industry: o.venture_industry,
          market: o.venture_market, target_customer: o.venture_target_customer,
          problem: o.venture_problem, solution: o.venture_solution,
          business_model: o.venture_business_model, price: o.venture_price,
          origin: o.venture_origin,
        } : null,
        strategy: strat,
        execution: exec,
        last_decision: dec,
        snapshot: snap,
        verified: {
          revenue: ver.verified_revenue,
          cost: ver.verified_cost,
        },
        counts,
      };
    }, req),
  );

  // ── GET /objectives/:id/opportunities — semua opportunity di cycle aktif (dashboard Q7)
  app.get<{ Params: { id: string } }>("/objectives/:id/opportunities", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      await requireOwnedObjective(client, req.params.id, session);
      const rows = (await client.query(
        `SELECT opp.id, opp.name, opp.status, opp.customer_segment, opp.problem, opp.solution,
                opp.business_model, opp.price::text AS price,
                opp.revenue_potential::text AS revenue_potential,
                opp.cost_estimate::text AS cost_estimate, opp.margin::text AS margin,
                opp.capital_required::text AS capital_required,
                opp.time_to_revenue_days,
                opp.demand_score, opp.willingness_to_pay_score, opp.profitability_score,
                opp.scalability_score, opp.defensibility_score, opp.execution_feasibility_score,
                opp.evidence_strength_score, opp.time_to_revenue_score,
                opp.risk_score, opp.opportunity_score, opp.risk_adjusted_score,
                opp.probability_of_success::text AS probability_of_success,
                opp.expected_value::text AS expected_value,
                opp.assumptions, opp.unknowns
         FROM cycles c
         JOIN opportunities opp ON opp.cycle_id = c.id
         JOIN objectives ob ON ob.id = c.objective_id
         WHERE c.objective_id = $1 AND c.status = 'ACTIVE' AND ob.user_id = $2
         ORDER BY opp.status DESC, opp.risk_adjusted_score DESC LIMIT 20`,
        [req.params.id, session.userId])).rows;
      return { opportunities: rows };
    }, req),
  );

  app.post<{ Params: { id: string }; Body: unknown }>("/objectives/:id/start", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "owner");
      await requireOwnedObjective(client, req.params.id, session);
      // G9: AI usage pre-check — jangan jalankan model kalau credit habis.
      const orgS = await getOrgForUser(client, session.userId);
      if (orgS) await checkAiCreditsAvailable(client, orgS.id, 1);
      const r = await advance(client, req.params.id, "normalize", opts.deps);
      if (!r.ok) throw new ApiError(409, "STATE_VIOLATION", r.reason);
      const r2 = await advance(client, req.params.id, "start_research", opts.deps);
      if (!r2.ok) throw new ApiError(409, "STATE_VIOLATION", r2.reason);
      const cyc = (await client.query<{ id: string }>(
        `SELECT id FROM cycles WHERE objective_id=$1 AND status='ACTIVE'`, [req.params.id])).rows[0];
      return { cycle_id: cyc?.id ?? null };
    }, req),
  );

  app.post<{ Params: { id: string }; Body: unknown }>("/objectives/:id/stop", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "owner");
      await requireOwnedObjective(client, req.params.id, session);
      const body = parseBody(StopSchema, req.body ?? {});
      const r = await advance(client, req.params.id, "stop_objective", opts.deps);
      if (!r.ok) throw new ApiError(409, "STATE_VIOLATION", r.reason);
      return { id: req.params.id, state: "STOPPED", reason: body.reason };
    }, req),
  );

  // F15: Abort endpoint — sama dengan /stop tapi eksplisit untuk stuck objectives.
  // Bisa dari state non-terminal apapun (T38 from: "*").
  app.post<{ Params: { id: string }; Body: unknown }>("/objectives/:id/abort", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "owner");
      await requireOwnedObjective(client, req.params.id, session);
      const body = parseBody(StopSchema, req.body ?? {});
      const r = await advance(client, req.params.id, "stop_objective", opts.deps);
      if (!r.ok) throw new ApiError(409, "STATE_VIOLATION", r.reason);
      await client.query(
        `INSERT INTO events (objective_id, cycle_id, type, payload, correlation_id)
         VALUES ($1, NULL, 'ABORTED', $2::jsonb, gen_random_uuid())`,
        [req.params.id, JSON.stringify({ reason: body.reason, ts: new Date().toISOString() })]);
      return { id: req.params.id, state: "STOPPED", reason: body.reason };
    }, req),
  );

  // ═══ Retry failed stage (P0: error recovery — re-enqueue agent job after AGENT_ERROR) ═══

  app.post<{ Params: { id: string } }>("/objectives/:id/retry", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "owner");
      await requireOwnedObjective(client, req.params.id, session);
      const obj = (await client.query<{ state: string; current_cycle: number }>(
        `SELECT state, current_cycle FROM objectives WHERE id = $1`, [req.params.id])).rows[0];
      if (!obj) throw new ApiError(404, "NOT_FOUND", `objective ${req.params.id} tidak ada`);
      // Tentukan stage berdasarkan state SAAT INI (bukan event error terakhir).
      // State menengah (EXECUTING, RESULT_ANALYZING) = crash-recovery; state awal
      // (RESEARCHING, RESULT_READY) = re-drive dari awal.
      const STATE_TO_KIND: Record<string, AgentJobKind> = {
        RESEARCHING: "research",
        RANKING: "rank_select",
        SELECTING: "rank_select",
        EXPERIMENT_DESIGNED: "design_experiment",
        RESULT_READY: "design_mission",
        MISSION_APPROVED: "dispatch_glm",
        EXECUTING: "dispatch_glm",
        RESULT_ANALYZING: "interpret_results",
      };
      const kind = STATE_TO_KIND[obj.state]
        ?? (await client.query<{ payload: { kind: string } }>(
            `SELECT payload FROM events WHERE objective_id = $1 AND type = 'AGENT_ERROR'
             ORDER BY created_at DESC LIMIT 1`, [req.params.id])).rows[0]?.payload.kind as AgentJobKind
        ?? null;
      if (!kind) throw new ApiError(409, "CONFLICT", `objective ${req.params.id} state=${obj.state} tidak punya stage retry yang dipetakan`);
      // Re-enqueue the failed job
      await opts.deps.queue.enqueue({
        kind,
        objectiveId: req.params.id,
        idem: `retry:${req.params.id}:${kind}:${Date.now()}`,
      });
      // Insert event for audit trail
      await client.query(
        `INSERT INTO events (objective_id, cycle_id, type, payload, correlation_id)
         VALUES ($1, NULL, 'RETRY_REQUESTED', $2::jsonb, gen_random_uuid())`,
        [req.params.id, JSON.stringify({ kind, ts: new Date().toISOString() })]);
      return { id: req.params.id, retried: kind, state: obj.state };
    }, req),
  );

  // ═══ Opportunity actions §19 (autonomy <= 2): Select / Reject / Save / Let AUREX decide ═══

  // ── POST /objectives/:id/opportunities/:oppId/select — customer memilih sendiri ──
  app.post<{ Params: { id: string; oppId: string }; Body: unknown }>(
    "/objectives/:id/opportunities/:oppId/select",
    async (req) =>
      withClient(async (client, session) => {
        requireRole(session, "owner");
        await requireOwnedObjective(client, req.params.id, session);
        const obj = (await client.query<{ state: string; autonomy_level: number }>(
          `SELECT state, autonomy_level FROM objectives WHERE id = $1`, [req.params.id])).rows[0];
        if (!obj) throw new ApiError(404, "NOT_FOUND", "objective tidak ada");
        if (obj.state !== "OPPORTUNITIES_RANKED") {
          throw new ApiError(409, "STATE_VIOLATION",
            `objective state=${obj.state} — pilihan hanya tersedia saat opportunities siap`);
        }
        const body = parseBody(z.object({ reason: z.string().max(500).optional() }).strict(), req.body ?? {});
        await opts.deps.queue.enqueue({
          kind: "human_select", objectiveId: req.params.id,
          idem: `human:${req.params.id}:${req.params.oppId}`,
          opportunityId: req.params.oppId, reason: body.reason,
        });
        return { queued: true, objective: req.params.id, opportunity: req.params.oppId, source: "HUMAN" };
      }, req),
  );

  // ── POST /objectives/:id/let-aurex-decide — delegasi pilihan ke KIMI (§19) ──
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/objectives/:id/let-aurex-decide",
    async (req) =>
      withClient(async (client, session) => {
        requireRole(session, "owner");
        await requireOwnedObjective(client, req.params.id, session);
        const obj = (await client.query<{ state: string }>(
          `SELECT state FROM objectives WHERE id = $1`, [req.params.id])).rows[0];
        if (!obj) throw new ApiError(404, "NOT_FOUND", "objective tidak ada");
        if (obj.state !== "OPPORTUNITIES_RANKED") {
          throw new ApiError(409, "STATE_VIOLATION",
            `objective state=${obj.state} — pilihan hanya tersedia saat opportunities siap`);
        }
        await opts.deps.queue.enqueue({
          kind: "rank_select", objectiveId: req.params.id,
          idem: `select:${req.params.id}:${Date.now()}`,
        });
        return { queued: true, objective: req.params.id, source: "KIMI_AUTO" };
      }, req),
  );

  // ── POST /objectives/:id/opportunities/:oppId/save — simpan untuk nanti ──
  app.post<{ Params: { id: string; oppId: string }; Body: unknown }>(
    "/objectives/:id/opportunities/:oppId/save",
    async (req) =>
      withClient(async (client, session) => {
        requireRole(session, "owner");
        await requireOwnedObjective(client, req.params.id, session);
        const body = parseBody(z.object({ note: z.string().max(500).optional() }).strict(), req.body ?? {});
        const obj = (await client.query<{ state: string }>(
          `SELECT state FROM objectives WHERE id = $1`, [req.params.id])).rows[0];
        if (!obj) throw new ApiError(404, "NOT_FOUND", "objective tidak ada");
        if (obj.state !== "OPPORTUNITIES_RANKED") {
          throw new ApiError(409, "STATE_VIOLATION",
            `objective state=${obj.state} — pilihan hanya tersedia saat opportunities siap`);
        }
        const upd = await client.query(
          `UPDATE opportunities SET status = 'SAVED' WHERE id = $1 AND objective_id = $2 AND status = 'RANKED'`,
          [req.params.oppId, req.params.id]);
        if (upd.rowCount === 0) {
          throw new ApiError(404, "NOT_FOUND", `opportunity ${req.params.oppId} tidak ada/bukan RANKED`);
        }
        await client.query(
          `INSERT INTO events (objective_id, cycle_id, type, payload, correlation_id)
           SELECT $1, c.id, 'OPPORTUNITY_SAVED', $2::jsonb, gen_random_uuid()
           FROM cycles c WHERE c.objective_id = $1 AND c.status = 'ACTIVE'`,
          [req.params.id, JSON.stringify({
            opportunity_id: req.params.oppId,
            note: body.note ?? "", saved_by: session.userId,
          })]);
        return { saved: true, opportunity: req.params.oppId };
      }, req),
  );

  // ── POST /objectives/:id/opportunities/:oppId/reject — customer menolak ──
  app.post<{ Params: { id: string; oppId: string }; Body: unknown }>(
    "/objectives/:id/opportunities/:oppId/reject",
    async (req) =>
      withClient(async (client, session) => {
        requireRole(session, "owner");
        await requireOwnedObjective(client, req.params.id, session);
        const body = parseBody(z.object({ reason: z.string().max(500).optional() }).strict(), req.body ?? {});
        const obj = (await client.query<{ state: string }>(
          `SELECT state FROM objectives WHERE id = $1`, [req.params.id])).rows[0];
        if (!obj) throw new ApiError(404, "NOT_FOUND", "objective tidak ada");
        if (obj.state !== "OPPORTUNITIES_RANKED") {
          throw new ApiError(409, "STATE_VIOLATION",
            `objective state=${obj.state} — pilihan hanya tersedia saat opportunities siap`);
        }
        await client.query(
          `UPDATE opportunities SET status = 'REJECTED' WHERE id = $1 AND objective_id = $2`,
          [req.params.oppId, req.params.id]);
        await client.query(
          `INSERT INTO events (objective_id, cycle_id, type, payload, correlation_id)
           SELECT $1, c.id, 'OPPORTUNITY_REJECTED', $2::jsonb, gen_random_uuid()
           FROM cycles c WHERE c.objective_id = $1 AND c.status = 'ACTIVE'`,
          [req.params.id, JSON.stringify({
            opportunity_id: req.params.oppId,
            reason: body.reason ?? "", rejected_by: session.userId,
          })]);
        return { rejected: true, opportunity: req.params.oppId };
      }, req),
  );

  // ═══ Reads (auditor+) ═══

  app.get<{ Params: { id: string } }>("/decisions", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      const q = req.query as { objective_id?: string };
      if (!q.objective_id) throw new ApiError(422, "VALIDATION_ERROR", "query objective_id wajib");
      await requireOwnedObjective(client, q.objective_id, session);
      const rows = (await client.query(
        `SELECT d.id, d.decision, d.reason, d.confidence::text, d.evidence_ids, d.decided_by, d.created_at
         FROM decisions d
         JOIN objectives o ON o.id = d.objective_id
         WHERE d.objective_id = $1 AND o.user_id = $2
         ORDER BY d.created_at DESC LIMIT 100`,
        [q.objective_id, session.userId])).rows;
      return { decisions: rows };
    }, req),
  );

  app.get("/events", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      // objective_id OPSIONAL (§16 master prompt): timeline ekonomi lintas
      // objective untuk Overview/Activity. Tenant scope tetap via o.user_id.
      const q = req.query as { objective_id?: string; limit?: string };
      const limitRaw = Number(q.limit ?? "100");
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100;
      const rows = (await client.query(
        `SELECT e.id, e.objective_id, e.type AS event_type, e.type, e.payload, e.created_at,
                o.title AS objective_title
         FROM events e
         JOIN objectives o ON o.id = e.objective_id
         WHERE ($1::uuid IS NULL OR e.objective_id = $1::uuid) AND o.user_id = $2
         ORDER BY e.created_at DESC LIMIT ${limit}`,
        [q.objective_id ?? null, session.userId])).rows;
      return { events: rows };
    }, req),
  );
  // ── GET /objectives (list; §8 auditor+) + snapshot terbaru ────────────────
  app.get("/objectives", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      const rows = (await client.query(
        `SELECT o.id, o.title, o.state, o.target_profit::text AS target_profit,
                o.created_at, o.row_version, o.business_mode,
                v.name AS business_name, v.industry AS business_industry,
                v.target_customer AS business_customer
         FROM objectives o
         LEFT JOIN business_ventures v ON v.id = o.business_venture_id
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC LIMIT 50`, [session.userId])).rows;
      const snaps = (await client.query(
        `SELECT s.objective_id, s.revenue::text AS revenue,
                s.gross_profit::text AS gross_profit, s.operating_profit::text AS operating_profit,
                s.roi::text AS roi, s.capital_deployed::text AS capital_deployed,
                s.cac::text AS cac, s.ltv::text AS ltv, s.ltv_cac::text AS ltv_cac,
                s.created_at
         FROM economic_snapshots s
         WHERE s.id IN (SELECT DISTINCT ON (objective_id) id
                        FROM economic_snapshots ORDER BY objective_id, created_at DESC)`)).rows;
      const byObj = new Map(snaps.map((r: Record<string, unknown>) => [r.objective_id, r]));
      return {
        objectives: rows.map((o: Record<string, unknown>) => ({
          ...o,
          snapshot: {
            ...(byObj.get(o.id as string) ?? {}),
            target_profit: o.target_profit,
          },
        })),
      };
    }, req),
  );

  // ── GET /overview — Economic Control Center aggregate (§2 master prompt) ───
  // Satu round-trip untuk scoreboard + trajectory + attention queue Overview.
  // SEMUA angka ekonomi berasal dari economic_snapshots TURUNAN LEDGER atau
  // capital_transactions RECONCILED — tidak ada klaim LLM di jalur ini (Rule 4).
  app.get("/overview", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      const uid = session.userId;

      // 1. Objectives ringkas
      const { rows: objectives } = await client.query(
        `SELECT o.id, o.title, o.state, o.business_mode, o.environment,
                o.target_profit::text AS target_profit,
                o.capital_approved::text AS capital_approved,
                o.current_cycle, o.row_version,
                o.created_at::text AS created_at,
                v.name AS business_name
         FROM objectives o
         LEFT JOIN business_ventures v ON v.id = o.business_venture_id
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC LIMIT 50`, [uid]);

      // 2. Snapshot seri (trajectory) — kronologis, dibatasi agar payload wajar
      const { rows: snapRows } = await client.query(
        `SELECT s.objective_id, o.title AS objective_title,
                s.revenue::text AS revenue, s.cogs::text AS cogs,
                s.gross_profit::text AS gross_profit, s.gross_margin::text AS gross_margin,
                s.opex::text AS opex, s.operating_profit::text AS operating_profit,
                s.capital_deployed::text AS capital_deployed,
                s.capital_remaining::text AS capital_remaining,
                s.drawdown::text AS drawdown, s.roi::text AS roi,
                s.created_at::text AS created_at
         FROM economic_snapshots s
         JOIN objectives o ON o.id = s.objective_id
         WHERE o.user_id = $1
         ORDER BY s.objective_id, s.created_at ASC
         LIMIT 600`, [uid]);

      // 3. Nilai TERVERIFIKASI: hanya ledger ber-tier RECONCILED (bukti pembayaran)
      const ver = (await client.query<{ verified_revenue: string; verified_cost: string }>(
        `SELECT COALESCE(sum(t.amount) FILTER (WHERE t.credit_account='REVENUE'),0)::text AS verified_revenue,
                COALESCE(sum(t.amount) FILTER (WHERE t.debit_account='COGS'),0)::text AS verified_cost
         FROM capital_transactions t
         JOIN objectives o ON o.id = t.objective_id
         WHERE o.user_id = $1 AND t.verification_tier = 'RECONCILED'`, [uid])).rows[0]
        ?? { verified_revenue: "0", verified_cost: "0" };

      // 4. Attention queue — hanya eksepsi actionable (§2 Attention Queue)
      const { rows: pendingApprovals } = await client.query(
        `SELECT a.id, a.objective_id, a.category, a.status,
                a.capital_at_risk::text AS capital_at_risk,
                a.why_required, a.what_will_happen,
                a.expires_at::text AS expires_at, a.created_at::text AS created_at,
                o.title AS objective_title
         FROM approvals a JOIN objectives o ON o.id = a.objective_id
         WHERE o.user_id = $1 AND a.status = 'PENDING'
         ORDER BY a.expires_at ASC LIMIT 10`, [uid]);

      const { rows: failedExecs } = await client.query(
        `SELECT e.id, e.status, m.objective_id, e.finished_at::text AS finished_at,
                mv.package->>'title' AS mission_title, o.title AS objective_title
         FROM executions e
         JOIN missions m ON m.id = e.mission_id
         JOIN mission_versions mv ON mv.mission_id = m.id AND mv.version = e.mission_version
         JOIN objectives o ON o.id = m.objective_id
         WHERE o.user_id = $1 AND e.status IN ('FAILED','TIMED_OUT')
         ORDER BY e.finished_at DESC NULLS LAST LIMIT 5`, [uid]);

      // 5. Hitungan lifecycle untuk win-rate & antrian
      const expCounts = (await client.query<{ status: string; count: number }>(
        `SELECT e.status, count(*)::int AS count FROM experiments e
         JOIN objectives o ON o.id = e.objective_id WHERE o.user_id = $1
         GROUP BY e.status`, [uid])).rows;
      const decCounts = (await client.query<{ decision: string; count: number }>(
        `SELECT d.decision, count(*)::int AS count FROM decisions d
         JOIN objectives o ON o.id = d.objective_id WHERE o.user_id = $1
         GROUP BY d.decision`, [uid])).rows;
      const missionCounts = (await client.query<{ status: string; count: number }>(
        `SELECT m.status, count(*)::int AS count FROM missions m
         JOIN objectives o ON o.id = m.objective_id WHERE o.user_id = $1
         GROUP BY m.status`, [uid])).rows;

      // 6. Event terbaru (Executive Brief feed)
      const { rows: events } = await client.query(
        `SELECT e.id, e.objective_id, e.type AS event_type, e.payload, e.created_at::text AS created_at,
                o.title AS objective_title
         FROM events e JOIN objectives o ON o.id = e.objective_id
         WHERE o.user_id = $1
         ORDER BY e.created_at DESC LIMIT 12`, [uid]);

      // ── Agregasi deterministik (JS, Decimal-grade via Number pada teks DB —
      //    nilai sudah final dari Postgres; UI tidak mengubah semantik) ──
      const num = (v: unknown): number | null => {
        if (v == null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const latestByObj = new Map<string, Record<string, unknown>>();
      for (const r of snapRows) latestByObj.set(r.objective_id as string, r);
      let revenue = 0, cogs = 0, grossProfit = 0, operatingProfit = 0;
      let deployed = 0, approvedActive = 0;
      for (const [, s] of latestByObj) {
        revenue += num(s.revenue) ?? 0;
        cogs += num(s.cogs) ?? 0;
        grossProfit += num(s.gross_profit) ?? 0;
        operatingProfit += num(s.operating_profit) ?? 0;
        deployed += num(s.capital_deployed) ?? 0;
      }
      for (const o of objectives) {
        const terminal = o.state === "STOPPED" || o.state === "ACHIEVED";
        if (!terminal) approvedActive += num(o.capital_approved) ?? 0;
      }
      const netPortfolio = operatingProfit + cogs; // identitas engine: net = op + cogs
      const portfolioRoi = approvedActive > 0 ? netPortfolio / approvedActive : null;
      const grossMargin = revenue > 0 ? grossProfit / revenue : null;

      const countSum = (rowsArr: { count: number }[]): number => rowsArr.reduce((a, r) => a + r.count, 0);

      return {
        scoreboard: {
          objectives_total: objectives.length,
          objectives_active: objectives.filter((o) => !["STOPPED", "ACHIEVED"].includes(o.state as string)).length,
          revenue, cogs, gross_profit: grossProfit, gross_margin: grossMargin,
          operating_profit: operatingProfit,
          capital_approved: approvedActive,
          capital_deployed: deployed,
          capital_remaining: Math.max(0, approvedActive - deployed),
          portfolio_roi: portfolioRoi,
          verified_revenue: num(ver.verified_revenue) ?? 0,
          verified_cost: num(ver.verified_cost) ?? 0,
        },
        trajectory: snapRows.slice(-120),
        attention: {
          pending_approvals: pendingApprovals,
          blocked_objectives: objectives.filter((o) =>
            ["BLOCKED", "HUMAN_APPROVAL_REQUIRED"].includes(o.state as string))
            .map((o) => ({ id: o.id, title: o.title, state: o.state })),
          failed_executions: failedExecs,
        },
        counts: {
          experiments_by_status: expCounts,
          experiments_total: countSum(expCounts),
          decisions_by_type: decCounts,
          decisions_total: countSum(decCounts),
          missions_by_status: missionCounts,
          missions_total: countSum(missionCounts),
        },
        events,
      };
    }, req),
  );

  // ── GET /approvals?objective_id= (§8 auditor+) ─────────────────────────────
  // Decision pack lengkap (§11 master prompt): kolom keputusan yang ditulis
  // engine saat approval dibuat ikut dikembalikan — UI tidak menebak.
  app.get("/approvals", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      const q = req.query as { objective_id?: string };
      const rows = (await client.query(
        `SELECT a.id, a.objective_id, a.category, a.status, a.resume_state,
                a.why_required, a.what_will_happen,
                a.capital_at_risk::text AS capital_at_risk,
                a.expected_upside::text AS expected_upside,
                a.expected_downside::text AS expected_downside,
                a.payload, a.expires_at, a.decided_by, a.decided_at, a.created_at
         FROM approvals a
         JOIN objectives o ON o.id = a.objective_id
         WHERE ($1::uuid IS NULL OR a.objective_id = $1::uuid) AND o.user_id = $2
         ORDER BY a.created_at DESC LIMIT 100`,
        [q.objective_id ?? null, session.userId])).rows;
      return { approvals: rows };
    }, req),
  );
  // ════════════════════════════════════════════════════════════════════════════
  // PRODUCT LAYER: experiments / missions / results / decisions (§19-26)
  // Semua ownership-scoped (JOIN objectives o ON ... o.user_id = session.userId)
  // ════════════════════════════════════════════════════════════════════════════

  // ── GET /objectives/:id/experiments (§20) ──
  app.get<{ Params: { id: string } }>("/objectives/:id/experiments", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      await requireOwnedObjective(client, req.params.id, session);
      const { rows } = await client.query(
        `SELECT e.id, e.hypothesis, e.objective, e.budget::text AS budget, e.spent::text AS spent,
                e.duration_days, e.success_metric, e.success_threshold::text AS success_threshold,
                e.failure_threshold::text AS failure_threshold, e.kill_criteria, e.scale_criteria,
                e.information_gain_target, e.status, e.result, e.measured_value::text AS measured_value,
                e.created_at::text, opp.name AS opportunity_name
         FROM experiments e
         JOIN objectives o ON o.id = e.objective_id
         LEFT JOIN opportunities opp ON opp.id = e.opportunity_id
         WHERE e.objective_id = $1 AND o.user_id = $2
         ORDER BY e.created_at DESC LIMIT 100`, [req.params.id, session.userId]);
      return { experiments: rows };
    }, req),
  );

  // ── GET /objectives/:id/missions (§21) ──
  app.get<{ Params: { id: string } }>("/objectives/:id/missions", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      await requireOwnedObjective(client, req.params.id, session);
      const { rows } = await client.query(
        `SELECT m.id, m.status, m.priority, m.created_at::text,
                mv.version, mv.package, mv.package_hash,
                opp.name AS opportunity_name,
                (SELECT count(*)::int FROM executions ex WHERE ex.mission_id = m.id) AS execution_count
         FROM missions m
         JOIN objectives o ON o.id = m.objective_id
         LEFT JOIN mission_versions mv ON mv.mission_id = m.id AND mv.version = m.current_version
         LEFT JOIN opportunities opp ON opp.id = m.opportunity_id
         WHERE m.objective_id = $1 AND o.user_id = $2
         ORDER BY m.created_at DESC LIMIT 100`, [req.params.id, session.userId]);
      return { missions: rows };
    }, req),
  );

  // ── GET /objectives/:id/results (§24 + evidence quality) ──
  app.get<{ Params: { id: string } }>("/objectives/:id/results", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      await requireOwnedObjective(client, req.params.id, session);
      const { rows } = await client.query(
        `SELECT er.id, er.verification_tier,
                er.revenue_claimed::text AS revenue_claimed, er.cost_claimed::text AS cost_claimed,
                er.payload, er.created_at::text,
                ex.status AS execution_status, ex.provider, ex.attempt,
                ex.started_at::text AS started_at, ex.finished_at::text AS finished_at,
                m.id AS mission_id, opp.name AS opportunity_name
         FROM execution_results er
         JOIN executions ex ON ex.id = er.execution_id
         JOIN missions m ON m.id = ex.mission_id
         JOIN objectives o ON o.id = m.objective_id
         LEFT JOIN opportunities opp ON opp.id = m.opportunity_id
         WHERE m.objective_id = $1 AND o.user_id = $2
         ORDER BY er.created_at DESC LIMIT 100`, [req.params.id, session.userId]);
      return { results: rows };
    }, req),
  );

  // ── GET /objectives/:id/economics — P&L lengkap + verified (§14/§27) ──
  app.get<{ Params: { id: string } }>("/objectives/:id/economics", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      await requireOwnedObjective(client, req.params.id, session);
      const { rows: snap } = await client.query(
        `SELECT s.revenue::text AS revenue, s.cogs::text AS cogs,
                s.gross_profit::text AS gross_profit, s.gross_margin::text AS gross_margin,
                s.opex::text AS opex, s.operating_profit::text AS operating_profit,
                s.capital_deployed::text AS capital_deployed,
                s.capital_remaining::text AS capital_remaining,
                s.drawdown::text AS drawdown, s.roi::text AS roi, s.created_at::text
         FROM economic_snapshots s
         JOIN objectives o ON o.id = s.objective_id
         WHERE s.objective_id = $1 AND o.user_id = $2
         ORDER BY s.created_at DESC LIMIT 12`, [req.params.id, session.userId]);
      const { rows: tgt } = await client.query(
        `SELECT o.target_profit::text AS target_profit, o.capital_approved::text AS capital_approved
         FROM objectives o WHERE o.id = $1 AND o.user_id = $2`, [req.params.id, session.userId]);
      const ver = (await client.query<{ verified_revenue: string; verified_cost: string }>(
        `SELECT COALESCE(sum(amount) FILTER (WHERE credit_account='REVENUE'),0)::text AS verified_revenue,
                COALESCE(sum(amount) FILTER (WHERE debit_account='COGS'),0)::text AS verified_cost
         FROM capital_transactions
         WHERE objective_id = $1 AND verification_tier = 'RECONCILED'`, [req.params.id])).rows[0]
        ?? { verified_revenue: "0", verified_cost: "0" };
      return {
        snapshots: snap,
        target: tgt[0] ?? null,
        baseline: snap[snap.length - 1] ?? null,
        current: snap[0] ?? null,
        verified: {
          revenue: ver.verified_revenue,
          cost: ver.verified_cost,
        },
      };
    }, req),
  );

  // ── GET /ai-economics — akuntabilitas AI §17 (§51: bukti AUREX layak pakai) ──
  // Semua angka = agregasi tabel model_runs (jejak run model nyata, per-cycle).
  // cost NULL diisi billing adapter — UI menampilkan "—" bila belum tercatat.
  app.get("/ai-economics", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      const { rows } = await client.query(
        `SELECT mr.agent, mr.purpose,
                count(*)::int AS runs,
                count(*) FILTER (WHERE mr.status = 'SUCCEEDED')::int AS succeeded,
                count(*) FILTER (WHERE mr.status <> 'SUCCEEDED')::int AS failed,
                COALESCE(sum(mr.input_tokens),0)::text AS input_tokens,
                COALESCE(sum(mr.output_tokens),0)::text AS output_tokens,
                CASE WHEN sum(mr.cost) IS NOT NULL THEN sum(mr.cost)::text ELSE NULL END AS cost,
                COALESCE(round(avg(mr.latency_ms)),0)::int AS avg_latency_ms
         FROM model_runs mr
         JOIN cycles c ON c.id = mr.cycle_id
         JOIN objectives o ON o.id = c.objective_id
         WHERE o.user_id = $1
         GROUP BY mr.agent, mr.purpose
         ORDER BY mr.agent, mr.purpose`, [session.userId]);
      return { by_agent_purpose: rows };
    }, req),
  );

  // ── GET /objectives/:id/forecast — skenario BEAR/BASE/BULL (§15) ──────────
  // Input = snapshot TERBARU (revenue & operating profit) + capital_remaining.
  // Kalkulasi deterministik di @aee/economics; keluaran PROJECTED — UI wajib
  // menampilkannya terpisah dari nilai verified. Snapshot kosong → 409
  // (data belum ada karena objective belum bergerak, bukan error server).
  app.get<{ Params: { id: string }; Querystring: { horizon?: string } }>(
    "/objectives/:id/forecast", async (req) =>
    withClient(async (client, session) => {
      const { rows: snap } = await client.query(
        `SELECT s.revenue::text AS revenue, s.operating_profit::text AS operating_profit,
                o.capital_approved::text AS capital_approved
         FROM economic_snapshots s JOIN objectives o ON o.id = s.objective_id
         WHERE s.objective_id = $1 AND o.user_id = $2
         ORDER BY s.created_at DESC LIMIT 1`, [req.params.id, session.userId]);
      const s0 = snap[0];
      if (!s0) throw new ApiError(409, "STATE_VIOLATION",
        "forecast belum bisa dihitung — objective belum memiliki snapshot ekonomi");
      const horizonQ = Number(req.query.horizon ?? "3");
      const horizon = Number.isFinite(horizonQ) ? Math.trunc(horizonQ) : 3;
      const deployed = await client.query(
        `SELECT COALESCE(sum(amount),0)::text AS n FROM capital_transactions
         WHERE objective_id=$1 AND debit_account='CASH'`, [req.params.id]);
      const result = buildScenarios({
        monthlyRevenue: s0.revenue,
        monthlyOperatingProfit: s0.operating_profit,
        // P1 fix: NUMERIC(20,2) adalah string desimal ("1000000.00") — BigInt
        // tidak menerima koma. Pakai decimal.js agar presisi (bukan float).
        capitalRemaining: (() => {
          const approved = new Decimal(s0.capital_approved ?? "0");
          const deployedAmt = new Decimal(deployed.rows[0]?.n ?? "0");
          const rem = approved.minus(deployedAmt);
          return rem.isNegative() ? "0" : rem.toFixed(2);
        })(),
        horizonMonths: horizon,
      });
      return result;
    }, req),
  );

}
