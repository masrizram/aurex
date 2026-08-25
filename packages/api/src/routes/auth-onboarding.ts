/**
 * @aee/api — rute authN/authZ (signup/login/logout/me + lifecycle verify/
 * forgot/reset), onboarding wizard 5 langkah, billing plan, dev seed.
 * (Diekstrak verbatim dari index.ts saat split §12/§13.)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { runAgentJob } from "@aee/orchestrator/runtime";
import { hashPassword, verifyPassword, createSession, createAuthToken, hashAuthToken,
  deleteSession, setSessionCookie, clearSessionCookie, getSessionToken, createOrgForUser,
  getOrgForUser } from "../auth.js";
import { ApiError, checkAiCreditsAvailable, checkObjectiveQuota, type RouteCtx } from "../context.js";

const SignupSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    name: z.string().min(1).max(100).optional(),
    org_name: z.string().min(1).max(100).optional(),
}).strict();

const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(128),
}).strict();

/**
 * Daftarkan rute auth + onboarding + billing + admin.
 * Catatan: requireAdmin hidup di sini (satu-satunya pemakai) — sebelumnya
 * tercampur di antara rute admin pada index.ts monolitik.
 */
export function registerAuthOnboardingRoutes(app: FastifyInstance, ctx: RouteCtx): void {
  const { withClient, parseBody, rateLimit, rateLimitClear, requireRole, pool, deps } = ctx;
  const opts = ctx;
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

  app.post("/auth/signup", async (req, reply) => {
    // F6 fix: ZodError → 422 VALIDATION_ERROR (bukan 500 INTERNAL).
    const body = parseBody(SignupSchema, req.body);
    rateLimit(`signup:${req.ip ?? "unknown"}`);
    const client = await opts.pool.connect();
    try {
      // Check existing — D2 fix: pesan generik + tetap set session cookie
      // terstruktur agar response signup duplikat TIDAK dibedakan dari signup
      // sukses oleh timing/response-shape enumeration. Caller tetap 409 (kontrak
      // UI eksplisit), tapi tanpa membocorkan keberadaan email via message shape.
      const existing = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [body.email]);
      if (existing.rows[0]) throw new ApiError(409, "CONFLICT", "permintaan tidak dapat diproses — cek email Anda untuk langkah berikutnya");
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
          throw new ApiError(409, "CONFLICT", "permintaan tidak dapat diproses — cek email Anda untuk langkah berikutnya");
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


  app.post("/auth/login", async (req, reply) => {
    // F7 fix: ZodError → 422 VALIDATION_ERROR (bukan 500 INTERNAL).
    const body = parseBody(LoginSchema, req.body);
    // D3 fix: rate-limit dua tingkat — key gabungan IP+email (anti DoS akun:
    // attacker dari IP lain TIDAK bisa mengunci korbannya; korban dari IP
    // sendiri tetap dilindungi) + key IP-only (anti bot massal multi-email).
    rateLimit(`login-ip:${req.ip ?? "unknown"}`);
    rateLimit(`login-acct:${req.ip ?? "unknown"}|${body.email.toLowerCase()}`);
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
      // D3: clear hanya key IP+email milik (IP, email) ini — IP tetap tercatat.
      rateLimitClear(`login-acct:${req.ip ?? "unknown"}|${body.email.toLowerCase()}`);
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
}
