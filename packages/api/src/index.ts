/**
 * @aee/api — API Gateway (Phase 10, §8).
 *
 * Fastify REST di atas packages/* — tanpa business logic (boundary §3):
 *   - validasi request (Zod contracts)
 *   - authN session + authZ role (owner > operator > auditor; service khusus)
 *   - idempotency POST (header Idempotency-Key; wajib mutasi finansial)
 *   - error standar {error:{code,message,details?}} §8
 *   - delegasi ke orchestrator advance()/runAgentJob dan result-processor
 *
 * Scope scaffold (roadmap §37): objectives CRUD-ringkas + start/stop,
 * approvals approve/reject (T34/T35), webhook payments (HMAC → RECONCILED),
 * executions callback, GET reads (objective/snapshot/decisions/events),
 * health. Rate limit & sesi penuh = fase hardening.
 */
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { advance, runAgentJob, type OrchestratorDeps, type AgentJob, type AgentJobKind } from "@aee/orchestrator/runtime";
import { dispatchJob } from "@aee/orchestrator/mission-manager";
import { processPaymentWebhook } from "@aee/orchestrator/result-processor";
import { CreateVentureRequestSchema } from "@aee/contracts";
import { GlmResultSchema } from "@aee/contracts";
import { hashPassword, verifyPassword, createSession, createAuthToken, hashAuthToken, getSession, deleteSession, setSessionCookie, clearSessionCookie, getSessionToken, createOrgForUser, getOrgForUser, type SessionUser } from "./auth.js";

// ── Konstanta role §8 ────────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = { auditor: 1, operator: 2, owner: 3 };

/** Kebutuhan role endpoint → rank minimal (service dicek eksplisit). */
function roleAtLeast(userRole: string, need: "auditor" | "operator" | "owner"): boolean {
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[need] ?? 0);
}

// ── Error standar §8 ─────────────────────────────────────────────────────────

const ERROR_CODES = [
  "VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT",
  "STATE_VIOLATION", "GATE_VIOLATION", "BUDGET_EXCEEDED", "RATE_LIMITED",
  "IDEMPOTENCY_CONFLICT", "INTERNAL",
] as const;
type ErrorCode = (typeof ERROR_CODES)[number];

// ═══ G9: AI Usage Metering (pre-check + settle) ═════════════════════════════
// Flow: PRE-CHECK → EXECUTE → SETTLE. Balance <= 0 → tolak sebelum model call.
// D1 fix: metering kini plan-aware (credits_limit dari subscription_plans,
// bukan hardcode 0) dan pre-check TIDAK bypass saat baris usage belum ada —
// limit plan tetap berlaku (org tanpa baris usage = used 0).

interface UsageRowG9 { credits_used: number; credits_limit: number; credits_purchased: number }

/** Limit AI credit efektif org bulan ini: plan limit + purchased; null = unlimited. */
async function aiCreditsLimit(client: PoolClient, orgId: string): Promise<number | null> {
  const { rows } = await client.query<{ limit: number | null }>(
    `SELECT sp.max_ai_credits_monthly AS "limit"
     FROM organizations o JOIN subscription_plans sp ON sp.tier = o.plan_tier AND sp.is_active = true
     WHERE o.id = $1`, [orgId]);
  return rows[0]?.limit ?? 100; // plan row hilang → fallback konservatif FREE
}

/** Cek saldo AI credits org utk bulan berjalan. Throw 429 kalau habis. */
async function checkAiCreditsAvailable(client: PoolClient, orgId: string, needed = 1): Promise<void> {
  const limit = await aiCreditsLimit(client, orgId);
  if (limit === null) return; // ENTERPRISE unlimited
  const monthYear = new Date().toISOString().slice(0, 7);
  const { rows } = await client.query<UsageRowG9>(
    `SELECT credits_used, credits_limit, credits_purchased FROM usage_credits
     WHERE organization_id = $1 AND month_year = $2`,
    [orgId, monthYear]);
  const u = rows[0];
  const used = u?.credits_used ?? 0;
  const purchased = u?.credits_purchased ?? 0;
  const effective = limit + purchased;
  if (used + needed > effective) {
    throw new ApiError(429, "RATE_LIMITED",
      `AI credit limit reached (${used}/${effective}) — top-up atau upgrade plan`);
  }
}

/** Catat pemakaian AI credit bulan berjalan (limit dipersist = limit plan saat itu). */
async function consumeAiCredit(client: PoolClient, orgId: string): Promise<void> {
  const limit = await aiCreditsLimit(client, orgId);
  if (limit === null) return; // unlimited — tetap catat? tidak: tanpa limit tak ada kuota
  const monthYear = new Date().toISOString().slice(0, 7);
  await client.query(
    `INSERT INTO usage_credits (id, organization_id, month_year, credits_used, credits_limit, credits_purchased, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 1, $3, 0, now(), now())
     ON CONFLICT (organization_id, month_year)
     DO UPDATE SET credits_used = usage_credits.credits_used + 1,
                   credits_limit = GREATEST(usage_credits.credits_limit, EXCLUDED.credits_limit),
                   updated_at = now()`,
    [orgId, monthYear, limit]);
}

/** D1 fix: quota objective per plan (max_objectives) — dipanggil sebelum INSERT
 *  objectives di SEMUA jalur pembuatan (POST /objectives + onboarding step5). */
async function checkObjectiveQuota(client: PoolClient, userId: string, orgId: string, planTier: string): Promise<void> {
  const { rows: planRows } = await client.query<{ max_objectives: number | null }>(
    `SELECT sp.max_objectives FROM subscription_plans sp
     WHERE sp.tier = $1 AND sp.is_active = true`, [planTier]);
  const maxObj = planRows[0]?.max_objectives ?? 1;
  if (maxObj === null) return; // unlimited (GROWTH/ENTERPRISE)
  const { rows: cnt } = await client.query<{ count: number }>(
    `SELECT count(*)::int FROM objectives WHERE user_id = $1 AND state NOT IN ('STOPPED','ACHIEVED')`,
    [userId]);
  if ((cnt[0]?.count ?? 0) >= maxObj) {
    throw new ApiError(429, "RATE_LIMITED",
      `objective limit reached (${cnt[0]?.count ?? 0}/${maxObj}) — upgrade plan untuk lebih`);
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// ── Sesi (authN: cookie session → X-User-Id fallback) ───────────────────────

interface Session { readonly userId: string; readonly role: string; readonly isAdmin: boolean }

async function loadSession(client: PoolClient, req: { headers: Record<string, string | string[] | undefined>; cookies?: Record<string, string> }): Promise<Session> {
  // 1. Try cookie-based session
  const cookieToken = req.cookies?.["aee_session"];
  if (cookieToken) {
    const sess = await getSession(client, cookieToken);
    if (sess) return { userId: sess.userId, role: sess.role, isAdmin: sess.isAdmin };
  }
  // 2. Fallback: X-User-Id header — HANYA untuk dev/demo mode (AEE_DEV_MODE=1).
  //    F12 fix: di production, X-User-Id header dinonaktifkan untuk mencegah BOLA
  //    (siapapun kirim header user lain → jadi user itu).
  const devMode = process.env.AEE_DEV_MODE === "1" || process.env.NODE_ENV !== "production";
  if (!devMode) throw new ApiError(401, "UNAUTHORIZED", "Authentication required (session cookie)");
  const h = req.headers["x-user-id"];
  const uid = Array.isArray(h) ? h[0] : h;
  if (!uid) throw new ApiError(401, "UNAUTHORIZED", "Authentication required (cookie or X-User-Id)");
  const { rows } = await client.query<{ role: string; is_admin: boolean }>(
    `SELECT role, is_admin FROM users WHERE id = $1`, [uid]);
  const r = rows[0];
  if (!r) throw new ApiError(401, "UNAUTHORIZED", `user ${uid} tidak dikenal`);
  return { userId: uid, role: r.role, isAdmin: r.is_admin };
}

// ── Schemas (Zod contracts — satu sumber kebenaran dengan §9/§10) ────────────

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
  horizon_months: z.number().int().min(1).max(120),
  market: z.string().min(2).max(100),
  risk_tolerance: z.enum(["low", "moderate", "high"]),
  autonomy_level: z.number().int().min(0).max(4).optional(),
  environment: z.enum(["SIMULATED", "LIVE"]).optional(),
}).strict();

const ApproveSchema = z.object({ version: z.number().int().min(1) }).strict();
const ApprovalNoteSchema = z.object({ note: z.string().max(500).optional() }).strict();
const ApprovalRejectSchema = z.object({ reason: z.string().min(3).max(500) }).strict();
const StopSchema = z.object({ reason: z.string().min(3).max(500) }).strict();
const WebhookPayloadSchema = z.object({
  external_id: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  kind: z.enum(["REVENUE", "COST"]),
  provider: z.string().min(2).max(50),
  occurred_at: z.string().datetime().optional(),
}).strict();

// ── Builder app ──────────────────────────────────────────────────────────────

export interface ApiOptions {
  readonly pool: Pool;
  readonly deps: OrchestratorDeps;
  /** secret HMAC webhook (per-provider di fase hardening). */
  readonly webhookSecret: string;
  /** role khusus utk callback service; default "service". */
  readonly serviceRole?: string;
  /**
   * Readiness probe (#1): fungsi mengembalikan status DB. Bila tidak
   * disediakan, /health tidak mem-probe DB (liveness saja).
   */
  readonly dbHealth?: () => { db: "healthy" | "unhealthy"; lastError?: string | null };
}

export function buildApp(opts: ApiOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
  });
  // Session cookies (httpOnly, 7-day expiry)
  void app.register(import("@fastify/cookie"));
  // Raw body byte-exact utk HMAC webhook — disimpan per-request (WeakMap);
  // req.body tetap objek JSON ter-parse agar endpoint lain tak berubah.
  const rawBodies = new WeakMap<object, string>();
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      try {
        const raw = typeof body === "string" ? body : String(body);
        done(null, raw.trim() === "" ? {} : JSON.parse(raw));
        rawBodies.set(req, raw);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Error envelope standar
  app.setErrorHandler((err, _req, reply) => {
    // Postgres 22P02: invalid input syntax for type uuid — id bukan-UUID pada
    // route object-scoped. Kembalikan 404 (konsisten dgn NOT_FOUND, tidak
    // bocorkan bentuk internal / tidak 500).
    const isInvalidUuid = err instanceof Error &&
      /invalid input syntax for type uuid/i.test(err.message);
    if (isInvalidUuid) {
      void reply.status(404).send({
        error: { code: "NOT_FOUND", message: "resource tidak ada" },
      });
      return;
    }
    if (!(err instanceof ApiError)) console.error("[api-error]", err instanceof Error ? err.stack || err.message : String(err));
    if (err instanceof ApiError) {
      void reply.status(err.status).send({
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      });
      return;
    }
    void reply.status(500).send({
      error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) },
    });
  });

  // Helper: with client + session
  async function withClient<T>(
    fn: (client: PoolClient, session: Session) => Promise<T>,
    req: { headers: Record<string, string | string[] | undefined> },
  ): Promise<T> {
    const client = await opts.pool.connect();
    try {
      const session = await loadSession(client, req);
      return await fn(client, session);
    } finally {
      client.release();
    }
  }

  function requireRole(session: Session, need: "auditor" | "operator" | "owner" | "service"): void {
    if (need === "service") {
      if (session.role !== opts.serviceRole && session.role !== "service") {
        throw new ApiError(403, "FORBIDDEN", `butuh role service (dapat ${session.role})`);
      }
      return;
    }
    if (!roleAtLeast(session.role, need)) {
      throw new ApiError(403, "FORBIDDEN", `butuh role >= ${need} (dapat ${session.role})`);
    }
  }

  // ── Ownership enforcement (anti-BOLA/IDOR) ────────────────────────────────
  // Semua aksi objek-scoped WAJIB lulus cek ini: resource harus milik user.
  async function requireOwnedObjective(
    client: PoolClient, objectiveId: string, session: Session,
  ): Promise<void> {
    const { rows } = await client.query<{ user_id: string }>(
      `SELECT user_id FROM objectives WHERE id = $1`, [objectiveId]);
    if (!rows[0]) throw new ApiError(404, "NOT_FOUND", `objective ${objectiveId} tidak ada`);
    if (rows[0].user_id !== session.userId) {
      throw new ApiError(404, "NOT_FOUND", `objective ${objectiveId} tidak ada`);
      // 404 (bukan 403) — jangan bocorkan keberadaan resource milik orang lain.
    }
  }

  async function requireOwnedApproval(
    client: PoolClient, approvalId: string, session: Session,
  ): Promise<{ objective_id: string; status: string }> {
    const { rows } = await client.query<{ objective_id: string; status: string; owner: string }>(
      `SELECT a.objective_id, a.status, o.user_id AS owner
       FROM approvals a JOIN objectives o ON o.id = a.objective_id
       WHERE a.id = $1`, [approvalId]);
    const ap = rows[0];
    if (!ap || ap.owner !== session.userId) {
      throw new ApiError(404, "NOT_FOUND", `approval ${approvalId} tidak ada`);
    }
    return { objective_id: ap.objective_id, status: ap.status };
  }

  // ── Rate limiting (login/signup/reset — anti brute-force) ─────────────────
  const loginAttempts = new Map<string, { count: number; firstAt: number; blockedUntil?: number }>();
  const RATE_WINDOW_MS = 15 * 60_000;
  const RATE_MAX = 10;
  function rateLimit(key: string): void {
    const now = Date.now();
    const st = loginAttempts.get(key);
    if (st?.blockedUntil && st.blockedUntil > now) {
      throw new ApiError(429, "RATE_LIMITED", `terlalu banyak percobaan — coba lagi dalam ${Math.ceil((st.blockedUntil - now) / 1000)}s`);
    }
    if (!st || now - st.firstAt > RATE_WINDOW_MS) {
      loginAttempts.set(key, { count: 1, firstAt: now });
      return;
    }
    st.count++;
    if (st.count > RATE_MAX) {
      st.blockedUntil = now + 15 * 60_000;
      throwApi429(st.blockedUntil);
    }
  }
  function rateLimitClear(key: string): void {
    loginAttempts.delete(key);
  }
  function throwApi429(blockedUntilMs: number): never {
    const secs = Math.ceil((blockedUntilMs - Date.now()) / 1000);
    throw new ApiError(429, "RATE_LIMITED", `terlalu banyak percobaan — coba lagi dalam ${secs}s`);
  }

  function parseBody<T>(schema: z.ZodType<T>, raw: unknown): T {
    const r = schema.safeParse(raw);
    if (!r.success) {
      throw new ApiError(422, "VALIDATION_ERROR", "body tidak valid", r.error.issues);
    }
    return r.data;
  }

  function idemKey(req: { headers: Record<string, string | string[] | undefined> }): string | null {
    const h = req.headers["idempotency-key"];
    const v = Array.isArray(h) ? h[0] : h;
    return v ?? null;
  }

  // ═══ Health: liveness API vs readiness DB (#1) ═══
  app.get("/health", async () => {
    if (!opts.dbHealth) return { status: "ok", ts: new Date().toISOString() };
    const h = opts.dbHealth();
    return {
      status: h.db === "healthy" ? "ok" : "degraded",
      api: "up",
      db: h.db,
      lastError: h.lastError ?? null,
      ts: new Date().toISOString(),
    };
  });

  // ── Phase 15: Business Ventures ─────────────────────────────────────────────
  app.get("/ventures", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "owner");
      const { rows } = await client.query(
        `SELECT v.id, v.name, v.industry, v.market, v.target_customer, v.problem, v.solution,
                v.business_model, v.price, v.origin, v.created_at::text AS created_at,
                (SELECT count(*)::int FROM objectives o WHERE o.business_venture_id = v.id) AS objective_count
         FROM business_ventures v WHERE v.user_id = $1 ORDER BY v.created_at DESC`, [session.userId]);
      return { ventures: rows };
    }, req),
  );

  app.post<{ Body: unknown }>("/ventures", async (req, reply) =>
    withClient(async (client, session) => {
      requireRole(session, "owner");
      const body = parseBody(CreateVentureRequestSchema, req.body);
      const vid = randomUUID();
      await client.query(
        `INSERT INTO business_ventures (id, user_id, name, industry, market, target_customer,
           problem, solution, business_model, price, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'USER')`,
        [vid, session.userId, body.name, body.industry, body.market, body.target_customer,
         body.problem, body.solution, body.business_model, body.price ?? null]);
      return void reply.status(201).send({ id: vid, state: "CREATED" });
    }, req),
  );

  // ── Phase 15: agent mode (REAL/MOCK) — dashboard badge ─────────────────────
  app.get("/agent-mode", async (req) =>
    withClient(async (_client, session) => {
      if (!session.isAdmin) throw new ApiError(403, "FORBIDDEN", "admin only");
      const kimi = process.env.KIMI_API_KEY ? "REAL" : "MOCK";
      const glm = process.env.GLM_API_KEY ? "REAL" : "MOCK";
      return {
        mode: kimi === "REAL" && glm === "REAL" ? "REAL" : (kimi === "REAL" || glm === "REAL" ? "MIXED" : "MOCK"),
        kimi: { mode: kimi, model: process.env.KIMI_MODEL ?? "mock" },
        glm: { mode: glm, model: process.env.GLM_MODEL ?? "mock" },
      };
    }, req),
  );

  // ═══ Objectives ═══

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
        `INSERT INTO objectives (id, user_id, title, target_profit, capital_approved, horizon_months,
           deadline, market, risk_tolerance, autonomy_level, state, current_cycle, environment,
           business_venture_id, business_mode, goal_type)
                    VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,'OBJECTIVE_CREATED',0,$10,$11,$12,$13)`,
                   [objId, session.userId, body.title, body.target_profit, body.capital_approved,
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
                opex::text, operating_profit::text, drawdown::text, created_at
         FROM economic_snapshots WHERE objective_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [req.params.id])).rows[0] ?? null;
      return {
        objective: {
          id: o.id, title: o.title, state: o.state, row_version: o.row_version,
          current_cycle: o.current_cycle, autonomy_level: o.autonomy_level,
          target_profit: o.target_profit, capital_approved: o.capital_approved,
          horizon_months: o.horizon_months, market: o.market,
          risk_tolerance: o.risk_tolerance, business_mode: o.business_mode,
          environment: o.environment ?? "SIMULATED",
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
                opp.business_model, opp.capital_required::text, opp.revenue_potential::text,
                opp.risk_score, opp.opportunity_score, opp.risk_adjusted_score
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

  // ═══ Approvals (T34/T35) ═══

  app.post<{ Params: { id: string }; Body: unknown }>("/approvals/:id/approve", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "owner");
      const ap = await requireOwnedApproval(client, req.params.id, session);
      if (ap.status === "APPROVED") return { approval: req.params.id, status: "APPROVED", idempoten: true };
      if (ap.status !== "PENDING") {
        throw new ApiError(409, "CONFLICT", `approval ${ap.status} — tidak bisa di-approve`);
      }
      const body = parseBody(ApprovalNoteSchema, req.body ?? {});
      await client.query(
        `UPDATE approvals SET status='APPROVED', decided_by=$2, decided_at=now(),
           payload = payload || $3::jsonb
         WHERE id = $1`,
        [req.params.id, session.userId, JSON.stringify({ note: body.note ?? "" })]);
      // T34 resume: HUMAN_APPROVAL_REQUIRED → {resume_state}=MISSION_CREATED
      const r = await advance(client, ap.objective_id, "approve", opts.deps);
      if (!r.ok) throw new ApiError(409, "STATE_VIOLATION", r.reason);
      // T13 mission approve: humanApproved=true (keputusan manusia baru saja dibuat)
      // → MISSION_APPROVED → requeue dispatch.
      const r13 = await advance(client, ap.objective_id, "approve", opts.deps, (ctx) => ({
        ...ctx,
        mission: ctx.mission ? { ...ctx.mission, humanApproved: true } : ctx.mission,
      }));
      if (!r13.ok) throw new ApiError(409, "STATE_VIOLATION", r13.reason);
      const mission = (await client.query<{ id: string }>(
        `SELECT m.id FROM missions m WHERE m.objective_id=$1
         ORDER BY m.created_at DESC LIMIT 1`, [ap.objective_id])).rows[0];
      if (mission) {
        await opts.deps.queue.enqueue({
          kind: "dispatch_glm", objectiveId: ap.objective_id, idem: `dispatch:${mission.id}:1`,
        });
      }
      return { approval: req.params.id, status: "APPROVED", resumed_to: r.transition.to };
    }, req),
  );

  app.post<{ Params: { id: string }; Body: unknown }>("/approvals/:id/reject", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "owner");
      const body = parseBody(ApprovalRejectSchema, req.body ?? {});
      const ap = await requireOwnedApproval(client, req.params.id, session);
      if (ap.status === "REJECTED") return { approval: req.params.id, status: "REJECTED", idempoten: true };
      if (ap.status !== "PENDING") {
        throw new ApiError(409, "CONFLICT", `approval ${ap.status} — tidak bisa ditolak`);
      }
      await client.query(
        `UPDATE approvals SET status='REJECTED', decided_by=$2, decided_at=now(),
           payload = payload || $3::jsonb
         WHERE id = $1`,
        [req.params.id, session.userId, JSON.stringify({ reason: body.reason })]);
      // T35 reject/timeout → BLOCKED
      const r = await advance(client, ap.objective_id, "reject/timeout", opts.deps);
      if (!r.ok) throw new ApiError(409, "STATE_VIOLATION", r.reason);
      return { approval: req.params.id, status: "REJECTED", state: r.transition.to };
    }, req),
  );

  // ═══ Webhook payments (signature role) ═══

  app.post<{ Params: { provider: string }; Body: unknown }>("/webhooks/payments/:provider", async (req) => {
    // Webhook = signature-authenticated, bukan session — verifikasi HMAC dulu.
    // Raw body byte-exact dari content-type parser (WeakMap per-request).
    const raw = rawBodies.get(req) ?? JSON.stringify(req.body);

    const sigHeader = req.headers["x-signature"];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!sig) throw new ApiError(401, "UNAUTHORIZED", "header X-Signature wajib");
    const payload = parseBody(WebhookPayloadSchema, req.body);
    // Webhook terautentikasi SIGNATURE (bukan sesi) — pool connection tanpa session.
    const client = await opts.pool.connect();
    let outcome;
    try {
      outcome = await processPaymentWebhook(client, payload, raw, sig, opts.webhookSecret);
    } finally {
      client.release();
    }
    if (!outcome.ok) {
      if (outcome.code === "SIGNATURE_INVALID") {
        throw new ApiError(401, "UNAUTHORIZED", `SIGNATURE_INVALID: ${outcome.detail}`);
      }
      const status = outcome.code === "EXECUTION_NOT_FOUND" ? 404 : 422;
      throw new ApiError(status, "STATE_VIOLATION", `${outcome.code}: ${outcome.detail}`);
    }
    return { received: true, code: outcome.code };
  });

  // ═══ Executions callback (service role §8) ═══

  app.post<{ Params: { id: string }; Body: unknown }>("/executions/:id/result", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "service");
      const parsed = GlmResultSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(422, "VALIDATION_ERROR", "GLMResult tidak schema-valid",
          parsed.error.issues);
      }
      // Callback async (§8): intake + persist via result-processor.
      const { persistGlmResult } = await import("@aee/orchestrator/result-processor");
      const ex = (await client.query<{
        id: string; missionId: string; missionVersion: number;
        packageMissionId: string; providerJobRef: string | null; status: string;
      }>(
        `SELECT e.id, e.mission_id AS "missionId", e.mission_version AS "missionVersion",
                (mv.package->>'mission_id') AS "packageMissionId",
                e.provider_job_ref AS "providerJobRef", e.status
         FROM executions e
         JOIN mission_versions mv ON mv.mission_id = e.mission_id AND mv.version = e.mission_version
         WHERE e.id = $1`, [req.params.id])).rows[0];
      if (!ex) throw new ApiError(404, "NOT_FOUND", `execution ${req.params.id} tidak ada`);
      if (ex.status !== "RUNNING") {
        // idempoten §8: duplikat callback → 200 idempoten
        return { accepted: true, verification_tier: null, idempoten: true };
      }
      const out = await persistGlmResult(client, ex, parsed.data);
      if (!out.inserted) {
        throw new ApiError(422, "STATE_VIOLATION",
          `RESULT_REJECTED: ${!out.intake.accepted && "reason" in out.intake ? out.intake.reason : "intake ditolak"}`);
      }
      return { accepted: true, verification_tier: out.intake.accepted ? out.intake.verificationTier : null };
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
      const q = req.query as { objective_id?: string };
      if (!q.objective_id) throw new ApiError(422, "VALIDATION_ERROR", "query objective_id wajib");
      const rows = (await client.query(
        `SELECT e.id, e.type, e.payload, e.created_at FROM events e
         JOIN objectives o ON o.id = e.objective_id
         WHERE e.objective_id = $1 AND o.user_id = $2
         ORDER BY e.created_at DESC LIMIT 100`,
        [q.objective_id, session.userId])).rows;
      return { events: rows };
    }, req),
  );

  // ── Root routing (canonical §3): / = landing publik; /app = dashboard. ────
  app.get("/", async (_req, reply) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const html = await readFile(join(here, "..", "assets", "landing.html"), "utf8");
    reply.type("text/html; charset=utf-8").send(html);
  });

  const dashboardHtml = async (reply: FastifyReply) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const html = await readFile(join(here, "..", "assets", "dashboard.html"), "utf8");
    reply.type("text/html; charset=utf-8").send(html);
  };
  app.get("/app", async (_req, reply) => dashboardHtml(reply));
  app.get("/app/*", async (_req, reply) => dashboardHtml(reply));
  app.get("/admin", async (_req, reply) => dashboardHtml(reply));
  app.get("/admin/*", async (_req, reply) => dashboardHtml(reply));
  app.get("/auth", async (_req, reply) => dashboardHtml(reply));
  app.get("/auth/*", async (_req, reply) => dashboardHtml(reply));
  app.get("/onboarding", async (_req, reply) => dashboardHtml(reply));
  app.get("/onboarding/*", async (_req, reply) => dashboardHtml(reply));
  app.get("/dashboard.html", async (_req, reply) => dashboardHtml(reply));

  // ── Landing page (SEO-optimized, public, no session). ──────────────────────
  app.get("/landing", async (_req, reply) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const html = await readFile(join(here, "..", "assets", "landing.html"), "utf8");
    reply.type("text/html; charset=utf-8").send(html);
  });

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

  // ── GET /approvals?objective_id= (§8 auditor+) ─────────────────────────────
  app.get("/approvals", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      const q = req.query as { objective_id?: string };
      if (!q.objective_id) throw new ApiError(422, "VALIDATION_ERROR", "query objective_id wajib");
      const rows = (await client.query(
        `SELECT a.id, a.objective_id, a.category, a.status, a.resume_state, a.created_at
         FROM approvals a
         JOIN objectives o ON o.id = a.objective_id
         WHERE a.objective_id = $1 AND o.user_id = $2
         ORDER BY a.created_at DESC LIMIT 50`,
        [q.objective_id, session.userId])).rows;
      return { approvals: rows };
    }, req),
  );

  // ── POST /dev/seed-user (demo §36): pastikan X-User-Id dashboard terdaftar
  //    sebagai owner. Jalur demo — idempoten (ON CONFLICT DO NOTHING), tanpa
  //    sesi (user belum ada). Bukan jalur produksi.
  app.post("/dev/seed-user", async (req) => {
    if (process.env.NODE_ENV === "production") {
      throw new ApiError(404, "NOT_FOUND", "not found");
    }
    const uid = req.headers["x-user-id"];
    if (typeof uid !== "string" || !uid) {
      throw new ApiError(422, "VALIDATION_ERROR", "header x-user-id wajib");
    }
    const client = await opts.pool.connect();
    try {
      const r = await client.query(
        `INSERT INTO users (id, email, password_hash, role)
         VALUES ($1, $2, 'demo-disabled', 'owner')
         ON CONFLICT (id) DO NOTHING RETURNING id, role`,
        [uid, `demo-${uid.slice(0, 8)}@dashboard.local`]);
      const row = r.rows[0] ?? (await client.query(
        `SELECT id, role FROM users WHERE id = $1`, [uid])).rows[0];
      return { user: row };
    } finally {
      client.release();
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // AUTH ENDPOINTS (signup / login / logout / me)
  // ════════════════════════════════════════════════════════════════════════════

  const SignupSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    name: z.string().min(1).max(100).optional(),
    org_name: z.string().min(1).max(100).optional(),
  }).strict();

  app.post("/auth/signup", async (req, reply) => {
    // F6 fix: ZodError → 422 VALIDATION_ERROR (bukan 500 INTERNAL).
    const body = parseBody(SignupSchema, req.body);
    rateLimit(`signup:${req.ip ?? "unknown"}`);
    const client = await opts.pool.connect();
    try {
      // Check existing
      const existing = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [body.email]);
      if (existing.rows[0]) throw new ApiError(409, "CONFLICT", "email sudah terdaftar");
      // Create user
      const pwHash = await hashPassword(body.password);
      let user: { id: string; email: string; role: string; name: string | null } | undefined;
      try {
        const { rows: userRows } = await client.query<{ id: string; email: string; role: string; name: string | null }>(
          `INSERT INTO users (email, password_hash, role, name) VALUES ($1, $2, 'owner', $3) RETURNING id, email, role, name`,
          [body.email, pwHash, body.name ?? null],
        );
        user = userRows[0];
      } catch (e) {
        // TOCTOU race: email unique constraint — dua signup bersamaan.
        if (e instanceof Error && "code" in e && (e as { code?: string }).code === "23505") {
          throw new ApiError(409, "CONFLICT", "email sudah terdaftar");
        }
        throw e;
      }
      // Create org
      const orgName = body.org_name ?? `${body.name ?? body.email.split("@")[0]}'s Organization`;
      const { orgId } = await createOrgForUser(client, user!.id, orgName);
      // Email verification token (link dikirim via email provider; dev: console)
      const verifyToken = await createAuthToken(client, user!.id, "EMAIL_VERIFY", 24 * 60);
      console.log(`[auth] Email verification link for ${body.email}: /auth/verify?token=${verifyToken}`);
      // Create session
      const token = await createSession(client, user!.id);
      setSessionCookie(reply, token);
      return { user: { id: user!.id, email: user!.email, role: user!.role, name: user!.name }, org_id: orgId,
        verify_token_dev: process.env.NODE_ENV === "production" ? undefined : verifyToken };
    } finally {
      client.release();
    }
  });

  const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(128),
  }).strict();

  app.post("/auth/login", async (req, reply) => {
    // F7 fix: ZodError → 422 VALIDATION_ERROR (bukan 500 INTERNAL).
    const body = parseBody(LoginSchema, req.body);
    rateLimit(`login:${body.email.toLowerCase()}`);
    const client = await opts.pool.connect();
    try {
      const { rows } = await client.query<{ id: string; email: string; role: string; name: string | null; password_hash: string; status: string; email_verified_at: string | null }>(
        `SELECT id, email, role, name, password_hash, status, email_verified_at FROM users WHERE email = $1`, [body.email],
      );
      const user = rows[0];
      if (!user || !(await verifyPassword(body.password, user.password_hash))) {
        throw new ApiError(401, "UNAUTHORIZED", "email atau password salah");
      }
      if (user.status !== "ACTIVE") throw new ApiError(403, "FORBIDDEN", `akun ${user.status}`);
      rateLimitClear(`login:${body.email.toLowerCase()}`);
      const token = await createSession(client, user.id);
      setSessionCookie(reply, token);
      return { user: { id: user.id, email: user.email, role: user.role, name: user.name }, email_verified: !!user.email_verified_at };
    } finally {
      client.release();
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = getSessionToken(req);
    if (token) {
      const client = await opts.pool.connect();
      try { await deleteSession(client, token); } finally { client.release(); }
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/me", async (req) =>
    withClient(async (client, session) => {
      const org = await getOrgForUser(client, session.userId);
      let usage = null;
      if (org) {
        const monthYear = new Date().toISOString().slice(0, 7);
        const { rows: ur } = await client.query<{ credits_used: number; credits_limit: number }>(
          `SELECT credits_used, credits_limit FROM usage_credits WHERE organization_id = $1 AND month_year = $2`,
          [org.id, monthYear],
        );
        usage = ur[0] ?? { credits_used: 0, credits_limit: 0 };
      }
      const { rows: evRows } = await client.query<{ email: string; email_verified_at: string | null; name: string | null }>(
        `SELECT email, email_verified_at, name FROM users WHERE id = $1`, [session.userId]);
      return {
        user: { id: session.userId, email: evRows[0]?.email ?? "", role: session.role, isAdmin: session.isAdmin,
          name: evRows[0]?.name ?? null, emailVerified: !!evRows[0]?.email_verified_at },
        org: org ? { id: org.id, name: org.name, slug: org.slug, planTier: org.planTier,
          onboardingStep: org.onboardingStep, onboardingCompleted: org.onboardingCompleted,
          autonomyLevel: org.autonomyLevel } : null,
        usage,
      };
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
                ex.status AS execution_status, m.id AS mission_id,
                opp.name AS opportunity_name
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

  // ── GET /objectives/:id/economics — baseline/current/target (§27) ──
  app.get<{ Params: { id: string } }>("/objectives/:id/economics", async (req) =>
    withClient(async (client, session) => {
      requireRole(session, "auditor");
      await requireOwnedObjective(client, req.params.id, session);
      const { rows: snap } = await client.query(
        `SELECT s.revenue::text, s.gross_profit::text, s.operating_profit::text, s.roi::text,
                s.capital_deployed::text, s.cac::text, s.ltv::text, s.ltv_cac::text, s.created_at::text
         FROM economic_snapshots s
         JOIN objectives o ON o.id = s.objective_id
         WHERE s.objective_id = $1 AND o.user_id = $2
         ORDER BY s.created_at DESC LIMIT 12`, [req.params.id, session.userId]);
      const { rows: tgt } = await client.query(
        `SELECT o.target_profit::text AS target_profit, o.capital_approved::text AS capital_approved
         FROM objectives o WHERE o.id = $1 AND o.user_id = $2`, [req.params.id, session.userId]);
      return {
        snapshots: snap,
        target: tgt[0] ?? null,
        baseline: snap[snap.length - 1] ?? null,
        current: snap[0] ?? null,
      };
    }, req),
  );

  // ── GET /decisions (§26) — sudah ada; pastikan ownership-scope sudah benar ──

  // ════════════════════════════════════════════════════════════════════════════
  // AUTH LIFECYCLE (verify / forgot / reset) — §6 canonical
  // ════════════════════════════════════════════════════════════════════════════

  app.post("/auth/verify-email", async (req) => {
    const body = parseBody(z.object({ token: z.string().min(16).max(128) }).strict(), req.body);
    const client = await opts.pool.connect();
    try {
      const { rows } = await client.query<{ id: string; user_id: string; used_at: string | null; expires_at: string }>(
        `SELECT id, user_id, used_at, expires_at FROM auth_tokens
         WHERE token_hash = $1 AND kind = 'EMAIL_VERIFY'`, [hashAuthToken(body.token)]);
      const t = rows[0];
      if (!t || t.used_at || new Date(t.expires_at) < new Date()) {
        throw new ApiError(422, "VALIDATION_ERROR", "token tidak valid atau kedaluwarsa");
      }
      await client.query(`UPDATE auth_tokens SET used_at = now() WHERE id = $1`, [t.id]);
      await client.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [t.user_id]);
      return { ok: true, verified: true };
    } finally { client.release(); }
  });

  app.post("/auth/forgot-password", async (req) => {
    const body = parseBody(z.object({ email: z.string().email() }).strict(), req.body);
    rateLimit(`forgot:${body.email.toLowerCase()}`);
    const client = await opts.pool.connect();
    try {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [body.email]);
      // Anti-enumeration: respons selalu { ok: true }.
      if (rows[0]) {
        const resetToken = await createAuthToken(client, rows[0].id, "PASSWORD_RESET", 60);
        console.log(`[auth] Password reset link for ${body.email}: /auth/reset-password?token=${resetToken}`);
      }
      return { ok: true };
    } finally { client.release(); }
  });

  app.post("/auth/reset-password", async (req) => {
    const body = parseBody(z.object({
      token: z.string().min(16).max(128),
      password: z.string().min(8).max(128),
    }).strict(), req.body);
    rateLimit(`reset:${req.ip ?? "unknown"}`);
    const client = await opts.pool.connect();
    try {
      const { rows } = await client.query<{ id: string; user_id: string; used_at: string | null; expires_at: string }>(
        `SELECT id, user_id, used_at, expires_at FROM auth_tokens
         WHERE token_hash = $1 AND kind = 'PASSWORD_RESET'`, [hashAuthToken(body.token)]);
      const t = rows[0];
      if (!t || t.used_at || new Date(t.expires_at) < new Date()) {
        throw new ApiError(422, "VALIDATION_ERROR", "token tidak valid atau kedaluwarsa");
      }
      const pwHash = await hashPassword(body.password);
      await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [pwHash, t.user_id]);
      // Revoke semua session user (password berganti → session lama invalid)
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [t.user_id]);
      await client.query(`UPDATE auth_tokens SET used_at = now() WHERE id = $1`, [t.id]);
      return { ok: true };
    } finally { client.release(); }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ONBOARDING ENDPOINTS (5-step wizard)
  // ════════════════════════════════════════════════════════════════════════════

  app.get("/onboarding/status", async (req) =>
    withClient(async (client, session) => {
      const org = await getOrgForUser(client, session.userId);
      if (!org) throw new ApiError(404, "NOT_FOUND", "organization tidak ditemukan");
      return { step: org.onboardingStep, completed: org.onboardingCompleted };
    }, req),
  );

  const OnboardingStep1Schema = z.object({
    business_name: z.string().min(1).max(200),
    industry: z.string().min(1).max(100),
    website: z.string().url().optional(),
    products: z.string().max(2000).optional(),
    target_customer: z.string().min(1).max(500),
  }).strict();

  app.post("/onboarding/step1", async (req) =>
    withClient(async (client, session) => {
      const body = OnboardingStep1Schema.parse(req.body);
      const org = await getOrgForUser(client, session.userId);
      if (!org) throw new ApiError(404, "NOT_FOUND", "organization tidak ditemukan");
      // Create business_venture
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO business_ventures (user_id, organization_id, name, industry, market, target_customer, problem, solution, business_model, website, products)
         VALUES ($1, $2, $3, $4, 'Indonesia', $5, 'TBD — AEE will analyze', 'TBD — AEE will analyze', 'TBD', $6, $7)
         RETURNING id`,
        [session.userId, org.id, body.business_name, body.industry, body.target_customer,
         body.website ?? null, body.products ?? null],
      );
      await client.query(`UPDATE organizations SET onboarding_step = 1 WHERE id = $1`, [org.id]);
      return { venture_id: rows[0]?.id ?? null };
    }, req),
  );

  const OnboardingStep2Schema = z.object({
    goal_type: z.enum(["increase_profit", "reduce_cost", "find_opportunities", "launch_new", "improve_growth"]),
  }).strict();

  app.post("/onboarding/step2", async (req) =>
    withClient(async (client, session) => {
      const body = OnboardingStep2Schema.parse(req.body);
      const org = await getOrgForUser(client, session.userId);
      if (!org) throw new ApiError(404, "NOT_FOUND", "organization tidak ditemukan");
      await client.query(
        `UPDATE business_ventures SET goal_type = $1 WHERE organization_id = $2 AND user_id = $3`,
        [body.goal_type, org.id, session.userId],
      );
      await client.query(`UPDATE organizations SET onboarding_step = 2 WHERE id = $1`, [org.id]);
      return { goal_type: body.goal_type };
    }, req),
  );

  const OnboardingStep3Schema = z.object({
    current_revenue: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
    current_cost: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
    capital: z.string().regex(/^\d+(\.\d{1,2})?$/),
    time_horizon_months: z.number().int().min(1).max(120),
  }).strict();

  app.post("/onboarding/step3", async (req) =>
    withClient(async (client, session) => {
      const body = OnboardingStep3Schema.parse(req.body);
      const org = await getOrgForUser(client, session.userId);
      if (!org) throw new ApiError(404, "NOT_FOUND", "organization tidak ditemukan");
      await client.query(
        `UPDATE business_ventures SET current_revenue = $1, current_cost = $2, time_horizon_months = $3, capital_available = $4
         WHERE organization_id = $5 AND user_id = $6`,
        [body.current_revenue, body.current_cost, body.time_horizon_months, body.capital, org.id, session.userId],
      );
      await client.query(`UPDATE organizations SET onboarding_step = 3 WHERE id = $1`, [org.id]);
      return { economics: { current_revenue: body.current_revenue, current_cost: body.current_cost, capital: body.capital, time_horizon_months: body.time_horizon_months } };
    }, req),
  );

  const OnboardingStep4Schema = z.object({
    autonomy_level: z.number().int().min(1).max(3),
  }).strict();

  app.post("/onboarding/step4", async (req) =>
    withClient(async (client, session) => {
      const body = OnboardingStep4Schema.parse(req.body);
      const org = await getOrgForUser(client, session.userId);
      if (!org) throw new ApiError(404, "NOT_FOUND", "organization tidak ditemukan");
      await client.query(`UPDATE organizations SET onboarding_step = 4, autonomy_level = $2 WHERE id = $1`, [org.id, body.autonomy_level]);
      return { autonomy_level: body.autonomy_level };
    }, req),
  );

  const OnboardingStep5Schema = z.object({
    title: z.string().min(3).max(200),
    target_profit: z.string().regex(/^\d+(\.\d{1,2})?$/),
  }).strict();

  app.post("/onboarding/step5", async (req) =>
    withClient(async (client, session) => {
      const body = OnboardingStep5Schema.parse(req.body);
      const org = await getOrgForUser(client, session.userId);
      if (!org) throw new ApiError(404, "NOT_FOUND", "organization tidak ditemukan");
      // D1 fix: step5 dulunya TANPA quota check — jalur bypass limit plan.
      await checkObjectiveQuota(client, session.userId, org.id, org.planTier);
      // Get venture + economics (F3: capital dari step3, bukan target_profit)
      const { rows: vrows } = await client.query<{ id: string }>(
        `SELECT id FROM business_ventures WHERE organization_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [org.id, session.userId],
      );
      if (!vrows[0]) throw new ApiError(422, "VALIDATION_ERROR", "step 1 belum selesai (venture tidak ada)");
      // Create objective (DISCOVERY mode)
      const objId = randomUUID();
      const { rows: venture } = await client.query<{ capital_available: string; time_horizon_months: number; goal_type: string | null }>(
        `SELECT capital_available::text, time_horizon_months, goal_type FROM business_ventures WHERE id = $1`, [vrows[0].id],
      );
      const v = venture[0];
      // F3 fix: autonomy_level dari pilihan user (step4), capital dari step3.
      // Validasi: target_profit tanpa modal > 0 → invalid; capital 0 → objective "belajar dulu" (RESEARCH-only).
      const capitalApproved = v?.capital_available ?? "0.00";
      const goalType = v?.goal_type ?? null;
      await client.query(
        `INSERT INTO objectives (id, user_id, organization_id, title, business_mode, business_venture_id,
           target_profit, capital_approved, horizon_months, market, risk_tolerance, autonomy_level, environment, goal_type)
         VALUES ($1, $2, $3, $4, 'DISCOVERY', $5, $6, $7, $8, 'Indonesia', 'moderate', $9, 'SIMULATED', $10)`,
        [objId, session.userId, org.id, body.title, vrows[0].id,
         body.target_profit, capitalApproved, v?.time_horizon_months ?? 3, org.autonomyLevel, goalType],
      );
      // Start objective
      const startResult = await runAgentJob(client, { kind: "research", objectiveId: objId, idem: `onboarding:${objId}` }, opts.deps);
      // Mark onboarding complete
      await client.query(`UPDATE organizations SET onboarding_step = 5, onboarding_completed = now() WHERE id = $1`, [org.id]);
      return { objective_id: objId, started: startResult.ok, detail: startResult.detail };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════════
  // BILLING ENDPOINTS
  // ════════════════════════════════════════════════════════════════════════════

  app.get("/billing/plan", async (req) =>
    withClient(async (client, session) => {
      const org = await getOrgForUser(client, session.userId);
      if (!org) throw new ApiError(404, "NOT_FOUND", "organization tidak ditemukan");
      const { rows: subRows } = await client.query<{
        status: string; plan_id: string; current_period_end: string | null;
      }>(`SELECT status, plan_id, current_period_end::text FROM subscriptions WHERE organization_id = $1 LIMIT 1`, [org.id]);
      const { rows: planRows } = await client.query<{ tier: string; name: string; price_monthly: string; max_ai_credits_monthly: number }>(
        `SELECT tier, name, price_monthly::text, max_ai_credits_monthly FROM subscription_plans WHERE tier = $1`, [org.planTier],
      );
      const monthYear = new Date().toISOString().slice(0, 7);
      const { rows: usageRows } = await client.query<{ credits_used: number; credits_limit: number }>(
        `SELECT credits_used, credits_limit FROM usage_credits WHERE organization_id = $1 AND month_year = $2`,
        [org.id, monthYear],
      );
      // D1: belum ada baris usage bulan ini → limit tampil = limit plan (bukan 0
      // yang menyesatkan). used = 0 karena belum ada settle.
      const planLimit = planRows[0]?.max_ai_credits_monthly ?? 0;
      return {
        plan: planRows[0] ?? { tier: org.planTier, name: org.planTier, price_monthly: "0", max_ai_credits_monthly: 0 },
        subscription: subRows[0] ?? null,
        usage: usageRows[0] ?? { credits_used: 0, credits_limit: planLimit },
      };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS (role=admin / is_admin=true)
  // ════════════════════════════════════════════════════════════════════════════

  function requireAdmin(session: Session): void {
    if (!session.isAdmin && session.role !== "service") {
      throw new ApiError(403, "FORBIDDEN", "admin access required");
    }
  }

  app.get("/admin/overview", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const { rows: u } = await client.query<{ count: number }>(`SELECT count(*)::int FROM users`);
      const { rows: o } = await client.query<{ count: number }>(`SELECT count(*)::int FROM organizations`);
      const { rows: obj } = await client.query<{ count: number; state: string }>(
        `SELECT count(*)::int, state FROM objectives GROUP BY state`,
      );
      return {
        users: u[0]?.count ?? 0,
        orgs: o[0]?.count ?? 0,
        objectives: obj,
      };
    }, req),
  );

  app.get("/admin/users", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const { rows } = await client.query<{ id: string; email: string; role: string; name: string | null; status: string; is_admin: boolean }>(
        `SELECT id, email, role, name, status, is_admin FROM users ORDER BY created_at DESC LIMIT 200`,
      );
      return { users: rows };
    }, req),
  );

  app.patch<{ Params: { id: string } }>("/admin/users/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = z.object({
        role: z.enum(["owner", "operator", "auditor"]).optional(),
        status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]).optional(),
        is_admin: z.boolean().optional(),
      }).strict().parse(req.body);
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (body.role) { sets.push(`role = $${i++}`); vals.push(body.role); }
      if (body.status) { sets.push(`status = $${i++}`); vals.push(body.status); }
      if (body.is_admin !== undefined) { sets.push(`is_admin = $${i++}`); vals.push(body.is_admin); }
      if (sets.length === 0) throw new ApiError(422, "VALIDATION_ERROR", "tidak ada field untuk diupdate");
      vals.push(req.params.id);
      const { rows } = await client.query(
        `UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, email, role, name, status, is_admin`,
        vals,
      );
      if (!rows[0]) throw new ApiError(404, "NOT_FOUND", "user tidak ditemukan");
      return { user: rows[0] };
    }, req),
  );

  app.get("/admin/orgs", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const { rows } = await client.query<{ id: string; name: string; slug: string; plan_tier: string; member_count: number }>(
        `SELECT o.id, o.name, o.slug, o.plan_tier, (SELECT count(*)::int FROM memberships WHERE organization_id = o.id) AS member_count
         FROM organizations o ORDER BY o.created_at DESC LIMIT 200`,
      );
      return { orgs: rows };
    }, req),
  );

  app.get("/admin/objectives", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const { rows } = await client.query<{ id: string; title: string; state: string; user_email: string; org_name: string }>(
        `SELECT o.id, o.title, o.state, u.email AS user_email, org.name AS org_name
         FROM objectives o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN organizations org ON org.id = o.organization_id
         ORDER BY o.created_at DESC LIMIT 200`,
      );
      return { objectives: rows };
    }, req),
  );

  app.post<{ Params: { id: string } }>("/admin/objectives/:id/stop", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = z.object({ reason: z.string().min(3).max(500) }).strict().parse(req.body);
      const r = await advance(client, req.params.id, "stop_objective", opts.deps);
      if (!r.ok) throw new ApiError(409, "STATE_VIOLATION", r.reason);
      return { id: req.params.id, state: "STOPPED", reason: body.reason };
    }, req),
  );

  return app;
}
