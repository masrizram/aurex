/**
 * @aee/api — rute approvals (T34/T35), webhook payments HMAC (D5), dan
 * callback hasil eksekusi GLM (service role §8).
 * (Diekstrak verbatim dari index.ts saat split §12/§13.)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { advance } from "@aee/orchestrator/runtime";
import { processPaymentWebhook } from "@aee/orchestrator/result-processor";
import { GlmResultSchema } from "@aee/contracts";
import { ApiError, type RouteCtx } from "../context.js";

const ApprovalNoteSchema = z.object({ note: z.string().max(500).optional() }).strict();
const ApprovalRejectSchema = z.object({ reason: z.string().min(3).max(500) }).strict();
const WebhookPayloadSchema = z.object({
  external_id: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  kind: z.enum(["REVENUE", "COST"]),
  provider: z.string().min(2).max(50),
  occurred_at: z.string().datetime().optional(),
}).strict();

/** Daftarkan rute approvals + webhook payments + executions callback. */
export function registerApprovalRoutes(app: FastifyInstance, ctx: RouteCtx): void {
  const { withClient, requireRole, parseBody, requireOwnedApproval, rawBodies, pool, webhookSecret } = ctx;
  const opts = ctx;
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

    // D5 fix: signature diverifikasi SEBELUM zod-validasi payload (auth first).
    // Endpoint world-facing tanpa sesi: request yang gagal signature tidak
    // boleh mendapat feedback struktur payload. Verifikasi HMAC hanya butuh
    // bytes mentah + secret — tidak butuh payload valid.
    const sigHeader = req.headers["x-signature"];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!sig) throw new ApiError(401, "UNAUTHORIZED", "header X-Signature wajib");
    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const expected = createHmac("sha256", opts.webhookSecret).update(raw).digest("hex");
    const sigBuf = Buffer.from(String(sig));
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new ApiError(401, "UNAUTHORIZED", "SIGNATURE_INVALID: HMAC tidak cocok");
    }
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
}
