/**
 * Test rute Admin Control Center (@aee/api).
 * DB = stub PoolClient (query diprogram per-test, pola api.test.ts).
 * Fokus: authZ admin (403 non-admin), lifecycle user/org/objectives via FSM
 * resmi, audit trail setiap mutasi, provider enkripsi key + test connection.
 * (Integrasi penuh vs PG scratch di scripts/verify-orchestrator.ts; di sini
 *  kita verifikasi kontrak & guard, bukan FSM runtime nyata.)
 */
import { describe, expect, it } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import { buildApp } from "../src/index.js";
import { MockStrategicAgent, MockExecutionAgent } from "@aee/agents";
import { InMemoryQueue } from "@aee/orchestrator/runtime";

type QueryHandler = (text: string, values?: unknown[]) => QueryResult | { rows: unknown[]; rowCount: number };

function makeClient(handler: QueryHandler): PoolClient {
  return {
    query: (text: string, values?: unknown[]) => Promise.resolve(handler(text, values)),
    release: () => undefined,
  } as unknown as PoolClient;
}
function makePool(handler: QueryHandler): Pool {
  return { connect: () => Promise.resolve(makeClient(handler)) } as unknown as Pool;
}
function deps() {
  return { strategic: new MockStrategicAgent(), execution: new MockExecutionAgent(), queue: new InMemoryQueue() };
}
const WH_SECRET = "whsec-test";

/** Session admin (is_admin=true) — diprogram saat handler menangkap `SELECT role, is_admin`. */
const SESSION_ADMIN = { rows: [{ role: "owner", is_admin: true }], rowCount: 1 };
/** Non-admin (owner tapi is_admin=false) — harus 403 di semua rute admin. */
const SESSION_NONADMIN = { rows: [{ role: "owner", is_admin: false }], rowCount: 1 };

function adminSessionHandler(isAdmin: boolean): QueryHandler {
  return (text) => {
    if (text.startsWith("SELECT role, is_admin FROM users")) {
      return { rows: [{ role: "owner", is_admin: isAdmin }], rowCount: 1 } as unknown as QueryResult;
    }
    return { rows: [], rowCount: 1 } as unknown as QueryResult;
  };
}

describe("Admin Control Center — authZ", () => {
  const routes: Array<[string, string]> = [
    ["GET", "/admin/overview"],
    ["GET", "/admin/users"],
    ["GET", "/admin/orgs"],
    ["GET", "/admin/objectives"],
    ["GET", "/admin/approvals"],
    ["GET", "/admin/missions"],
    ["GET", "/admin/providers"],
    ["GET", "/admin/system"],
    ["GET", "/admin/audit"],
    ["GET", "/admin/economics"],
    ["GET", "/admin/billing"],
  ];

  it.each(routes)("%s %s → 401 tanpa sesi", async (method, url) => {
    const app = buildApp({ pool: makePool(adminSessionHandler(false)), deps: deps(), webhookSecret: WH_SECRET });
    const res = await app.inject({ method: method as never, url });
    expect(res.statusCode).toBe(401);
  });

  it.each(routes)("%s %s → 403 non-admin", async (method, url) => {
    const app = buildApp({ pool: makePool(adminSessionHandler(false)), deps: deps(), webhookSecret: WH_SECRET });
    const res = await app.inject({ method: method as never, url, headers: { "x-user-id": "u-own" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });
});

describe("Admin Control Center — mutation lifecycle & audit", () => {
  it("PATCH /admin/users/:id valid (role/status) + audit_logs INSERT", async () => {
    const auditCalls: Array<{ text: string; vals?: unknown[] }> = [];
    const app = buildApp({
      pool: makePool((text, vals) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        if (text.startsWith("UPDATE users SET")) return { rows: [{ id: "u-1", email: "a@b.c", role: "operator", name: null, status: "ACTIVE", is_admin: false }], rowCount: 1 } as unknown as QueryResult;
        if (text.startsWith("INSERT INTO audit_logs")) {
          auditCalls.push({ text, vals });
          return { rows: [], rowCount: 1 } as unknown as QueryResult;
        }
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({
      method: "PATCH", url: "/admin/users/u-1", payload: { role: "operator", name: "Budi" },
      headers: { "x-user-id": "u-admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe("operator");
    // Audit dipanggil persis sekali; action ada di bind param $2
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0]!.text).toContain("INSERT INTO audit_logs");
    expect(auditCalls[0]!.vals).toContain("users.update");
    expect(auditCalls[0]!.vals).toContain("user:u-1");
  });

  it("PATCH /admin/users/:id tidak boleh mencabut admin dari diri sendiri (409)", async () => {
    const app = buildApp({
      pool: makePool((text) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({
      method: "PATCH", url: "/admin/users/u-admin", payload: { is_admin: false },
      headers: { "x-user-id": "u-admin" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("STATE_VIOLATION");
  });

  it("PATCH /admin/users/:id 422 body tanpa field mutable", async () => {
    const app = buildApp({
      pool: makePool((text) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({
      method: "PATCH", url: "/admin/users/u-1", payload: { foo: "bar" },
      headers: { "x-user-id": "u-admin" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("DELETE /admin/users/:id menolak bila ada referensi (dependency analysis)", async () => {
    const app = buildApp({
      pool: makePool((text) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        // dependency counts: objectives=2 → tolak
        if (text.includes("AS objectives") && text.includes("AS memberships")) {
          return { rows: [{ objectives: 2, memberships: 0, sessions: 0, ventures: 0, approvals: 0, audit_logs: 0 }], rowCount: 1 } as unknown as QueryResult;
        }
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({ method: "DELETE", url: "/admin/users/u-1", headers: { "x-user-id": "u-admin" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("STATE_VIOLATION");
  });

  it("POST /admin/users/:id/suspend → status SUSPENDED + audit", async () => {
    const auditCalls: Array<{ text: string; vals?: unknown[] }> = [];
    const app = buildApp({
      pool: makePool((text, vals) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        if (text.startsWith("UPDATE users SET status")) return { rows: [{ id: "u-1", email: "a@b.c", status: "SUSPENDED" }], rowCount: 1 } as unknown as QueryResult;
        if (text.startsWith("INSERT INTO audit_logs")) { auditCalls.push({ text, vals }); return { rows: [], rowCount: 1 } as unknown as QueryResult; }
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({ method: "POST", url: "/admin/users/u-1/suspend", payload: {}, headers: { "x-user-id": "u-admin" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.status).toBe("SUSPENDED");
    expect(auditCalls.some((a) => a.vals?.includes("users.suspend"))).toBe(true);
  });
});

describe("Admin Control Center — providers (encrypted key + test)", () => {
  it("POST /admin/providers menyimpan key terenkripsi (bukan plaintext) + audit", async () => {
    let inserts: unknown[] = [];
    const app = buildApp({
      pool: makePool((text, vals) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        if (text.startsWith("UPDATE ai_providers SET is_primary")) return { rows: [], rowCount: 1 } as unknown as QueryResult;
        if (text.startsWith("INSERT INTO ai_providers")) {
          inserts = vals ?? [];
          return { rows: [{ id: "prov-1", name: "Kimi", provider: "openai_compatible", base_url: "https://api.x/v1", model: "kimi", role: "EXECUTION", is_primary: false, status: "ACTIVE", api_key_set: true }], rowCount: 1 } as unknown as QueryResult;
        }
        if (text.startsWith("INSERT INTO audit_logs")) return { rows: [], rowCount: 1 } as unknown as QueryResult;
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({
      method: "POST", url: "/admin/providers",
      payload: { name: "Kimi", base_url: "https://api.x/v1", api_key: "sk-secret-1234", model: "kimi", role: "EXECUTION", is_primary: false },
      headers: { "x-user-id": "u-admin" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().provider.api_key_set).toBe(true);
    // api_key_cipher harus Buffer (bytea), api_key_hash string — plaintext TIDAK bocor
    expect(Array.isArray(inserts)).toBe(true);
    const cipherIdx = inserts.findIndex((v) => Buffer.isBuffer(v));
    expect(cipherIdx).toBeGreaterThan(-1);
    const plaintextInRows = inserts.some((v) => typeof v === "string" && v.includes("sk-secret-1234"));
    expect(plaintextInRows).toBe(false);
  });

  it("POST /admin/providers reject api_key < 8 (422)", async () => {
    const app = buildApp({
      pool: makePool((text) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({
      method: "POST", url: "/admin/providers",
      payload: { name: "Kimi", base_url: "https://api.x/v1", api_key: "short", model: "kimi", role: "EXECUTION" },
      headers: { "x-user-id": "u-admin" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("POST /admin/providers reject base_url bukan URL (422)", async () => {
    const app = buildApp({
      pool: makePool((text) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({
      method: "POST", url: "/admin/providers",
      payload: { name: "Kimi", base_url: "bukan-url", api_key: "sk-secret-1234", model: "kimi", role: "EXECUTION" },
      headers: { "x-user-id": "u-admin" },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("Admin Control Center — org & objectives mutations", () => {
  it("PATCH /admin/orgs/:id mengubah plan_tier + audit", async () => {
    const auditCalls: Array<{ text: string; vals?: unknown[] }> = [];
    const app = buildApp({
      pool: makePool((text, vals) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        if (text.startsWith("UPDATE organizations SET")) return { rows: [{ id: "o-1", name: "Org", slug: "org", plan_tier: "GROWTH", status: "ACTIVE", autonomy_level: 2 }], rowCount: 1 } as unknown as QueryResult;
        if (text.startsWith("INSERT INTO audit_logs")) { auditCalls.push({ text, vals }); return { rows: [], rowCount: 1 } as unknown as QueryResult; }
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({
      method: "PATCH", url: "/admin/orgs/o-1", payload: { plan_tier: "GROWTH" },
      headers: { "x-user-id": "u-admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().organization.plan_tier).toBe("GROWTH");
    expect(auditCalls.some((a) => a.vals?.includes("orgs.update"))).toBe(true);
  });

  it("PATCH /admin/objectives/:id hanya edit field mutable (title/environment)", async () => {
    const auditCalls: Array<{ text: string; vals?: unknown[] }> = [];
    const app = buildApp({
      pool: makePool((text, vals) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        if (text.startsWith("UPDATE objectives SET")) return { rows: [{ id: "obj-1", title: "Baru", state: "RESEARCHING", environment: "TEST" }], rowCount: 1 } as unknown as QueryResult;
        if (text.startsWith("INSERT INTO audit_logs")) { auditCalls.push({ text, vals }); return { rows: [], rowCount: 1 } as unknown as QueryResult; }
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({
      method: "PATCH", url: "/admin/objectives/obj-1", payload: { environment: "TEST" },
      headers: { "x-user-id": "u-admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().objective.environment).toBe("TEST");
    expect(auditCalls.some((a) => a.vals?.includes("objectives.update"))).toBe(true);
  });

  it("PATCH /admin/objectives/:id menolak edit raw state (bukan field mutable)", async () => {
    const app = buildApp({
      pool: makePool((text) => {
        if (text.startsWith("SELECT role, is_admin FROM users")) return SESSION_ADMIN as unknown as QueryResult;
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }),
      deps: deps(), webhookSecret: WH_SECRET,
    });
    const res = await app.inject({
      method: "PATCH", url: "/admin/objectives/obj-1", payload: { state: "STOPPED" },
      headers: { "x-user-id": "u-admin" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
