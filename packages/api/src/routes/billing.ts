/**
 * @aee/api — rute checkout & callback Duitku (fase monetize).
 *
 * POST /billing/checkout : buat invoice langganan (STARTER/GROWTH/ENTERPRISE),
 *   simpan PENDING, panggil Duitku createInvoice, kembalikan paymentUrl.
 * POST /billing/duitku/callback : callback POP — validasi MD5
 *   (merchantCode+amount+merchantOrderId+apiKey), transisi satu arah
 *   PENDING→PAID/FAILED/EXPIRED (idempoten), PAID mengaktifkan plan org.
 */
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { getOrgForUser } from "../auth.js";
import { ApiError, type RouteCtx } from "../context.js";
import {
  makeDuitkuAdapter, isCallbackSignatureValid, type DuitkuConfig,
  type DuitkuCallbackPayload,
} from "../billing/duitku.js";

/** Katalog harga server-side (Rp/bulan). Sumber kebenaran = sini, bukan UI. */
export const PLAN_PRICES: Record<string, number> = {
  STARTER: 499_000,
  GROWTH: 2_500_000,
  ENTERPRISE: 100_000_000,
};

const CheckoutSchema = z.object({
  plan_tier: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]),
  period_months: z.union([z.literal(1), z.literal(3), z.literal(12)]).default(1),
});

function duitkuCfgFromEnv(): DuitkuConfig | null {
  const code = process.env.DUITKU_MERCHANT_CODE;
  const key = process.env.DUITKU_API_KEY;
  if (!code || !key) return null; // billing belum dikonfigurasi
  return { merchantCode: code, apiKey: key, sandbox: process.env.DUITKU_SANDBOX !== "false" };
}

function requireBillingConfig(): DuitkuConfig {
  const cfg = duitkuCfgFromEnv();
  if (!cfg) throw new ApiError(503, "BILLING_UNCONFIGURED",
    "payment gateway belum dikonfigurasi — hubungi admin");
  return cfg;
}

/** Aktifkan langganan dalam transaksi yang sama dgn transisi invoice. */
async function activateSubscription(client: PoolClient, orgId: string, planTier: string, months: number): Promise<void> {
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + months);
  await client.query(`UPDATE organizations SET plan_tier=$1 WHERE id=$2`, [planTier, orgId]);
  // subscriptions.organization_id TIDAK unique di DDL → update-dulu-lalu-insert.
  const upd = await client.query(
    `UPDATE subscriptions SET plan_id=$1, status='ACTIVE', current_period_end=$2
     WHERE organization_id=$3`, [planTier, periodEnd.toISOString(), orgId]);
  if ((upd.rowCount ?? 0) === 0) {
    await client.query(
      `INSERT INTO subscriptions (organization_id, plan_id, status, current_period_end)
       VALUES ($1,$2,'ACTIVE',$3)`, [orgId, planTier, periodEnd.toISOString()]);
  }
}

export function registerBillingRoutes(app: FastifyInstance, ctx: RouteCtx): void {
  const { withClient, parseBody, pool } = ctx;

  // ── GET /billing/plan — plan + subscription + usage (SettingsPage) ──────────
  // P1 fix: frontend getBillingPlan() + E2E gate call this; previously 404.
  app.get("/billing/plan", async (req) =>
    withClient(async (client, session) => {
      const org = await getOrgForUser(client, session.userId);
      if (!org) throw new ApiError(404, "NOT_FOUND", "organization tidak ditemukan");
      const plan = (await client.query<{
        tier: string; name: string; price_monthly: string; max_ai_credits_monthly: number | null;
      }>(
        `SELECT sp.tier, sp.name, sp.price_monthly::text AS price_monthly,
                sp.max_ai_credits_monthly
         FROM subscription_plans sp
         WHERE sp.tier = $1 AND sp.is_active = true`, [org.planTier])).rows[0] ?? null;
      const sub = (await client.query<{ status: string; plan_id: string; current_period_end: string | null }>(
        `SELECT s.status, s.plan_id::text AS plan_id, s.current_period_end::text AS current_period_end
         FROM subscriptions s WHERE s.organization_id = $1 LIMIT 1`, [org.id])).rows[0] ?? null;
      const monthYear = new Date().toISOString().slice(0, 7);
      const usage = (await client.query<{ credits_used: number; credits_limit: number }>(
        `SELECT credits_used, credits_limit FROM usage_credits
         WHERE organization_id = $1 AND month_year = $2`, [org.id, monthYear])).rows[0]
        ?? { credits_used: 0, credits_limit: 0 };
      return { plan, subscription: sub, usage };
    }, req),
  );

  app.post("/billing/checkout", async (req) =>
    withClient(async (client, session) => {
      const cfg = requireBillingConfig();
      const body = parseBody(CheckoutSchema, req.body);
      if (!PLAN_PRICES[body.plan_tier]) throw new ApiError(422, "VALIDATION_ERROR", "plan tidak dikenal");
      const org = await getOrgForUser(client, session.userId);
      if (!org) throw new ApiError(404, "NOT_FOUND", "organization tidak ditemukan");

      const amount = PLAN_PRICES[body.plan_tier]! * body.period_months!;
      // diskon periode panjang: 3 bln −5%, 12 bln −15% (transparan di productDetails)
      const discount = body.period_months === 3 ? 0.95 : body.period_months === 12 ? 0.85 : 1;
      const finalAmount = Math.round(amount * discount);
      const orderId = `AEE-${org.id.slice(0, 8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const { rows: userRows } = await client.query<{ email: string; name: string }>(
        `SELECT email, COALESCE(name,'') AS name FROM users WHERE id = $1`, [session.userId]);

      const adapter = makeDuitkuAdapter(cfg);
      const appUrl = process.env.AEE_APP_URL ?? "http://localhost:5173";
      const inv = await adapter.createInvoice({
        amount: finalAmount,
        merchantOrderId: orderId,
        productDetails: `AUREX ${body.plan_tier} ${body.period_months} bulan`,
        email: userRows[0]?.email ?? "billing@aurex.id",
        customerName: userRows[0]?.name || "Pelanggan AUREX",
        callbackUrl: `${process.env.AEE_PUBLIC_URL ?? "https://aurex-api.fly.dev"}/billing/duitku/callback`,
        returnUrl: `${appUrl}/app/settings?billing=return`,
        expiryMinutes: 60,
      });

      await client.query(
        `INSERT INTO billing_invoices
           (organization_id, user_id, plan_tier, period_months, amount,
            merchant_order_id, status, duitku_reference, payment_url)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8)`,
        [org.id, session.userId, body.plan_tier, body.period_months,
          finalAmount.toFixed(2), orderId, inv.reference, inv.paymentUrl]);

      return { order_id: orderId, payment_url: inv.paymentUrl, reference: inv.reference };
    }, req),
  );

  app.post("/billing/duitku/callback", async (req, reply) => {
    const cfg = requireBillingConfig();
    // Kunci WeakMap = IncomingMessage (parser), bukan wrapper handler →
    // fallback serialisasi body ter-parse (pola sama dgn webhook payments).
    const raw = ctx.rawBodies.get(req) ?? JSON.stringify(req.body);
    if (typeof raw !== "string" || raw.length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "callback kosong");
    }
    let p: DuitkuCallbackPayload;
    try {
      p = JSON.parse(raw) as DuitkuCallbackPayload;
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "callback bukan JSON valid");
    }
    if (!isCallbackSignatureValid(p, cfg)) {
      throw new ApiError(403, "FORBIDDEN", "signature callback tidak valid");
    }
    const status = p.resultCode === "00" ? "PAID" : p.resultCode === "01" ? "FAILED" : "EXPIRED";

    const client = await pool.connect();
    try {
      // Transisi satu arah + aktivasi langganan dalam SATU transaksi DB.
      await client.query("BEGIN");
      const upd = await client.query<{
        id: string; organization_id: string; plan_tier: string; period_months: number;
      }>(
        `UPDATE billing_invoices SET status=$1, updated_at=now()
         WHERE merchant_order_id=$2 AND status='PENDING'
         RETURNING id, organization_id, plan_tier, period_months`,
        [status, p.merchantOrderId]);
      const inv = upd.rows[0];
      if (inv && status === "PAID") {
        await activateSubscription(client, inv.organization_id, inv.plan_tier, inv.period_months);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return reply.status(200).send({ received: true });
  });
}
