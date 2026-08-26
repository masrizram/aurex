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
