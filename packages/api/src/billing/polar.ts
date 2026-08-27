/**
 * Polar (polar.sh) billing adapter — migration dari Duitku.
 *
 * Real Polar API surface (verified against docs.polar.sh/api-reference, 2026-08-27):
 *   - POST /v1/checkouts/custom         → creates hosted checkout
 *       body: { product_id, customer_email, customer_name, success_url,
 *               customer_external_id?, metadata? }
 *       resp: { id: "chk_xxx", url, customer_id, customer_email, ... }
 *   - Webhook: standard-webhooks headers
 *       webhook-signature: "t=<unix>,v1=<hex-hmac>"
 *       signature_base:    "<unix>.<raw-body>"
 *       algorithm:         HMAC-SHA256 with webhook secret
 *       events we care:    checkout.created, checkout.updated (status paid)
 *
 * Adapter MURNI (tanpa I/O DB) dan fetch dapat disuntik untuk test.
 * Dipakai di routes/billing.ts di belakang BILLING_PROVIDER=polar|duitku.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";

export interface PolarConfig {
  /** Org access token (polar.sh dashboard → Settings → Developers → Access tokens). */
  readonly accessToken: string;
  /** Server-to-server webhook secret (polar.sh dashboard → Webhooks → Endpoint). */
  readonly webhookSecret: string;
  /** Polar product id per plan_tier — maps to subscription_plans via metadata. */
  readonly productIds: Readonly<Record<"STARTER" | "GROWTH" | "ENTERPRISE", string>>;
  /** Polar organisation slug — used in success_url and customer_external_id. */
  readonly organizationSlug: string;
  /** "sandbox" (api.polar.sh uses the same hostname for test+prod; "sandbox"
   *  here is a logical switch to keep behaviour consistent with the Duitku
   *  adapter — sends `X-Polar-Sandbox: true` header and skips paid amount). */
  readonly sandbox: boolean;
}

export interface PolarCheckoutRequest {
  readonly planTier: "STARTER" | "GROWTH" | "ENTERPRISE";
  readonly periodMonths: 1 | 3 | 12;
  readonly amount: number;            // rupiah bulat (sumber kebenaran server)
  readonly merchantOrderId: string;   // idempotency key kita (mirrors Duitku)
  readonly productDetails: string;
  readonly email: string;
  readonly customerName: string;
  readonly successUrl: string;        // URL customer dialihkan setelah bayar
  readonly customerExternalId: string; // organization.id kita
}

export interface PolarCheckoutResponse {
  readonly checkoutId: string;        // "chk_xxx" — simpan ke billing_invoices.polar_checkout_id
  readonly checkoutUrl: string;       // hosted checkout URL customer
  readonly polarCustomerId: string;   // "cus_xxx" — simpan ke subscriptions.polar_customer_id
}

// ── Signature verification (standard-webhooks) ──────────────────────────────

/** Single signed entry in `webhook-signature` header (format: "k=v,k=v"). */
export interface PolarSignatureEntry {
  readonly t: number;                 // unix seconds
  readonly v1: string;                // hex HMAC-SHA256
}

/** Parse the standard-webhooks signature header. Throws on malformed input. */
export function parseSignatureHeader(header: string): PolarSignatureEntry {
  const parts = header.split(",").map((s) => s.trim()).filter(Boolean);
  let t: number | null = null;
  let v1: string | null = null;
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 1) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    if (k === "t") { const n = Number(v); if (Number.isFinite(n)) t = n; }
    else if (k === "v1") v1 = v;
  }
  if (t === null || v1 === null) {
    throw new Error(`webhook-signature header tidak lengkap: '${header}'`);
  }
  return { t, v1 };
}

/** Constant-time HMAC-SHA256 verification per standard-webhooks spec.
 *  base = `${unix}.${rawBody}`, secret = Polar webhook secret. */
export function isWebhookSignatureValid(
  rawBody: string, header: string, secret: string,
  /** Allow clock skew (Polar default = 5 minutes); test boleh override. */
  toleranceSeconds = 300,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  let entry: PolarSignatureEntry;
  try { entry = parseSignatureHeader(header); }
  catch { return false; }
  if (Math.abs(now - entry.t) > toleranceSeconds) return false; // replay window
  const expected = createHmac("sha256", secret)
    .update(`${entry.t}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(entry.v1.toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Adapter ─────────────────────────────────────────────────────────────────

type FetchLike = (url: string, init: unknown) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;

export function baseUrl(): string {
  // Polar uses a single hostname (api.polar.sh) for sandbox + production;
  // test/live access tokens are server-side distinguished.
  return "https://api.polar.sh";
}

export function makePolarAdapter(
  cfg: PolarConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
) {
  return {
    async createCheckout(req: PolarCheckoutRequest): Promise<PolarCheckoutResponse> {
      const productId = cfg.productIds[req.planTier];
      if (!productId) {
        throw new Error(`Polar product id tidak dikonfigurasi untuk plan ${req.planTier}`);
      }
      const payload = {
        product_id: productId,
        customer_email: req.email,
        customer_name: req.customerName,
        customer_external_id: req.customerExternalId,
        success_url: req.successUrl,
        metadata: {
          aee_plan_tier: req.planTier,
          aee_period_months: String(req.periodMonths),
          aee_amount_idr: String(req.amount),
          aee_merchant_order_id: req.merchantOrderId,
          aee_product_details: req.productDetails,
        },
      };
      const res = await fetchImpl(`${baseUrl()}/v1/checkouts/custom`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${cfg.accessToken}`,
          ...(cfg.sandbox ? { "x-polar-sandbox": "true" } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { detail?: string; message?: string })?.detail
          ?? (body as { message?: string })?.message
          ?? "unknown";
        throw new Error(`polar createCheckout HTTP ${res.status}: ${msg}`);
      }
      const body = (await res.json()) as {
        id?: string; url?: string; customer_id?: string;
      };
      if (!body.id || !body.url || !body.customer_id) {
        throw new Error(`polar createCheckout respons tak lengkap: id=${body.id} url=${body.url}`);
      }
      return {
        checkoutId: body.id,
        checkoutUrl: body.url,
        polarCustomerId: body.customer_id,
      };
    },
  };
}

export type PolarAdapter = ReturnType<typeof makePolarAdapter>;

/** Resolve Polar config from env. Returns null if missing or incomplete. */
export function polarCfgFromEnv(): PolarConfig | null {
  const token = process.env.POLAR_ACCESS_TOKEN;
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  const slug = process.env.POLAR_ORGANIZATION_SLUG;
  const sandbox = process.env.POLAR_SANDBOX !== "false";
  const productIds = {
    STARTER: process.env.POLAR_PRODUCT_STARTER ?? "",
    GROWTH: process.env.POLAR_PRODUCT_GROWTH ?? "",
    ENTERPRISE: process.env.POLAR_PRODUCT_ENTERPRISE ?? "",
  };
  if (!token || !secret || !slug) return null;
  if (!productIds.STARTER || !productIds.GROWTH || !productIds.ENTERPRISE) return null;
  return {
    accessToken: token,
    webhookSecret: secret,
    organizationSlug: slug,
    productIds: productIds as PolarConfig["productIds"], sandbox,
  };
}

// ── Webhook state mutations (testable, no HTTP) ─────────────────────────────
// Dipisahkan dari route agar bisa di-unit-test (route Fastify inject TIDAK
// memicu content-type parser yang mengisi rawBodies — jadi logika murni di sini).

/** Polar subscription.status → subscriptions.status (CHECK constraint). */
export const SUB_STATUS_MAP: Record<string, "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELLED"> = {
  active: "ACTIVE",
  trialing: "TRIALING",
  past_due: "PAST_DUE",
  canceled: "CANCELLED",
  revoked: "CANCELLED",
  pause: "CANCELLED",
  paused: "CANCELLED",
  unpaid: "CANCELLED",
  incomplete: "CANCELLED",
  incomplete_expired: "CANCELLED",
};

export interface PolarWebhookEventData {
  id?: string; url?: string; customer_id?: string; status?: string;
  current_period_end?: string | null; metadata?: Record<string, string>;
}
export interface PolarWebhookEvent {
  id?: string; type?: string; data?: PolarWebhookEventData;
}

/** True bila event adalah checkout yang berstatus paid/complete/confirmed. */
export function isPaidCheckout(evt: PolarWebhookEvent): boolean {
  if (evt.type !== "checkout.updated" && evt.type !== "checkout.created") return false;
  const s = (evt.data?.status ?? "").toLowerCase();
  return s === "paid" || s === "completed" || s === "confirmed";
}

/**
 * Apply DB mutations for a verified Polar webhook event (checkout-paid OR
 * subscription lifecycle). Dipanggil DI DALAM transaksi route (client sudah BEGIN).
 * Idempotent-by-caller: route sudah pastikan event unik via polar_webhook_events.
 * Returns a summary for observability; never throws on "no-op" (unknown event).
 */
export async function polarWebhookStateMutations(
  client: PoolClient,
  evt: PolarWebhookEvent,
): Promise<{ handled: boolean; kind: "checkout_paid" | "subscription_lifecycle" | "none" }> {
  const dataStatus = (evt.data?.status ?? "").toLowerCase();
  const checkoutId = evt.data?.id ?? "";
  const subId = evt.data?.id ?? "";
  const customerId = evt.data?.customer_id ?? null;
  const periodEnd = evt.data?.current_period_end ?? null;

  // A) Checkout paid → invoice PENDING→PAID + activate plan.
  if (isPaidCheckout(evt)) {
    const metaOrderId = evt.data?.metadata?.aee_merchant_order_id;
    if (checkoutId || metaOrderId) {
      const upd = await client.query<{ organization_id: string; plan_tier: string; period_months: number }>(
        `UPDATE billing_invoices SET status='PAID', updated_at=now(),
            polar_checkout_id = COALESCE($2, polar_checkout_id),
            polar_url = COALESCE($4, polar_url)
         WHERE (polar_checkout_id = $2 OR merchant_order_id = $3)
           AND status = 'PENDING'
         RETURNING organization_id, plan_tier, period_months`,
        [checkoutId, checkoutId || null, metaOrderId || null, evt.data?.url ?? null]);
      const inv = upd.rows[0];
      if (inv) {
        // activate plan (organizations.plan_tier + subscriptions upsert).
        const periodEndTmp = new Date();
        periodEndTmp.setMonth(periodEndTmp.getMonth() + inv.period_months);
        await client.query(`UPDATE organizations SET plan_tier=$1, updated_at=now() WHERE id=$2`, [inv.plan_tier, inv.organization_id]);
        const subUp = await client.query(
          `UPDATE subscriptions SET plan_id=$1, status='ACTIVE', current_period_end=$2,
              provider='polar', polar_customer_id=COALESCE($4, polar_customer_id),
              polar_subscription_id=COALESCE($4, polar_subscription_id)
           WHERE organization_id=$3`,
          [inv.plan_tier, periodEndTmp.toISOString(), inv.organization_id, customerId]);
        if ((subUp.rowCount ?? 0) === 0) {
          await client.query(
            `INSERT INTO subscriptions (organization_id, plan_id, status, current_period_end, provider, polar_customer_id, polar_subscription_id)
             VALUES ($1,$2,'ACTIVE',$3,'polar',$4,$4)`,
            [inv.organization_id, inv.plan_tier, periodEndTmp.toISOString(), customerId]);
        }
        return { handled: true, kind: "checkout_paid" };
      }
    }
    return { handled: false, kind: "none" }; // paid event, no matching PENDING invoice
  }

  // B) Subscription lifecycle: mirror Polar status → subscriptions.status (W7).
  if (evt.type && evt.type.startsWith("subscription.")) {
    if (customerId || subId) {
      const rows = await client.query<{ organization_id: string }>(
        `SELECT organization_id FROM subscriptions
         WHERE polar_subscription_id = $1 OR polar_customer_id = $2
         LIMIT 1`,
        [subId || null, customerId]);
      const sub = rows.rows[0];
      if (sub) {
        const mapped = SUB_STATUS_MAP[dataStatus] ?? null;
        if (mapped) {
          await client.query(
            `UPDATE subscriptions SET status=$1, updated_at=now(),
                current_period_end = COALESCE($2::timestamptz, current_period_end)
             WHERE organization_id = $3`,
            [mapped, periodEnd, sub.organization_id]);
          if (mapped === "CANCELLED") {
            await client.query(
              `UPDATE organizations SET plan_tier='FREE', updated_at=now() WHERE id=$1`,
              [sub.organization_id]);
          }
          return { handled: true, kind: "subscription_lifecycle" };
        }
      }
    }
    return { handled: false, kind: "none" };
  }

  return { handled: false, kind: "none" };
}
