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
