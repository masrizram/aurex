/**
 * @aee/api — konteks bersama antar modul rute (§12/§13).
 *
 * Infrastruktur boundary API — BUKAN business logic:
 *   - ApiError + kode error standar §8
 *   - sesi (cookie → X-User-Id dev fallback, F12) + role rank
 *   - helper ownership anti-BOLA/IDOR (requireOwned*)
 *   - rate-limit login/signup/reset (D3, dua tingkat)
 *   - metering AI credits G9 (plan-aware, D1) + quota objective D1
 *   - parseBody Zod → 422 (F6)
 *
 * Setiap modul domain (routes/*.ts) menerima {@link RouteCtx} ini dan
 * mendaftarkan ruternya sendiri; buildApp menyusun semuanya di index.ts.
 */
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import type { FastifyInstance } from "fastify";
import type { OrchestratorDeps } from "@aee/orchestrator/runtime";
import { getSession, getOrgForUser } from "./auth.js";

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
  "IDEMPOTENCY_CONFLICT", "BILLING_UNCONFIGURED", "INTERNAL",
] as const;
type ErrorCode = (typeof ERROR_CODES)[number];

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

// ═══ G9: AI Usage Metering (pre-check + settle) ═════════════════════════════
// Flow: PRE-CHECK → EXECUTE → SETTLE. Balance <= 0 → tolak sebelum model call.
// D1 fix: metering kini plan-aware (credits_limit dari subscription_plans,
// bukan hardcode 0) dan pre-check TIDAK bypass saat baris usage belum ada —
// limit plan tetap berlaku (org tanpa baris usage = used 0).
//
// Catatan refactor: consumeAiCredit (settle lokal API) dihapus pada split ini —
// sejak awal tidak pernah dipanggil; settle produksi lewat
// consumeAiCreditsForCycle di @aee/orchestrator/runtime (sumber kebenaran).

interface UsageRowG9 { credits_used: number; credits_limit: number; credits_purchased: number }

/** D9 fix: NULL = unlimited TIDAK boleh di-coerce ke fallback konservatif.
 *  Fallback 100 hanya untuk kasus baris plan HILANG (query kosong). */
async function aiCreditsLimit(client: PoolClient, orgId: string): Promise<number | null> {
  const { rows } = await client.query<{ limit: number | null }>(
    `SELECT sp.max_ai_credits_monthly AS "limit"
     FROM organizations o JOIN subscription_plans sp ON sp.tier = o.plan_tier AND sp.is_active = true
     WHERE o.id = $1`, [orgId]);
  if (!rows[0]) return 100; // plan row hilang → fallback konservatif FREE
  return rows[0].limit;      // NULL = unlimited (ENTERPRISE)
}

export async function checkAiCreditsAvailable(client: PoolClient, orgId: string, needed = 1): Promise<void> {
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

/** D1 fix: quota objective per plan (max_objectives) — dipanggil sebelum INSERT
 *  objectives di SEMUA jalur pembuatan (POST /objectives + onboarding step5).
 *  D9 fix: NULL pada kolom plan = UNLIMITED — bukan nilai hilang. Coercion
 *  `?? 1` lama membuat ENTERPRISE/GROWTH terbatas 1 objective (bug produksi). */
export async function checkObjectiveQuota(client: PoolClient, userId: string, orgId: string, planTier: string): Promise<void> {
  const { rows: planRows } = await client.query<{ max_objectives: number | null }>(
    `SELECT sp.max_objectives FROM subscription_plans sp
     WHERE sp.tier = $1 AND sp.is_active = true`, [planTier]);
  const row = planRows[0];
  if (row?.max_objectives === null) return; // unlimited (GROWTH/ENTERPRISE)
  const maxObj = row?.max_objectives ?? 1;    // plan hilang → konservatif 1
  // P1 fix: quota = atribut ORGANIZATION (bukan per-user). Multi-member org
  // tidak boleh menembus limit plan. Legacy rows (organization_id NULL)
  // dihitung lewat user_id pemiliknya.
  const { rows: cnt } = await client.query<{ count: number }>(
    `SELECT count(*)::int FROM objectives
     WHERE (organization_id = $1 OR (organization_id IS NULL AND user_id = $2))
       AND state NOT IN ('STOPPED','ACHIEVED')`,
    [orgId, userId]);
  if ((cnt[0]?.count ?? 0) >= maxObj) {
    throw new ApiError(429, "RATE_LIMITED",
      `objective limit reached (${cnt[0]?.count ?? 0}/${maxObj}) — upgrade plan untuk lebih`);
  }
}

// ── Sesi (authN: cookie session → X-User-Id fallback) ───────────────────────

export interface Session { readonly userId: string; readonly role: string; readonly isAdmin: boolean }

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

/** Opsi builder app — kontrak publik @aee/api (tidak berubah). */
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

/** Dependensi yang dipakai modul rute untuk mendaftarkan endpoint. */
export interface RouteCtx {
  readonly pool: Pool;
  readonly deps: OrchestratorDeps;
  readonly webhookSecret: string;
  readonly dbHealth?: ApiOptions["dbHealth"];
  /** Raw body byte-exact per-request (WeakMap diisi content-type parser). */
  readonly rawBodies: WeakMap<object, string>;
  withClient<T>(fn: (client: PoolClient, session: Session) => Promise<T>, req: { headers: Record<string, string | string[] | undefined> }): Promise<T>;
  requireRole(session: Session, need: "auditor" | "operator" | "owner" | "service"): void;
  requireOwnedObjective(client: PoolClient, objectiveId: string, session: Session): Promise<void>;
  requireOwnedApproval(client: PoolClient, approvalId: string, session: Session): Promise<{ objective_id: string; status: string }>;
  parseBody<T>(schema: z.ZodType<T>, raw: unknown): T;
  idemKey(req: { headers: Record<string, string | string[] | undefined> }): string | null;
  rateLimit(key: string): void;
  rateLimitClear(key: string): void;
}

export function createRouteCtx(opts: ApiOptions, rawBodies: WeakMap<object, string>): RouteCtx {
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
  return {
    pool: opts.pool,
    deps: opts.deps,
    webhookSecret: opts.webhookSecret,
    dbHealth: opts.dbHealth,
    rawBodies,
    withClient,
    requireRole,
    requireOwnedObjective,
    requireOwnedApproval,
    parseBody,
    idemKey,
    rateLimit,
    rateLimitClear,
  };
}
