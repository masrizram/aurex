/**
 * @aee/api — rute inti: health readiness, business ventures, agent mode.
 * (Diekstrak verbatim dari index.ts saat split §12/§13.)
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { CreateVentureRequestSchema } from "@aee/contracts";
import { providerModeFromEnv } from "@aee/agents";
import { ApiError, type RouteCtx } from "../context.js";

/** Daftarkan rute inti (health / ventures / agent-mode). */
export function registerCoreRoutes(app: FastifyInstance, ctx: RouteCtx): void {
  const { withClient, requireRole, parseBody } = ctx;
  const opts = ctx;
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
      return providerModeFromEnv();
    }, req),
  );
}
