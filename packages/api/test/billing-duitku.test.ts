import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/index.js";
import { isCallbackSignatureValid, makeDuitkuAdapter, type DuitkuCallbackPayload } from "../src/billing/duitku.js";

// ── Unit adapter Duitku (murni, fetch disuntik) ──────────────────────────────
const CFG = { merchantCode: "D1234", apiKey: "secret-key", sandbox: true };

describe("duitku adapter — signature & createInvoice", () => {
  it("callback signature MD5 sesuai spesifikasi POP", () => {
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    const valid: DuitkuCallbackPayload = {
      merchantCode: "D1234", amount: "499000", merchantOrderId: "AEE-TEST-1",
      signature: createHash("md5").update("D1234499000AEE-TEST-1secret-key").digest("hex"),
      resultCode: "00", reference: "REF-1",
    };
    expect(isCallbackSignatureValid(valid, CFG)).toBe(true);
    const bogus: DuitkuCallbackPayload = { ...valid, signature: "deadbeef" };
    expect(isCallbackSignatureValid(bogus, CFG)).toBe(false);
  });

  it("createInvoice mengirim header SHA256 + payload POP yang benar", async () => {
    let captured: { url: string; init: Record<string, unknown> } | null = null;
    const adapter = makeDuitkuAdapter(CFG, async (url, init) => {
      captured = { url: url as string, init: init as Record<string, unknown> };
      return { ok: true, status: 200, json: async () => ({ reference: "REF9", paymentUrl: "https://pay/x" }) };
    });
    const out = await adapter.createInvoice({
      amount: 499000, merchantOrderId: "ORD-1", productDetails: "AUREX STARTER 1 bulan",
      email: "u@x.id", customerName: "U", callbackUrl: "http://cb", returnUrl: "http://ret",
      expiryMinutes: 60,
    });
    expect(out.reference).toBe("REF9");
    const headers = (captured!.init.headers ?? {}) as Record<string, string>;
    expect(captured!.url).toContain("api-sandbox.duitku.com/api/merchant/createInvoice");
    expect(headers["x-duitku-merchantcode"]).toBe("D1234");
    expect(headers["x-duitku-timestamp"]).toBeTruthy();
    expect(headers["x-duitku-signature"]).toHaveLength(64); // sha256 hex
    const body = JSON.parse(captured!.init.body as string);
    expect(body.paymentAmount).toBe(499000);
    expect(body.expiryPeriod).toBe(60);
    expect(body.merchantOrderId).toBe("ORD-1");
  });

  it("HTTP gagal → error eksplisit", async () => {
    const adapter = makeDuitkuAdapter(CFG, async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(adapter.createInvoice({
      amount: 1, merchantOrderId: "X", productDetails: "p", email: "e@x",
      customerName: "c", callbackUrl: "cb", returnUrl: "ret", expiryMinutes: 60,
    })).rejects.toThrow(/HTTP 500/);
  });
});
