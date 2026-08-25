/**
 * @aee/api — rute billing (plan/usage org) + admin (overview/users/orgs/
 * objectives + aksi stop). Akses admin = is_admin atau role service.
 * (Diekstrak verbatim dari index.ts saat split §12/§13.)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { advance } from "@aee/orchestrator/runtime";
import { getOrgForUser } from "../auth.js";
import { ApiError, type RouteCtx, type Session } from "../context.js";

function requireAdmin(session: Session): void {
    if (!session.isAdmin && session.role !== "service") {
      throw new ApiError(403, "FORBIDDEN", "admin access required");
    }
}

/** Daftarkan rute billing + admin. */
export function registerBillingAdminRoutes(app: FastifyInstance, ctx: RouteCtx): void {
  const { withClient, parseBody, deps } = ctx;
  const opts = ctx;
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
}
