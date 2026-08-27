import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { QueryResult } from "pg";
import {
  isPaidCheckout, polarWebhookStateMutations, SUB_STATUS_MAP, type PolarWebhookEvent,
} from "../src/billing/polar.js";

// Mock PoolClient: records every query, route based on SQL shape.
function makeClient(handler: (text: string, vals?: unknown[]) => QueryResult): PoolClient {
  return {
    query: async (text: string, vals?: unknown[]) => handler(text, vals),
  } as unknown as PoolClient;
}
const trivial = { rows: [], rowCount: 1 } as unknown as QueryResult;
const empty = { rows: [], rowCount: 0 } as unknown as QueryResult;

function paidInvoiceHandler(queries: Array<{ sql: string; vals?: unknown[] }>): (t: string, v?: unknown[]) => QueryResult {
  return (text, vals) => {
    queries.push({ sql: text, vals });
    if (/UPDATE billing_invoices SET status='PAID'/i.test(text)) {
      return { rows: [{ organization_id: "org-1", plan_tier: "STARTER", period_months: 1 }], rowCount: 1 } as unknown as QueryResult;
    }
    if (/UPDATE organizations SET plan_tier=/i.test(text)) return trivial;
    if (/UPDATE subscriptions SET/i.test(text)) return { rows: [], rowCount: 1 } as unknown as QueryResult;
    if (/INSERT INTO subscriptions/i.test(text)) return { rows: [], rowCount: 0 } as unknown as QueryResult;
    return empty;
  };
}
function subLifecycleHandler(subRows: QueryResult, queries: Array<{ sql: string; vals?: unknown[] }>) {
  return (text: string, vals?: unknown[]) => {
    queries.push({ sql: text, vals });
    if (/FROM subscriptions\s+WHERE\s+polar_subscription_id/i.test(text)) return subRows;
    if (/UPDATE subscriptions SET status=/i.test(text)) return trivial;
    if (/UPDATE organizations SET plan_tier='FREE'/i.test(text)) return trivial;
    return empty;
  };
}
const PAID_INVOICE: PolarWebhookEvent = {
  id: "evt_1", type: "checkout.updated",
  data: { id: "chk_1", customer_id: "cus_1", status: "paid", url: "https://pay/x", metadata: { aee_merchant_order_id: "AEE-1", aee_plan_tier: "STARTER", aee_period_months: "1" } },
};
const SUB_UPD_ACTIVE: PolarWebhookEvent = {
  id: "evt_2", type: "subscription.updated",
  data: { id: "sub_1", customer_id: "cus_1", status: "active", current_period_end: "2026-12-01T00:00:00Z" },
};

describe("polar webhook state mutations (unit) — checkout paid", () => {
  it("W1: paid checkout flips invoice PENDING→PAID + activates plan", async () => {
    const q: Array<{ sql: string; vals?: unknown[] }> = [];
    const client = makeClient(paidInvoiceHandler(q));
    const r = await polarWebhookStateMutations(client, PAID_INVOICE);
    expect(r.handled).toBe(true);
    expect(r.kind).toBe("checkout_paid");
    expect(q.some((x) => /UPDATE billing_invoices SET status='PAID'/i.test(x.sql))).toBe(true);
    const orgUpd = q.find((x) => /UPDATE organizations SET plan_tier=/i.test(x.sql))!;
    expect(orgUpd.vals![0]).toBe("STARTER");
  });

  it("isPaidCheckout true hanya untuk paid/complete/confirmed; false untuk pending", () => {
    expect(isPaidCheckout(PAID_INVOICE)).toBe(true);
    expect(isPaidCheckout({ id: "x", type: "checkout.created", data: { status: "paid" } })).toBe(true);
    expect(isPaidCheckout({ id: "x", type: "checkout.updated", data: { status: "pending" } })).toBe(false);
    expect(isPaidCheckout({ id: "x", type: "subscription.updated", data: { status: "paid" } })).toBe(false);
  });
});

describe("polar webhook state mutations (unit) — subscription lifecycle (W7)", () => {
  const SUB_ROW = { rows: [{ organization_id: "org-7" }], rowCount: 1 } as unknown as QueryResult;
  it("subscription.updated active → subscriptions.status = ACTIVE", async () => {
    const q: Array<{ sql: string; vals?: unknown[] }> = [];
    const client = makeClient(subLifecycleHandler(SUB_ROW, q));
    const r = await polarWebhookStateMutations(client, SUB_UPD_ACTIVE);
    expect(r.handled).toBe(true);
    expect(r.kind).toBe("subscription_lifecycle");
    const sub = q.find((x) => /UPDATE subscriptions SET status=/i.test(x.sql))!;
    expect(sub.vals![0]).toBe("ACTIVE");
  });

  it("subscription.canceled → CANCELLED + organization downgraded to FREE", async () => {
    const q: Array<{ sql: string; vals?: unknown[] }> = [];
    const client = makeClient(subLifecycleHandler(SUB_ROW, q));
    const evt: PolarWebhookEvent = { id: "evt_cxl", type: "subscription.canceled", data: { id: "sub_1", customer_id: "cus_1", status: "canceled" } };
    const r = await polarWebhookStateMutations(client, evt);
    expect(r.kind).toBe("subscription_lifecycle");
    const sub = q.find((x) => /UPDATE subscriptions SET status=/i.test(x.sql))!;
    expect(sub.vals![0]).toBe("CANCELLED");
    expect(q.some((x) => /UPDATE organizations SET plan_tier='FREE'/i.test(x.sql))).toBe(true);
  });

  it("subscription.revoked mapped to CANCELLED (SUB_STATUS_MAP)", () => {
    expect(SUB_STATUS_MAP["revoked"]).toBe("CANCELLED");
    expect(SUB_STATUS_MAP["canceled"]).toBe("CANCELLED");
    expect(SUB_STATUS_MAP["active"]).toBe("ACTIVE");
    expect(SUB_STATUS_MAP["trialing"]).toBe("TRIALING");
    expect(SUB_STATUS_MAP["past_due"]).toBe("PAST_DUE");
    expect(SUB_STATUS_MAP["unpaid"]).toBe("CANCELLED");
    expect(SUB_STATUS_MAP["incomplete_expired"]).toBe("CANCELLED");
  });

  it("unknown subscription (no matching row) → handled:false, no throw", async () => {
    const q: Array<{ sql: string; vals?: unknown[] }> = [];
    const client = makeClient(subLifecycleHandler(empty, q));
    const r = await polarWebhookStateMutations(client, SUB_UPD_ACTIVE);
    expect(r.handled).toBe(false);
    expect(r.kind).toBe("none");
  });

  it("unmapped subscription status → handled:false, no throw", async () => {
    const q: Array<{ sql: string; vals?: unknown[] }> = [];
    const client = makeClient(subLifecycleHandler(SUB_ROW, q));
    const evt: PolarWebhookEvent = { id: "x", type: "subscription.updated", data: { id: "sub_1", status: "weird" } };
    const r = await polarWebhookStateMutations(client, evt);
    expect(r.handled).toBe(false);
    expect(r.kind).toBe("none");
  });

  it("non-checkout, non-subscription event (e.g. payment.disconnected) → 200-equivalent no-op", async () => {
    const client = makeClient(() => empty);
    const r = await polarWebhookStateMutations(client, { id: "x", type: "payment.disconnected", data: {} });
    expect(r.handled).toBe(false);
    expect(r.kind).toBe("none");
  });
});
