import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/index.js";
import {
  isWebhookSignatureValid, makePolarAdapter, parseSignatureHeader, polarCfgFromEnv,
  type PolarConfig, type PolarCheckoutRequest,
} from "../src/billing/polar.js";

// ── Unit adapter Polar (murni, fetch disuntik) ──────────────────────────────
const CFG: PolarConfig = {
  accessToken: "pol_xxxxxxxx",
  webhookSecret: "whsec_yyyyyyyy",
  organizationSlug: "aurex",
  productIds: { STARTER: "prod_starter", GROWTH: "prod_growth", ENTERPRISE: "prod_enterprise" },
  sandbox: true,
};

function sigHeader(body: string, secret: string, t: number): string {
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const v = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v}`;
}

describe("polar adapter — signature & createCheckout", () => {
  it("webhook signature HMAC-SHA256 valid (standard-webhooks)", () => {
    const body = JSON.stringify({ id: "evt_1", type: "checkout.updated", data: {} });
    const t = Math.floor(Date.now() / 1000);
    const header = sigHeader(body, CFG.webhookSecret, t);
    expect(isWebhookSignatureValid(body, header, CFG.webhookSecret)).toBe(true);
    const bogus = header.replace(/v1=[a-f0-9]+/i, "v1=deadbeef");
    expect(isWebhookSignatureValid(body, bogus, CFG.webhookSecret)).toBe(false);
  });

  it("rejects stale replay (outside tolerance window)", () => {
    const body = JSON.stringify({ id: "evt_2", type: "checkout.created", data: {} });
    const old = Math.floor(Date.now() / 1000) - 4000; // 66 min old
    const header = sigHeader(body, CFG.webhookSecret, old);
    expect(isWebhookSignatureValid(body, header, CFG.webhookSecret)).toBe(false);
  });

  it("parseSignatureHeader handles malformed input", () => {
    expect(() => parseSignatureHeader("garbage")).toThrow();
    expect(() => parseSignatureHeader("t=1")).toThrow(); // missing v1
  });

  it("createCheckout sends correct payload to /v1/checkouts/custom", async () => {
    let captured: { url: string; init: Record<string, unknown> } | null = null;
    const adapter = makePolarAdapter(CFG, async (url, init) => {
      captured = { url: url as string, init: init as Record<string, unknown> };
      return {
        ok: true, status: 201,
        json: async () => ({ id: "chk_9", url: "https://checkout.polar.sh/chk_9", customer_id: "cus_9" }),
      };
    });
    const req: PolarCheckoutRequest = {
      planTier: "STARTER", periodMonths: 1, amount: 474050, merchantOrderId: "ORD-1",
      productDetails: "AUREX STARTER 1 bulan", email: "u@x.id", customerName: "U",
      successUrl: "http://ret", customerExternalId: "org-1",
    };
    const out = await adapter.createCheckout(req);
    expect(out.checkoutId).toBe("chk_9");
    expect(out.checkoutUrl).toBe("https://checkout.polar.sh/chk_9");
    expect(out.polarCustomerId).toBe("cus_9");
    const headers = (captured!.init.headers ?? {}) as Record<string, string>;
    expect(captured!.url).toBe("https://api.polar.sh/v1/checkouts/custom");
    expect(headers["authorization"]).toBe("Bearer pol_xxxxxxxx");
    expect(headers["x-polar-sandbox"]).toBe("true");
    const body = JSON.parse(captured!.init.body as string);
    expect(body.product_id).toBe("prod_starter");
    expect(body.customer_email).toBe("u@x.id");
    expect(body.metadata.aee_plan_tier).toBe("STARTER");
    expect(body.metadata.aee_merchant_order_id).toBe("ORD-1");
    expect(body.metadata.aee_amount_idr).toBe("474050");
  });

  it("HTTP gagal → error eksplisit", async () => {
    const adapter = makePolarAdapter(CFG, async () => ({
      ok: false, status: 422, json: async () => ({ detail: "product not found" }),
    }));
    await expect(adapter.createCheckout({
      planTier: "GROWTH", periodMonths: 1, amount: 1, merchantOrderId: "X",
      productDetails: "p", email: "e@x", customerName: "c", successUrl: "s", customerExternalId: "o",
    })).rejects.toThrow(/HTTP 422: product not found/);
  });

  it("polarCfgFromEnv returns null bila config tak lengkap", () => {
    // Read the function's behaviour with all POLAR_* vars cleared without mutating
    // process.env (vitest watches reassignment). We temporarily shadow via vi.stubEnv.
    vi.stubEnv("POLAR_ACCESS_TOKEN", "");
    vi.stubEnv("POLAR_WEBHOOK_SECRET", "");
    vi.stubEnv("POLAR_ORGANIZATION_SLUG", "");
    vi.stubEnv("POLAR_PRODUCT_STARTER", "");
    vi.stubEnv("POLAR_PRODUCT_GROWTH", "");
    vi.stubEnv("POLAR_PRODUCT_ENTERPRISE", "");
    expect(polarCfgFromEnv()).toBeNull();
    vi.unstubAllEnvs();
  });
});
