/**
 * @aee/api — rute admin.Control Center (spesifikasi "management console").
 *
 * Semua endpoint admin = is_admin ATAU role service (requireAdmin).
 * Prinsip (bukan "semua tabel editable"):
 *   * Users      — view detail, edit profile/role/status, suspend/activate,
 *                  grant/revoke admin. Hard delete HANYA bila aman (tidak ada
 *                  referensi). Audit setiap perubahan.
 *   * Orgs       — edit metadata, plan, members, membership, status.
 *   * Objectives — detail lengkap + ACTIONS via FSM resmi (advance), bukan
 *                  dropdown raw state. Stop/abort/resume legal only.
 *   * Approvals  — approve/reject (domain mengizinkan) via advance T34/T35.
 *   * Missions   — inspect, retry failed (re-enqueue), cancel legal state.
 *   * Billing    — lihat subscription, plan, quota, payment, Duitku invoices.
 *   * AiProviders— CRUD + encrypted key + test connection + routing.
 *   * System     — worker/queue/provider health.
 *   * Audit Log  — append-only, setiap privileged mutation.
 *   * Economics  — read-only (reversal via compensating transaction resmi, di
 *                  belakang; admin tidak mem-edit ledger langsung).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { advance } from "@aee/orchestrator/runtime";
import { getOrgForUser } from "../auth.js";
import { ApiError, type RouteCtx, type Session } from "../context.js";
import { writeAuditLog } from "../audit.js";
import { encryptSecret, decryptSecret, hashSecret } from "../crypto.js";

function requireAdmin(session: Session): void {
  if (!session.isAdmin && session.role !== "service") {
    throw new ApiError(403, "FORBIDDEN", "admin access required");
  }
}

// ── Validasi body (Zod, strict) ───────────────────────────────────────────────

const UserPatchSchema = z.object({
  role: z.enum(["owner", "operator", "auditor"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  is_admin: z.boolean().optional(),
  name: z.string().min(1).max(200).optional(),
}).strict();

const OrgPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  plan_tier: z.enum(["FREE", "STARTER", "GROWTH", "ENTERPRISE"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  autonomy_level: z.number().int().min(1).max(3).optional(),
}).strict();

const ObjectivePatchSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  environment: z.enum(["SIMULATED", "TEST", "REAL"]).optional(),
}).strict();

const ObjectiveActionSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
}).strict();

const StopReasonSchema = z.object({ reason: z.string().min(3).max(500) }).strict();

const MembershipPatchSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).optional(),
}).strict();

const ProviderPatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  base_url: z.string().url().optional(),
  api_key: z.string().min(8).optional(),
  model: z.string().min(1).max(100).optional(),
  role: z.enum(["STRATEGIC", "EXECUTION", "FALLBACK"]).optional(),
  is_primary: z.boolean().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
}).strict();

const ProviderCreateSchema = z.object({
  name: z.string().min(1).max(100),
  base_url: z.string().url(),
  api_key: z.string().min(8),
  model: z.string().min(1).max(100),
  role: z.enum(["STRATEGIC", "EXECUTION", "FALLBACK"]),
  is_primary: z.boolean().optional(),
}).strict();

// ── Test connection util (fetch /models kapabilitas OpenAI-compatible) ───────

async function testProviderConnection(baseUrl: string, apiKey: string, model: string): Promise<{ ok: boolean; message: string; latency_ms?: number }> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
    const latency = Date.now() - t0;
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}`, latency_ms: latency };
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const has = body.data?.some((m) => m.id && (m.id === model || m.id.includes(model)));
    return { ok: has !== false, message: has !== false ? `model ${model} tersedia` : `model ${model} tidak ditemukan di ${url}`, latency_ms: latency };
  } catch (e) {
    return { ok: false, message: `gagal reach ${url}: ${String((e as Error)?.message ?? e).slice(0, 120)}`, latency_ms: Date.now() - t0 };
  }
}

/** Daftarkan rute admin control center. */
export function registerBillingAdminRoutes(app: FastifyInstance, ctx: RouteCtx): void {
  const { withClient, parseBody, deps } = ctx;
  const opts = ctx;
  const ipOf = (req: { headers: Record<string, string | string[] | undefined>; ip?: string }): string | undefined => req.ip;

  // ════════════════════════════════════════════════════════════════════════
  // OVERVIEW
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/overview", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const u = await client.query<{ count: number }>(`SELECT count(*)::int FROM users`);
      const o = await client.query<{ count: number }>(`SELECT count(*)::int FROM organizations`);
      const obj = await client.query<{ count: number; state: string }>(
        `SELECT count(*)::int AS count, state FROM objectives GROUP BY state`);
      const prov = await client.query<{ count: number }>(`SELECT count(*)::int FROM ai_providers`);
      const pends = await client.query<{ count: number }>(`SELECT count(*)::int FROM approvals WHERE status='PENDING'`);
      const failedExec = await client.query<{ count: number }>(
        `SELECT count(*)::int FROM executions WHERE status IN ('FAILED','TIMED_OUT')`);
      const activeUsers = await client.query<{ count: number }>(
        `SELECT count(*)::int FROM users WHERE status='ACTIVE'`);
      const suspendedUsers = await client.query<{ count: number }>(
        `SELECT count(*)::int FROM users WHERE status='SUSPENDED'`);
      const plans = await client.query<{ tier: string; count: number }>(
        `SELECT plan_tier AS tier, count(*)::int AS count FROM organizations GROUP BY plan_tier ORDER BY plan_tier`);
      return {
        users: u.rows[0]?.count ?? 0,
        activeUsers: activeUsers.rows[0]?.count ?? 0,
        suspendedUsers: suspendedUsers.rows[0]?.count ?? 0,
        orgs: o.rows[0]?.count ?? 0,
        objectives: obj.rows,
        providers: prov.rows[0]?.count ?? 0,
        pendingApprovals: pends.rows[0]?.count ?? 0,
        failedExecutions: failedExec.rows[0]?.count ?? 0,
        orgsByPlan: plans.rows,
      };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════
  // USERS
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/users", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const q = req.query as { search?: string; status?: string; limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(q.limit ?? "50") || 50, 1), 200);
      const offset = Math.max(Number(q.offset ?? "0") || 0, 0);
      const search = q.search?.trim() || null;
      const status = (q.status && ["ACTIVE", "SUSPENDED", "DELETED"].includes(q.status)) ? q.status : null;
      const where = [
        search ? `(u.email ILIKE $1 OR u.name ILIKE $1)` : null,
        status ? `u.status = $${search ? 2 : 1}` : null,
      ].filter(Boolean).join(" AND ");
      const params: unknown[] = [];
      let i = 1;
      if (search) params.push(`%${search}%`);
      if (status) params.push(status);
      params.push(limit, offset);
      const { rows } = await client.query<{
        id: string; email: string; role: string; name: string | null; status: string; is_admin: boolean;
        created_at: string; org_count: number; objective_count: number;
      }>(
        `SELECT u.id, u.email, u.role, u.name, u.status, u.is_admin,
                u.created_at::text AS created_at,
                (SELECT count(*)::int FROM memberships m WHERE m.user_id = u.id) AS org_count,
                (SELECT count(*)::int FROM objectives ob WHERE ob.user_id = u.id) AS objective_count
         FROM users u
         ${where ? `WHERE ${where}` : ""}
         ORDER BY u.created_at DESC
         LIMIT ${params[params.length - 2]} OFFSET ${params[params.length - 1]}`,
        params,
      );
      return { users: rows };
    }, req),
  );

  // ── GET /admin/users/:id — detail lengkap + memberships ──────────────────
  app.get<{ Params: { id: string } }>("/admin/users/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const { rows } = await client.query(
        `SELECT u.id, u.email, u.role, u.name, u.status, u.is_admin,
                u.created_at::text AS created_at, u.updated_at::text AS updated_at,
                (SELECT json_agg(json_build_object('org_id', o.id, 'org_name', o.name,
                   'org_slug', o.slug, 'role', m.role, 'joined_at', m.joined_at::text))
                 FROM memberships m JOIN organizations o ON o.id = m.organization_id
                 WHERE m.user_id = u.id) AS memberships,
                (SELECT count(*)::int FROM objectives ob WHERE ob.user_id = u.id) AS objective_count,
                (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id) AS session_count
         FROM users u WHERE u.id = $1`, [req.params.id]);
      const user = rows[0];
      if (!user) throw new ApiError(404, "NOT_FOUND", "user tidak ditemukan");
      return { user };
    }, req),
  );

  // ── PATCH /admin/users/:id — edit profile/role/status/admin ──────────────
  app.patch<{ Params: { id: string }; Body: unknown }>("/admin/users/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = parseBody(UserPatchSchema, req.body);
      // Guard: admin tidak bisa menurunkan dirinya sendiri (mencegah lockout)
      if (session.userId === req.params.id && body.is_admin === false) {
        throw new ApiError(409, "STATE_VIOLATION", "tidak dapat mencabut admin dari diri sendiri");
      }
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (body.role !== undefined) { sets.push(`role = $${i++}`); vals.push(body.role); }
      if (body.status !== undefined) { sets.push(`status = $${i++}`); vals.push(body.status); }
      if (body.is_admin !== undefined) { sets.push(`is_admin = $${i++}`); vals.push(body.is_admin); }
      if (body.name !== undefined) { sets.push(`name = $${i++}`); vals.push(body.name); }
      if (sets.length === 0) throw new ApiError(422, "VALIDATION_ERROR", "tidak ada field untuk diupdate");
      vals.push(req.params.id);
      const { rows } = await client.query(
        `UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, email, role, name, status, is_admin`,
        vals,
      );
      if (!rows[0]) throw new ApiError(404, "NOT_FOUND", "user tidak ditemukan");
      await writeAuditLog(client, {
        actorId: session.userId, action: "users.update", target: `user:${req.params.id}`,
        detail: { updated: body }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { user: rows[0] };
    }, req),
  );

  // ── POST /admin/users/:id/suspend | /activate ────────────────────────────
  const setStatus = (status: "SUSPENDED" | "ACTIVE") => async (req: { params: { id: string }; headers: Record<string, string | string[] | undefined>; ip?: string }) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      if (session.userId === req.params.id) throw new ApiError(409, "STATE_VIOLATION", "tidak dapat mengubah status diri sendiri");
      const upd = await client.query(
        `UPDATE users SET status = $1 WHERE id = $2 RETURNING id, email, status`, [status, req.params.id]);
      if (!upd.rows[0]) throw new ApiError(404, "NOT_FOUND", "user tidak ditemukan");
      await writeAuditLog(client, {
        actorId: session.userId, action: `users.${status === "SUSPENDED" ? "suspend" : "activate"}`,
        target: `user:${req.params.id}`, detail: { status }, ip: req.ip, actorType: "ADMIN",
      });
      return { user: upd.rows[0] };
    }, req);
  app.post<{ Params: { id: string } }>("/admin/users/:id/suspend", setStatus("SUSPENDED"));
  app.post<{ Params: { id: string } }>("/admin/users/:id/activate", setStatus("ACTIVE"));

  // ── POST /admin/users/:id/grant-admin | /revoke-admin ────────────────────
  const setAdmin = (is_admin: boolean) => async (req: { params: { id: string }; headers: Record<string, string | string[] | undefined>; ip?: string }) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      if (session.userId === req.params.id && !is_admin) throw new ApiError(409, "STATE_VIOLATION", "tidak dapat mencabut admin dari diri sendiri");
      const upd = await client.query(
        `UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id, email, is_admin`, [is_admin, req.params.id]);
      if (!upd.rows[0]) throw new ApiError(404, "NOT_FOUND", "user tidak ditemukan");
      await writeAuditLog(client, {
        actorId: session.userId, action: is_admin ? "users.grant_admin" : "users.revoke_admin",
        target: `user:${req.params.id}`, detail: { is_admin }, ip: req.ip, actorType: "ADMIN",
      });
      return { user: upd.rows[0] };
    }, req);
  app.post<{ Params: { id: string } }>("/admin/users/:id/grant-admin", setAdmin(true));
  app.post<{ Params: { id: string } }>("/admin/users/:id/revoke-admin", setAdmin(false));

  // ── DELETE /admin/users/:id — hard delete HANYA bila aman ────────────────
  app.delete<{ Params: { id: string } }>("/admin/users/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      if (session.userId === req.params.id) throw new ApiError(409, "STATE_VIOLATION", "tidak dapat menghapus diri sendiri");
      // Dependency analysis: referensi ≥1 → tolak (bukan cascade diam).
      const refs = await client.query(
        `SELECT
           (SELECT count(*)::int FROM objectives WHERE user_id=$1) AS objectives,
           (SELECT count(*)::int FROM memberships WHERE user_id=$1) AS memberships,
           (SELECT count(*)::int FROM sessions WHERE user_id=$1) AS sessions,
           (SELECT count(*)::int FROM business_ventures WHERE user_id=$1) AS ventures,
           (SELECT count(*)::int FROM approvals WHERE decided_by=$1) AS approvals,
           (SELECT count(*)::int FROM audit_logs WHERE user_id=$1) AS audit_logs`,
        [req.params.id]);
      const r = refs.rows[0] ?? {};
      const sum = (r.objectives ?? 0) + (r.memberships ?? 0) + (r.sessions ?? 0) + (r.ventures ?? 0) + (r.approvals ?? 0) + (r.audit_logs ?? 0);
      if (sum > 0) {
        throw new ApiError(409, "STATE_VIOLATION",
          `user memiliki referensi (objectives=${r.objectives}, memberships=${r.memberships}, sessions=${r.sessions}, ventures=${r.ventures}, approvals=${r.approvals}, audit_logs=${r.audit_logs}) — gunakan suspend/soft-delete`);
      }
      const target = (await client.query(`SELECT email FROM users WHERE id=$1`, [req.params.id])).rows[0];
      await client.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
      await writeAuditLog(client, {
        actorId: session.userId, action: "users.hard_delete", target: `user:${req.params.id}`,
        detail: { email: target?.email ?? null }, ip: req.ip, actorType: "ADMIN",
      });
      return { deleted: true, id: req.params.id };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════
  // ORGANIZATIONS
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/orgs", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const q = req.query as { search?: string; plan?: string; limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(q.limit ?? "50") || 50, 1), 200);
      const offset = Math.max(Number(q.offset ?? "0") || 0, 0);
      const search = q.search?.trim() || null;
      const plan = (q.plan && ["FREE", "STARTER", "GROWTH", "ENTERPRISE"].includes(q.plan)) ? q.plan : null;
      let where = "";
      const params: unknown[] = [];
      let i = 1;
      if (search) { where += `(o.name ILIKE $${i} OR o.slug ILIKE $${i})`; params.push(`%${search}%`); i++; }
      if (plan) { if (where) where += " AND "; where += `o.plan_tier = $${i}`; params.push(plan); i++; }
      const { rows } = await client.query<{
        id: string; name: string; slug: string; plan_tier: string; status: string;
        member_count: number; objective_count: number; subscription_status: string | null;
      }>(
        `SELECT o.id, o.name, o.slug, o.plan_tier, o.status,
                (SELECT count(*)::int FROM memberships m WHERE m.organization_id = o.id) AS member_count,
                (SELECT count(*)::int FROM objectives ob WHERE ob.organization_id = o.id) AS objective_count,
                (SELECT status FROM subscriptions s WHERE s.organization_id = o.id LIMIT 1) AS subscription_status
         FROM organizations o
         ${where ? `WHERE ${where}` : ""}
         ORDER BY o.created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return { orgs: rows };
    }, req),
  );

  // ── GET /admin/orgs/:id — detail + members ───────────────────────────────
  app.get<{ Params: { id: string } }>("/admin/orgs/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const org = (await client.query(
        `SELECT o.id, o.name, o.slug, o.plan_tier, o.status, o.autonomy_level,
                o.onboarding_step, o.onboarding_completed::text AS onboarding_completed,
                o.created_at::text AS created_at, o.updated_at::text AS updated_at,
                (SELECT count(*)::int FROM objectives ob WHERE ob.organization_id = o.id) AS objective_count
         FROM organizations o WHERE o.id = $1`, [req.params.id])).rows[0];
      if (!org) throw new ApiError(404, "NOT_FOUND", "organisasi tidak ditemukan");
      const members = (await client.query(
        `SELECT m.id, m.user_id, m.role, m.joined_at::text AS joined_at,
                u.email, u.name, u.status AS user_status
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1
         ORDER BY m.role, u.email`, [req.params.id])).rows;
      const sub = (await client.query(
        `SELECT s.id, s.status, s.plan_id, s.current_period_start::text AS current_period_start,
                s.current_period_end::text AS current_period_end, s.cancel_at::text AS cancel_at,
                sp.name AS plan_name, sp.tier AS plan_tier
         FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
         WHERE s.organization_id = $1 LIMIT 1`, [req.params.id])).rows[0] ?? null;
      const usage = (await client.query(
        `SELECT month_year, credits_used, credits_limit, credits_purchased, created_at::text AS created_at
         FROM usage_credits WHERE organization_id = $1 ORDER BY month_year DESC LIMIT 6`, [req.params.id])).rows;
      return { organization: org, members, subscription: sub, usage };
    }, req),
  );

  // ── PATCH /admin/orgs/:id ────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: unknown }>("/admin/orgs/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = parseBody(OrgPatchSchema, req.body);
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      const MUTABLE = ["name", "plan_tier", "status", "autonomy_level"] as const;
      for (const f of MUTABLE) {
        const v = (body as Record<string, unknown>)[f];
        if (v !== undefined) { sets.push(`${f} = $${i++}`); vals.push(v); }
      }
      if (sets.length === 0) throw new ApiError(422, "VALIDATION_ERROR", "tidak ada field mutable");
      vals.push(req.params.id);
      const { rows } = await client.query(
        `UPDATE organizations SET ${sets.join(", ")}, updated_at = now() WHERE id = $${i}
         RETURNING id, name, slug, plan_tier, status, autonomy_level`,
        vals,
      );
      if (!rows[0]) throw new ApiError(404, "NOT_FOUND", "organisasi tidak ditemukan");
      await writeAuditLog(client, {
        actorId: session.userId, action: "orgs.update", target: `org:${req.params.id}`,
        detail: { updated: body }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { organization: rows[0] };
    }, req),
  );

  // ── PATCH /admin/orgs/:id/members/:userId ────────────────────────────────
  app.patch<{ Params: { id: string; userId: string }; Body: unknown }>(
    "/admin/orgs/:id/members/:userId", async (req) =>
      withClient(async (client, session) => {
        requireAdmin(session);
        const body = parseBody(MembershipPatchSchema, req.body);
        const upd = await client.query(
          `UPDATE memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3
           RETURNING id, user_id, role`, [body.role, req.params.id, req.params.userId]);
        if (!upd.rows[0]) throw new ApiError(404, "NOT_FOUND", "membership tidak ditemukan");
        await writeAuditLog(client, {
          actorId: session.userId, action: "orgs.update_member", target: `org:${req.params.id}:member:${req.params.userId}`,
          detail: { role: body.role }, ip: ipOf(req), actorType: "ADMIN",
        });
        return { membership: upd.rows[0] };
      }, req),
  );

  // ── POST /admin/orgs/:id/members — tambah member (by user id) ────────────
  app.post<{ Params: { id: string }; Body: unknown }>("/admin/orgs/:id/members", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = z.object({ user_id: z.string().uuid(), role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).default("MEMBER") }).strict().parse(req.body);
      const ins = await client.query(
        `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
         RETURNING id, user_id, role`, [req.params.id, body.user_id, body.role]);
      await writeAuditLog(client, {
        actorId: session.userId, action: "orgs.add_member", target: `org:${req.params.id}:member:${body.user_id}`,
        detail: { role: body.role }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { membership: ins.rows[0] };
    }, req),
  );

  // ── DELETE /admin/orgs/:id/members/:userId ───────────────────────────────
  app.delete<{ Params: { id: string; userId: string } }>("/admin/orgs/:id/members/:userId", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const del = await client.query(
        `DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2`, [req.params.id, req.params.userId]);
      if (del.rowCount === 0) throw new ApiError(404, "NOT_FOUND", "membership tidak ditemukan");
      await writeAuditLog(client, {
        actorId: session.userId, action: "orgs.remove_member", target: `org:${req.params.id}:member:${req.params.userId}`,
        detail: {}, ip: ipOf(req), actorType: "ADMIN",
      });
      return { removed: true };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════
  // OBJECTIVES — detail + resmi FSM actions
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/objectives", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const q = req.query as { state?: string; search?: string; limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(q.limit ?? "50") || 50, 1), 200);
      const offset = Math.max(Number(q.offset ?? "0") || 0, 0);
      const search = q.search?.trim() || null;
      const state = q.state?.trim() || null;
      let where = "";
      const params: unknown[] = [];
      let i = 1;
      if (search) { where += `(o.title ILIKE $${i} OR u.email ILIKE $${i})`; params.push(`%${search}%`); i++; }
      if (state) { if (where) where += " AND "; where += `o.state = $${i}`; params.push(state); i++; }
      const { rows } = await client.query<{
        id: string; title: string; state: string; environment: string; user_email: string; org_name: string | null;
        created_at: string; target_profit: string; capital_approved: string;
      }>(
        `SELECT o.id, o.title, o.state, o.environment, u.email AS user_email,
                COALESCE(org.name, '—') AS org_name,
                o.created_at::text AS created_at,
                o.target_profit::text AS target_profit, o.capital_approved::text AS capital_approved
         FROM objectives o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN organizations org ON org.id = o.organization_id
         ${where ? `WHERE ${where}` : ""}
         ORDER BY o.created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return { objectives: rows };
    }, req),
  );

  // ── GET /admin/objectives/:id — detail lengkap + lifecycle counts ────────
  app.get<{ Params: { id: string } }>("/admin/objectives/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const o = (await client.query(
        `SELECT o.id, o.title, o.state, o.row_version, o.current_cycle, o.autonomy_level,
                o.target_profit::text AS target_profit, o.capital_approved::text AS capital_approved,
                o.horizon_months, o.market, o.risk_tolerance, o.business_mode, o.environment,
                o.goal_type, o.created_at::text AS created_at, o.deadline::text AS deadline,
                u.email AS user_email, u.id AS user_id,
                v.name AS venture_name, v.industry AS venture_industry
         FROM objectives o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN business_ventures v ON v.id = o.business_venture_id
         WHERE o.id = $1`, [req.params.id])).rows[0];
      if (!o) throw new ApiError(404, "NOT_FOUND", "objective tidak ditemukan");
      const counts = (await client.query<{
        opportunities: number; experiments: number; missions: number; decisions: number;
        results: number; approvals_pending: number; executions_failed: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM opportunities WHERE objective_id = $1) AS opportunities,
           (SELECT count(*)::int FROM experiments WHERE objective_id = $1) AS experiments,
           (SELECT count(*)::int FROM missions WHERE objective_id = $1) AS missions,
           (SELECT count(*)::int FROM decisions WHERE objective_id = $1) AS decisions,
           (SELECT count(*)::int FROM execution_results er JOIN executions ex ON ex.id = er.execution_id
              JOIN missions m ON m.id = ex.mission_id WHERE m.objective_id = $1) AS results,
           (SELECT count(*)::int FROM approvals WHERE objective_id = $1 AND status = 'PENDING') AS approvals_pending,
           (SELECT count(*)::int FROM executions ex JOIN missions m ON m.id = ex.mission_id
              WHERE m.objective_id = $1 AND ex.status IN ('FAILED','TIMED_OUT')) AS executions_failed`,
        [req.params.id])).rows[0] ?? {};
      const missions = (await client.query(
        `SELECT m.id, m.status, m.priority, m.current_version, m.created_at::text AS created_at,
                mv.package->>'title' AS title, mv.package->>'budget' AS budget,
                (SELECT count(*)::int FROM executions ex WHERE ex.mission_id = m.id) AS execution_count
         FROM missions m LEFT JOIN mission_versions mv ON mv.mission_id = m.id AND mv.version = m.current_version
         WHERE m.objective_id = $1 ORDER BY m.created_at DESC LIMIT 20`, [req.params.id])).rows;
      const approvals = (await client.query(
        `SELECT a.id, a.category, a.status, a.why_required, a.capital_at_risk::text AS capital_at_risk,
                a.expires_at::text AS expires_at, a.created_at::text AS created_at
         FROM approvals a WHERE a.objective_id = $1 ORDER BY a.created_at DESC LIMIT 20`, [req.params.id])).rows;
      return { objective: o, counts, missions, approvals };
    }, req),
  );

  // ── PATCH /admin/objectives/:id — edit MUTABLE metadata saja ─────────────
  app.patch<{ Params: { id: string }; Body: unknown }>("/admin/objectives/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = parseBody(ObjectivePatchSchema, req.body);
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (body.title !== undefined) { sets.push(`title = $${i++}`); vals.push(body.title); }
      if (body.environment !== undefined) { sets.push(`environment = $${i++}`); vals.push(body.environment); }
      if (sets.length === 0) throw new ApiError(422, "VALIDATION_ERROR", "tidak ada field mutable");
      vals.push(req.params.id);
      const { rows } = await client.query(
        `UPDATE objectives SET ${sets.join(", ")}, updated_at = now() WHERE id = $${i}
         RETURNING id, title, state, environment`, vals);
      if (!rows[0]) throw new ApiError(404, "NOT_FOUND", "objective tidak ditemukan");
      await writeAuditLog(client, {
        actorId: session.userId, action: "objectives.update", target: `objective:${req.params.id}`,
        detail: { updated: body }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { objective: rows[0] };
    }, req),
  );

  // ── POST /admin/objectives/:id/stop — T38 FSM resmi ──────────────────────
  app.post<{ Params: { id: string }; Body: unknown }>("/admin/objectives/:id/stop", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = parseBody(StopReasonSchema, req.body);
      const r = await advance(client, req.params.id, "stop_objective", opts.deps);
      if (!r.ok) throw new ApiError(409, "STATE_VIOLATION", r.reason);
      await writeAuditLog(client, {
        actorId: session.userId, action: "objectives.stop", target: `objective:${req.params.id}`,
        detail: { reason: body.reason, to: "STOPPED" }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { id: req.params.id, state: "STOPPED", reason: body.reason };
    }, req),
  );

  // ── POST /admin/objectives/:id/resume — T36 (BLOCKED→RESEARCHING) resmi ──
  app.post<{ Params: { id: string }; Body: unknown }>("/admin/objectives/:id/resume", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = parseBody(ObjectiveActionSchema, req.body ?? {});
      // T36: BLOCKED → RESEARCHING (resume, guard human_action — admin = manusia).
      const r = await advance(client, req.params.id, "resume", opts.deps);
      if (!r.ok) throw new ApiError(409, "STATE_VIOLATION", r.reason);
      await writeAuditLog(client, {
        actorId: session.userId, action: "objectives.resume", target: `objective:${req.params.id}`,
        detail: { reason: body.reason ?? "", to: "RESEARCHING" }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { id: req.params.id, state: "RESEARCHING" };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════
  // APPROVALS — admin dapat approve/reject (domain mengizinkan)
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/approvals", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const q = req.query as { status?: string; limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(q.limit ?? "50") || 50, 1), 200);
      const offset = Math.max(Number(q.offset ?? "0") || 0, 0);
      const status = (q.status && ["PENDING", "APPROVED", "REJECTED", "EXPIRED"].includes(q.status)) ? q.status : null;
      const where = status ? `WHERE a.status = $1` : "";
      const params: unknown[] = status ? [status, limit, offset] : [limit, offset];
      const rows = (await client.query(
        `SELECT a.id, a.objective_id, a.category, a.status, a.resume_state,
                a.capital_at_risk::text AS capital_at_risk, a.why_required,
                a.expires_at::text AS expires_at, a.decided_at::text AS decided_at,
                a.created_at::text AS created_at,
                o.title AS objective_title, u.email AS owner_email
         FROM approvals a
         JOIN objectives o ON o.id = a.objective_id
         LEFT JOIN users u ON u.id = o.user_id
         ${where} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params)).rows;
      return { approvals: rows };
    }, req),
  );

  // ── POST /admin/approvals/:id/approve ────────────────────────────────────
  app.post<{ Params: { id: string }; Body: unknown }>("/admin/approvals/:id/approve", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = z.object({ note: z.string().max(500).optional() }).strict().parse(req.body ?? {});
      const ap = (await client.query<{ objective_id: string; status: string }>(
        `SELECT objective_id, status FROM approvals WHERE id = $1`, [req.params.id])).rows[0];
      if (!ap) throw new ApiError(404, "NOT_FOUND", "approval tidak ditemukan");
      if (ap.status === "APPROVED") return { approval: req.params.id, status: "APPROVED", idempoten: true };
      if (ap.status !== "PENDING") throw new ApiError(409, "CONFLICT", `approval ${ap.status} — tidak bisa di-approve`);
      await client.query(
        `UPDATE approvals SET status='APPROVED', decided_by=$2, decided_at=now(),
           payload = payload || $3::jsonb WHERE id = $1`,
        [req.params.id, session.userId, JSON.stringify({ note: body.note ?? "", by: "ADMIN" })]);
      const r = await advance(client, ap.objective_id, "approve", opts.deps);
      if (!r.ok) throw new ApiError(409, "STATE_VIOLATION", r.reason);
      // T13 mission approve bila resume → MISSION_APPROVED
      const r13 = await advance(client, ap.objective_id, "approve", opts.deps, (ctx) => ({
        ...ctx, mission: ctx.mission ? { ...ctx.mission, humanApproved: true } : ctx.mission,
      }));
      if (!r13.ok) throw new ApiError(409, "STATE_VIOLATION", r13.reason);
      const mission = (await client.query<{ id: string }>(
        `SELECT m.id FROM missions m WHERE m.objective_id=$1 ORDER BY m.created_at DESC LIMIT 1`, [ap.objective_id])).rows[0];
      if (mission) await deps.queue.enqueue({ kind: "dispatch_glm", objectiveId: ap.objective_id, idem: `dispatch:${mission.id}:1` });
      await writeAuditLog(client, {
        actorId: session.userId, action: "approvals.approve", target: `approval:${req.params.id}`,
        detail: { objective_id: ap.objective_id, note: body.note ?? "" }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { approval: req.params.id, status: "APPROVED", resumed_to: r.transition.to };
    }, req),
  );

  // ── POST /admin/approvals/:id/reject ─────────────────────────────────────
  app.post<{ Params: { id: string }; Body: unknown }>("/admin/approvals/:id/reject", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = z.object({ reason: z.string().min(3).max(500) }).strict().parse(req.body);
      const ap = (await client.query<{ objective_id: string; status: string }>(
        `SELECT objective_id, status FROM approvals WHERE id = $1`, [req.params.id])).rows[0];
      if (!ap) throw new ApiError(404, "NOT_FOUND", "approval tidak ditemukan");
      if (ap.status === "REJECTED") return { approval: req.params.id, status: "REJECTED", idempoten: true };
      if (ap.status !== "PENDING") throw new ApiError(409, "CONFLICT", `approval ${ap.status} — tidak bisa ditolak`);
      await client.query(
        `UPDATE approvals SET status='REJECTED', decided_by=$2, decided_at=now(),
           payload = payload || $3::jsonb WHERE id = $1`,
        [req.params.id, session.userId, JSON.stringify({ reason: body.reason, by: "ADMIN" })]);
      const r = await advance(client, ap.objective_id, "reject/timeout", opts.deps);
      if (!r.ok) throw new ApiError(409, "STATE_VIOLATION", r.reason);
      await writeAuditLog(client, {
        actorId: session.userId, action: "approvals.reject", target: `approval:${req.params.id}`,
        detail: { objective_id: ap.objective_id, reason: body.reason }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { approval: req.params.id, status: "REJECTED", state: r.transition.to };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════
  // MISSIONS / EXECUTIONS — inspect, retry failed, cancel legal
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/missions", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const q = req.query as { status?: string; limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(q.limit ?? "50") || 50, 1), 200);
      const offset = Math.max(Number(q.offset ?? "0") || 0, 0);
      const status = q.status?.trim() || null;
      const where = status ? `WHERE m.status = $1` : "";
      const params: unknown[] = status ? [status, limit, offset] : [limit, offset];
      const rows = (await client.query(
        `SELECT m.id, m.status, m.priority, m.current_version, m.created_at::text AS created_at,
                m.objective_id, o.title AS objective_title,
                mv.package->>'title' AS mission_title, mv.package->>'budget' AS budget,
                (SELECT count(*)::int FROM executions ex WHERE ex.mission_id = m.id) AS execution_count
         FROM missions m
         JOIN objectives o ON o.id = m.objective_id
         LEFT JOIN mission_versions mv ON mv.mission_id = m.id AND mv.version = m.current_version
         ${where} ORDER BY m.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params)).rows;
      return { missions: rows };
    }, req),
  );

  // ── GET /admin/executions — list executions (untuk retry/cancel by admin) ──
  app.get("/admin/executions", async (req) => {
    const q = req.query as { mission_id?: string; status?: string; limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? "50") || 50, 1), 200);
    const offset = Math.max(Number(q.offset ?? "0") || 0, 0);
    const conds: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (q.mission_id) { conds.push(`e.mission_id = $${i}`); params.push(q.mission_id); i++; }
    if (q.status) { conds.push(`e.status = $${i}`); params.push(q.status); i++; }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    params.push(limit, offset);
    return withClient(async (client, session) => {
      requireAdmin(session);
      const rows = (await client.query(
        `SELECT e.id, e.mission_id, e.mission_version, e.attempt, e.status, e.provider,
                e.provider_job_ref, e.started_at::text AS started_at, e.finished_at::text AS finished_at,
                m.objective_id, o.title AS objective_title,
                mv.package->>'title' AS mission_title,
                er.verification_tier, er.revenue_claimed::text AS revenue_claimed
         FROM executions e
         JOIN missions m ON m.id = e.mission_id
         JOIN objectives o ON o.id = m.objective_id
         LEFT JOIN mission_versions mv ON mv.mission_id = e.mission_id AND mv.version = e.mission_version
         LEFT JOIN execution_results er ON er.execution_id = e.id
         ${where} ORDER BY e.started_at DESC NULLS LAST, e.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params)).rows;
      return { executions: rows };
    }, req);
  });

  // ── GET /admin/executions/:id — detail execution + result ────────────────
  app.get<{ Params: { id: string } }>("/admin/executions/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const ex = (await client.query(
        `SELECT e.id, e.mission_id, e.mission_version, e.attempt, e.status, e.provider,
                e.provider_job_ref, e.started_at::text AS started_at, e.finished_at::text AS finished_at,
                m.objective_id, o.title AS objective_title,
                er.verification_tier, er.revenue_claimed::text AS revenue_claimed,
                er.cost_claimed::text AS cost_claimed, er.created_at::text AS result_created_at
         FROM executions e
         JOIN missions m ON m.id = e.mission_id
         JOIN objectives o ON o.id = m.objective_id
         LEFT JOIN execution_results er ON er.execution_id = e.id
         WHERE e.id = $1`, [req.params.id])).rows[0];
      if (!ex) throw new ApiError(404, "NOT_FOUND", "execution tidak ditemukan");
      return { execution: ex };
    }, req),
  );

  // ── POST /admin/executions/:id/retry ─────────────────────────────────────
  app.post<{ Params: { id: string }; Body: unknown }>("/admin/executions/:id/retry", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = parseBody(ObjectiveActionSchema, req.body ?? {});
      const ex = (await client.query<{ id: string; mission_id: string; mission_version: number; status: string }>(
        `SELECT id, mission_id, mission_version, status FROM executions WHERE id = $1`, [req.params.id])).rows[0];
      if (!ex) throw new ApiError(404, "NOT_FOUND", "execution tidak ditemukan");
      if (!["FAILED", "TIMED_OUT"].includes(ex.status)) {
        throw new ApiError(409, "STATE_VIOLATION", `execution status=${ex.status} bukan FAILED/TIMED_OUT — tidak bisa retry`);
      }
      // Buat attempt baru (mission_version + attempt+1), re-enqueue dispatch.
      const attempt = ex.mission_version + 1;
      // Re-enqueue job dispatch_glm untuk objective terkait.
      const objId = (await client.query<{ objective_id: string }>(
        `SELECT objective_id FROM missions WHERE id = $1`, [ex.mission_id])).rows[0]?.objective_id;
      if (!objId) throw new ApiError(404, "NOT_FOUND", "objective misi tidak ditemukan");
      await deps.queue.enqueue({
        kind: "dispatch_glm", objectiveId: objId,
        idem: `retry:${ex.mission_id}:${attempt}:${Date.now()}`,
      });
      await writeAuditLog(client, {
        actorId: session.userId, action: "executions.retry", target: `execution:${req.params.id}`,
        detail: { mission_id: ex.mission_id, new_attempt: attempt, reason: body.reason ?? "" }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { queued: true, execution: req.params.id, new_attempt: attempt };
    }, req),
  );

  // ── POST /admin/executions/:id/cancel — hanya state legal (QUEUED/RUNNING) ─
  app.post<{ Params: { id: string }; Body: unknown }>("/admin/executions/:id/cancel", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = parseBody(ObjectiveActionSchema, req.body ?? {});
      const ex = (await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM executions WHERE id = $1`, [req.params.id])).rows[0];
      if (!ex) throw new ApiError(404, "NOT_FOUND", "execution tidak ditemukan");
      if (!["QUEUED", "RUNNING"].includes(ex.status)) {
        throw new ApiError(409, "STATE_VIOLATION", `execution status=${ex.status} bukan QUEUED/RUNNING — tidak bisa cancel`);
      }
      await client.query(`UPDATE executions SET status = 'CANCELLED', finished_at = now() WHERE id = $1`, [req.params.id]);
      await writeAuditLog(client, {
        actorId: session.userId, action: "executions.cancel", target: `execution:${req.params.id}`,
        detail: { reason: body.reason ?? "" }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { cancelled: true, execution: req.params.id };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════
  // BILLING — subscription, plan, quota, Duitku invoices
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/billing", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const q = req.query as { org_id?: string; limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(q.limit ?? "50") || 50, 1), 200);
      const offset = Math.max(Number(q.offset ?? "0") || 0, 0);
      const orgId = q.org_id?.trim() || null;
      const where = orgId ? `WHERE s.organization_id = $1` : "";
      const params: unknown[] = orgId ? [orgId, limit, offset] : [limit, offset];
      const subs = (await client.query(
        `SELECT s.id, s.organization_id, o.name AS org_name, o.slug AS org_slug,
                s.status, s.plan_id, sp.name AS plan_name, sp.tier AS plan_tier,
                sp.price_monthly::text AS price_monthly, sp.max_ai_credits_monthly AS max_ai_credits_monthly,
                s.current_period_start::text AS current_period_start,
                s.current_period_end::text AS current_period_end,
                s.cancel_at::text AS cancel_at
         FROM subscriptions s
         JOIN organizations o ON o.id = s.organization_id
         JOIN subscription_plans sp ON sp.id = s.plan_id
         ${where} ORDER BY s.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params)).rows;
      // Quota usage per org (bulan ini) + total invoice Duitku
      const usage = (await client.query(
        `SELECT organization_id, month_year, credits_used, credits_limit, credits_purchased
         FROM usage_credits WHERE ($1::uuid IS NULL OR organization_id = $1::uuid)
         ORDER BY month_year DESC LIMIT ${limit}`, [orgId])).rows;
      const invoices = (await client.query(
        `SELECT bi.id, bi.organization_id, o.name AS org_name, bi.plan_tier, bi.period_months,
                bi.amount::text AS amount, bi.status, bi.merchant_order_id,
                bi.duitku_reference, bi.payment_url, bi.created_at::text AS created_at
         FROM billing_invoices bi
         JOIN organizations o ON o.id = bi.organization_id
         WHERE ($1::uuid IS NULL OR bi.organization_id = $1::uuid)
         ORDER BY bi.created_at DESC LIMIT ${limit}`, [orgId])).rows;
      return { subscriptions: subs, usage, invoices };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════
  // AI PROVIDERS — CRUD + encrypted key + test + routing
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/providers", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const { rows } = await client.query<{
        id: string; name: string; provider: string; base_url: string; model: string;
        role: string; is_primary: boolean; status: string;
        api_key_set: boolean; last_health_check_at: string | null; last_health_ok: boolean | null;
        last_health_message: string | null; created_at: string;
      }>(
        `SELECT id, name, provider, base_url, model, role, is_primary, status,
                (api_key_cipher IS NOT NULL) AS api_key_set,
                CASE WHEN api_key_hash IS NOT NULL AND length(api_key_hash) >= 8
                     THEN '…' || right(api_key_hash, 4) END AS api_key_preview,
                last_health_check_at::text AS last_health_check_at,
                last_health_ok, last_health_message,
                created_at::text AS created_at
         FROM ai_providers ORDER BY role, name`);
      return { providers: rows };
    }, req),
  );

  // ── POST /admin/providers — create (api_key selalu di-encrypt; 201 konvensi) ─
  app.post<{ Body: unknown }>("/admin/providers", async (req, reply) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = parseBody(ProviderCreateSchema, req.body);
      // Uniqueness per role primary: bila is_primary, set semua role lain nyadari non-primary.
      if (body.is_primary) {
        await client.query(`UPDATE ai_providers SET is_primary = false WHERE role = $1 AND is_primary`, [body.role]);
      }
      const cipher = encryptSecret(body.api_key);
      const { rows } = await client.query(
        `INSERT INTO ai_providers (name, provider, base_url, api_key_cipher, api_key_hash, model, role, is_primary, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE')
         RETURNING id, name, provider, base_url, model, role, is_primary, status,
                   (api_key_cipher IS NOT NULL) AS api_key_set,
                   CASE WHEN api_key_hash IS NOT NULL AND length(api_key_hash) >= 8
                        THEN '…' || right(api_key_hash, 4) END AS api_key_preview`,
        [body.name, "openai_compatible", body.base_url, cipher, hashSecret(body.api_key), body.model, body.role, body.is_primary ?? false]);
      await writeAuditLog(client, {
        actorId: session.userId, action: "providers.create", target: `provider:${rows[0].id}`,
        detail: { name: body.name, role: body.role, model: body.model, base_url: body.base_url }, ip: ipOf(req), actorType: "ADMIN",
      });
      void reply.status(201).send({ provider: rows[0] });
    }, req),
  );

  // ── PATCH /admin/providers/:id — edit (api_key optional; re-encrypt bila ada) ─
  app.patch<{ Params: { id: string }; Body: unknown }>("/admin/providers/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const body = parseBody(ProviderPatchSchema, req.body);
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (body.name !== undefined) { sets.push(`name = $${i++}`); vals.push(body.name); }
      if (body.base_url !== undefined) { sets.push(`base_url = $${i++}`); vals.push(body.base_url); }
      if (body.model !== undefined) { sets.push(`model = $${i++}`); vals.push(body.model); }
      if (body.role !== undefined) {
        if (body.is_primary) await client.query(`UPDATE ai_providers SET is_primary = false WHERE role = $1 AND is_primary`, [body.role]);
        sets.push(`role = $${i++}`); vals.push(body.role);
      }
      if (body.is_primary !== undefined) {
        if (body.is_primary) await client.query(`UPDATE ai_providers SET is_primary = false WHERE role = $1`, [body.role ?? (await client.query<{ role: string }>(`SELECT role FROM ai_providers WHERE id=$1`, [req.params.id])).rows[0]?.role]);
        sets.push(`is_primary = $${i++}`); vals.push(body.is_primary);
      }
      if (body.status !== undefined) { sets.push(`status = $${i++}`); vals.push(body.status); }
      if (body.api_key !== undefined) {
        sets.push(`api_key_cipher = $${i++}`, `api_key_hash = $${i++}`);
        const cipher = encryptSecret(body.api_key);
        vals.push(cipher, hashSecret(body.api_key));
      }
      if (sets.length === 0) throw new ApiError(422, "VALIDATION_ERROR", "tidak ada field untuk diupdate");
      vals.push(req.params.id);
      const { rows } = await client.query(
        `UPDATE ai_providers SET ${sets.join(", ")}, updated_at = now() WHERE id = $${i}
         RETURNING id, name, provider, base_url, model, role, is_primary, status, (api_key_cipher IS NOT NULL) AS api_key_set`,
        vals);
      if (!rows[0]) throw new ApiError(404, "NOT_FOUND", "provider tidak ditemukan");
      await writeAuditLog(client, {
        actorId: session.userId, action: "providers.update", target: `provider:${req.params.id}`,
        detail: { updated: Object.fromEntries(Object.entries(body).filter(([k]) => k !== "api_key")) }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { provider: rows[0] };
    }, req),
  );

  // ── DELETE /admin/providers/:id ──────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/admin/providers/:id", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const del = await client.query(`DELETE FROM ai_providers WHERE id = $1 RETURNING id, name`, [req.params.id]);
      if (!del.rows[0]) throw new ApiError(404, "NOT_FOUND", "provider tidak ditemukan");
      await writeAuditLog(client, {
        actorId: session.userId, action: "providers.delete", target: `provider:${req.params.id}`,
        detail: { name: del.rows[0].name }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { deleted: true };
    }, req),
  );

  // ── POST /admin/providers/:id/test-connection ────────────────────────────
  app.post<{ Params: { id: string } }>("/admin/providers/:id/test-connection", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const p = (await client.query<{ base_url: string; api_key_cipher: Buffer | null; model: string }>(
        `SELECT base_url, api_key_cipher, model FROM ai_providers WHERE id = $1`, [req.params.id])).rows[0];
      if (!p) throw new ApiError(404, "NOT_FOUND", "provider tidak ditemukan");
      if (!p.api_key_cipher) throw new ApiError(409, "STATE_VIOLATION", "provider belum memiliki api_key terenkripsi");
      const key = decryptSecret(p.api_key_cipher);
      if (!key) throw new ApiError(409, "STATE_VIOLATION", "api_key terenkripsi tidak dapat didekripsi (key berubah?)");
      const res = await testProviderConnection(p.base_url, key, p.model);
      await client.query(
        `UPDATE ai_providers SET last_health_check_at = now(), last_health_ok = $1, last_health_message = $2 WHERE id = $3`,
        [res.ok, res.message, req.params.id]);
      await writeAuditLog(client, {
        actorId: session.userId, action: "providers.test", target: `provider:${req.params.id}`,
        detail: { ok: res.ok, message: res.message }, ip: ipOf(req), actorType: "ADMIN",
      });
      return { ok: res.ok, message: res.message, latency_ms: res.latency_ms ?? null };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════
  // SYSTEM — worker/queue/provider health
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/system", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      // pg_boss membuat schema-nya sendiri saat worker start pertama; API harus
      // tetap sehat bila queue belum pernah jalan (dev/prod baru).
      const bossSchemaExists = (await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.table_privileges
                        WHERE table_schema = 'pg_boss' AND table_name = 'job') AS ok`)).rows[0]?.ok === true;
      let queue = { queued: 0, active: 0, failed: 0, completed: 0 };
      if (bossSchemaExists) {
        const [q, f, a, c] = await Promise.all([
          client.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_boss.job WHERE state='queued'`),
          client.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_boss.job WHERE state='failed'`),
          client.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_boss.job WHERE state='active'`),
          client.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_boss.job WHERE state='completed'`),
        ]);
        queue = {
          queued: q.rows[0]?.n ?? 0, active: a.rows[0]?.n ?? 0,
          failed: f.rows[0]?.n ?? 0, completed: c.rows[0]?.n ?? 0,
        };
      }
      const events = (await client.query<{ count: number }>(`SELECT count(*)::int FROM events`)).rows[0]?.count ?? 0;
      const modelRuns = (await client.query<{ count: number; failed: number; cost: string | null }>(
        `SELECT count(*)::int AS count,
                count(*) FILTER (WHERE status <> 'SUCCEEDED')::int AS failed,
                sum(cost)::text AS cost FROM model_runs`)).rows[0] ?? { count: 0, failed: 0, cost: null };
      const providers = (await client.query(
        `SELECT name, model, role, status, is_primary, last_health_ok, last_health_message,
                last_health_check_at::text AS last_health_check_at
         FROM ai_providers ORDER BY role, name`)).rows;
      // Uptime metode: created_at penyebaran terbaru & ringkasan runtime (env)
      return {
        queue,
        events_count: events,
        model_runs: modelRuns,
        providers,
        mode: process.env.AEE_MODE ?? "production",
        node_env: process.env.NODE_ENV ?? "production",
      };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════
  // AUDIT LOG — append-only read
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/audit", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const q = req.query as { action?: string; user_id?: string; limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(q.limit ?? "50") || 50, 1), 200);
      const offset = Math.max(Number(q.offset ?? "0") || 0, 0);
      const conds: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (q.action) { conds.push(`al.action = $${i}`); params.push(q.action); i++; }
      if (q.user_id) { conds.push(`al.user_id = $${i}`); params.push(q.user_id); i++; }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      // limit/offset sudah disanitasi jadi number — interpolasi, JANGAN masuk params
      // (mismatch bind bila filter aktif: "supplies N parameters, requires M").
      const { rows } = await client.query(
        `SELECT al.id, al.user_id, u.email AS actor_email, al.action, al.target, al.detail,
                al.ip::text AS ip, al.created_at::text AS created_at
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         ${where} ORDER BY al.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params);
      return { audit: rows };
    }, req),
  );

  // ════════════════════════════════════════════════════════════════════════
  // ECONOMICS — read-only agregat (reversal via compensating transaction resmi)
  // ════════════════════════════════════════════════════════════════════════
  app.get("/admin/economics", async (req) =>
    withClient(async (client, session) => {
      requireAdmin(session);
      const q = req.query as { objective_id?: string; limit?: string };
      const limit = Math.min(Math.max(Number(q.limit ?? "50") || 50, 1), 200);
      const objId = q.objective_id?.trim() || null;
      const where = objId ? `WHERE t.objective_id = $1` : "";
      const params: unknown[] = objId ? [objId, limit] : [limit];
      const ledgers = (await client.query(
        `SELECT t.id, t.objective_id, o.title AS objective_title, t.debit_account, t.credit_account,
                t.amount::text AS amount, t.verification_tier, t.memo, t.created_at::text AS created_at
         FROM capital_transactions t
         JOIN objectives o ON o.id = t.objective_id
         ${where} ORDER BY t.created_at DESC LIMIT ${limit}`, params)).rows;
      const summary = (await client.query(
        `SELECT
           COALESCE(sum(amount) FILTER (WHERE verification_tier='RECONCILED' AND credit_account='REVENUE'),0)::text AS verified_revenue,
           COALESCE(sum(amount) FILTER (WHERE verification_tier='RECONCILED' AND debit_account='COGS'),0)::text AS verified_cost,
           COALESCE(sum(amount) FILTER (WHERE debit_account='DRAWDOWN'),0)::text AS total_drawdown,
           count(*)::int AS transactions
         FROM capital_transactions ${where}`, params)).rows[0] ?? {};
      return { ledgers, summary };
    }, req),
  );
}
