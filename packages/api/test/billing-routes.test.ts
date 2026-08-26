import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { QueryResult } from "pg";
import { buildApp } from "../src/index.js";
import { MockStrategicAgent, MockExecutionAgent } from "@aee/agents";
import { InMemoryQueue } from "@aee/orchestrator/runtime";

type QueryHandler = (text: string) => QueryResult;
interface PoolClientLike { query: (t: string, v?: unknown[]) => Promise<QueryResult>; release: () => void }

function makeClient(handler: QueryHandler): PoolClientLike {
  return {
    query: async (t: string) => handler(t),
    release: () => {},
  } as unknown as PoolClientLike;
}
function makePool(handler: QueryHandler): Pool {
  return { connect: () => Promise.resolve(makeClient(handler)) } as unknown as Pool;
}
const SESSION_OWNER = { rows: [{ role: "owner", is_admin: false }], rowCount: 1 };
function deps() {
  return { strategic: new MockStrategicAgent(), execution: new MockExecutionAgent(), queue: new InMemoryQueue() };
}
const UID = "33333333-3333-4333-8333-333333333333";
const H = { "x-user-id": UID };

describe("GET /billing/plan — plan + subscription + usage (P1 fix: dulu 404)", () => {
  it("200 dengan plan tier org aktif; tenant-scoped via getOrgForUser", async () => {
    let planQuery = "";
    const app = buildApp({
      pool: makePool((text) => {
        // loadSession (X-User-Id fallback): SELECT role, is_admin FROM users WHERE id
        if (/FROM users WHERE id/i.test(text)) return SESSION_OWNER as unknown as QueryResult;
        // getOrgForUser → memberships/org
        if (/FROM memberships m JOIN organizations o/.test(text))
          return { rows: [{ id: "org-1", name: "Org", slug: "org", plan_tier: "STARTER", onboarding_step: 5, onboarding_completed: "2026-01-01", autonomy_level: 2 }], rowCount: 1 } as unknown as QueryResult;
        if (/FROM subscription_plans sp/.test(text)) {
          planQuery = text;
          return { rows: [{ tier: "STARTER", name: "Starter", price_monthly: "499000.00", max_ai_credits_monthly: 1000 }], rowCount: 1 } as unknown as QueryResult;
        }
        if (/FROM subscriptions s/.test(text))
          return { rows: [{ status: "ACTIVE", plan_id: "plan-1", current_period_end: "2026-09-01T00:00:00Z" }], rowCount: 1 } as unknown as QueryResult;
        if (/FROM usage_credits/.test(text))
          return { rows: [{ credits_used: 12, credits_limit: 1000 }], rowCount: 1 } as unknown as QueryResult;
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: "whsec-test",
    });
    const res = await app.inject({ method: "GET", url: "/billing/plan", headers: H });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.tier).toBe("STARTER");
    expect(body.subscription.status).toBe("ACTIVE");
    expect(body.usage.credits_used).toBe(12);
    // plan tier dari org (bukan input user)
    expect(planQuery).toMatch(/sp\.tier = \$1/);
  });

  it("tanpa organisasi → 404", async () => {
    const app = buildApp({
      pool: makePool((text) =>
        /FROM users WHERE id/i.test(text)
          ? (SESSION_OWNER as unknown as QueryResult)
          : ({ rows: [], rowCount: 0 } as unknown as QueryResult)),
      deps: deps(), webhookSecret: "whsec-test",
    });
    const res = await app.inject({ method: "GET", url: "/billing/plan", headers: H });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /billing/checkout — guard konfigurasi & validasi", () => {
  it("503 BILLING_UNCONFIGURED bila env Duitku kosong", async () => {
    delete process.env.DUITKU_MERCHANT_CODE;
    delete process.env.DUITKU_API_KEY;
    const app = buildApp({
      pool: makePool((text) =>
        /FROM users WHERE id/i.test(text)
          ? (SESSION_OWNER as unknown as QueryResult)
          : ({ rows: [], rowCount: 0 } as unknown as QueryResult)),
      deps: deps(), webhookSecret: "whsec-test",
    });
    const res = await app.inject({ method: "POST", url: "/billing/checkout", headers: H,
      payload: { plan_tier: "STARTER" } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("BILLING_UNCONFIGURED");
  });

  it("422 VALIDATION_ERROR untuk plan di luar katalog", async () => {
    process.env.DUITKU_MERCHANT_CODE = "D1234";
    process.env.DUITKU_API_KEY = "k";
    try {
      const app = buildApp({
        pool: makePool((text) => /FROM users WHERE id/i.test(text)
          ? (SESSION_OWNER as unknown as QueryResult)
          : ({ rows: [], rowCount: 0 } as unknown as QueryResult)),
        deps: deps(), webhookSecret: "whsec-test",
      });
      const res = await app.inject({ method: "POST", url: "/billing/checkout", headers: H,
        payload: { plan_tier: "PLATINUM" } });
      expect(res.statusCode).toBe(422);
    } finally {
      delete process.env.DUITKU_MERCHANT_CODE;
      delete process.env.DUITKU_API_KEY;
    }
  });
});

describe("POST /billing/duitku/callback — signature gate", () => {
  it("403 untuk signature salah; callback tanpa env tetap 503", async () => {
    delete process.env.DUITKU_MERCHANT_CODE;
    const app = buildApp({
      pool: makePool(() => ({ rows: [], rowCount: 0 }) as unknown as QueryResult),
      deps: deps(), webhookSecret: "whsec-test",
    });
    const badBody = JSON.stringify({ merchantCode: "X", amount: "1", merchantOrderId: "O", signature: "zz", resultCode: "00" });
    const bad = await app.inject({ method: "POST", url: "/billing/duitku/callback",
      headers: { "content-type": "application/json" }, payload: badBody });
    expect(bad.statusCode).toBe(503); // belum dikonfigurasi → guard dulu
    process.env.DUITKU_MERCHANT_CODE = "D1234";
    process.env.DUITKU_API_KEY = "k";
    try {
      const res = await app.inject({ method: "POST", url: "/billing/duitku/callback",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ merchantCode: "D1234", amount: "1000", merchantOrderId: "O", signature: "bogus", resultCode: "00" }) });
      expect(res.statusCode).toBe(403);
    } finally {
      delete process.env.DUITKU_MERCHANT_CODE;
      delete process.env.DUITKU_API_KEY;
    }
  });
});
