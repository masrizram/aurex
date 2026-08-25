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
 * Struktur (split §12/§13 — satu kepemilikan per domain):
 *   context.ts              — ApiError, sesi, ownership, rate-limit, G9 metering
 *   routes/core.ts          — health / ventures / agent-mode
 *   routes/objectives.ts    — objectives + opportunities + product reads
 *   routes/approvals-webhooks.ts — approvals, webhook HMAC, executions callback
 *   routes/auth-onboarding.ts    — authN/lifecycle, onboarding wizard, dev seed
 *   routes/admin.ts         — billing plan + admin
 *   routes/static.ts        — landing & dashboard HTML
 */
import Fastify from "fastify";
import { ApiError, createRouteCtx, type ApiOptions } from "./context.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerObjectivesRoutes } from "./routes/objectives.js";
import { registerApprovalRoutes } from "./routes/approvals-webhooks.js";
import { registerAuthOnboardingRoutes } from "./routes/auth-onboarding.js";
import { registerBillingAdminRoutes } from "./routes/admin.js";
import { registerStaticRoutes } from "./routes/static.js";

export { ApiError, type ApiOptions, type Session } from "./context.js";

export function buildApp(opts: ApiOptions) {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
    // D3: di balik Fly.io reverse proxy, req.ip harus diambil dari header
    // Fly-Client-IP (atau X-Forwarded-For) — tanpa ini semua request tampak
    // dari IP internal Fly (rate-limit per-IP jadi tidak bermakna).
    trustProxy: true,
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

  const ctx = createRouteCtx(opts, rawBodies);

  // ── Registrasi rute per domain (satu kepemilikan per modul) ──────────────
  registerCoreRoutes(app, ctx);
  registerObjectivesRoutes(app, ctx);
  registerApprovalRoutes(app, ctx);
  registerAuthOnboardingRoutes(app, ctx);
  registerBillingAdminRoutes(app, ctx);
  registerStaticRoutes(app, ctx);

  return app;
}
