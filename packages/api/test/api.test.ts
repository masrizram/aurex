/**
 * Unit test @aee/api — pakai fastify.inject tanpa jaringan.
 * DB = stub PoolClient (query diprogram per-test) — fokus: authZ role,
 * error envelope §8, idempotency POST /objectives, validasi Zod, HMAC webhook.
 * Integrasi penuh vs PG scratch ada di scripts/verify-orchestrator.ts (S30+).
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import { buildApp } from "../src/index.js";
import { MockStrategicAgent, MockExecutionAgent } from "@aee/agents";
import { InMemoryQueue } from "@aee/orchestrator/runtime";
import { createHmac } from "node:crypto";

type QueryHandler = (text: string, values?: unknown[]) => QueryResult;

function makeClient(handler: QueryHandler): PoolClient {
  return {
    query: (text: string, values?: unknown[]) => Promise.resolve(handler(text, values)),
    release: () => undefined,
  } as unknown as PoolClient;
}

function makePool(handler: QueryHandler): Pool {
  return {
    connect: () => Promise.resolve(makeClient(handler)),
  } as unknown as Pool;
}

const SESSION_OWNER = { rows: [{ role: "owner", is_admin: false }], rowCount: 1 };
const SESSION_AUDITOR = { rows: [{ role: "auditor" }], rowCount: 1 };
const SESSION_SERVICE = { rows: [{ role: "service" }], rowCount: 1 };

function deps() {
  return {
    strategic: new MockStrategicAgent(),
    execution: new MockExecutionAgent(),
    queue: new InMemoryQueue(),
  };
}

const WH_SECRET = "whsec-test";

function appWith(handler: QueryHandler) {
  return buildApp({ pool: makePool(handler), deps: deps(), webhookSecret: WH_SECRET });
}

const VALID_OBJ_BODY = {
  title: "Objective uji", target_profit: "2000000.00", capital_approved: "10000000.00",
  horizon_months: 12, market: "id-digital", risk_tolerance: "moderate",
  business_mode: "DISCOVERY" as const,
};

describe("POST /objectives", () => {
  it("401 tanpa X-User-Id", async () => {
    const app = appWith(() => SESSION_OWNER as QueryResult);
    const res = await app.inject({ method: "POST", url: "/objectives", payload: VALID_OBJ_BODY });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("403 bila bukan owner", async () => {
    const app = appWith(() => SESSION_AUDITOR as QueryResult);
    const res = await app.inject({
      method: "POST", url: "/objectives", payload: VALID_OBJ_BODY,
      headers: { "x-user-id": "u-aud" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("422 body tidak valid (target_profit bukan MoneyString)", async () => {
    const app = appWith(() => SESSION_OWNER as QueryResult);
    const res = await app.inject({
      method: "POST", url: "/objectives",
      payload: { ...VALID_OBJ_BODY, target_profit: "2juta" },
      headers: { "x-user-id": "u-own", "idempotency-key": "k1" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("400 tanpa Idempotency-Key", async () => {
    const app = appWith(() => SESSION_OWNER as QueryResult);
    const res = await app.inject({
      method: "POST", url: "/objectives", payload: VALID_OBJ_BODY,
      headers: { "x-user-id": "u-own" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("201 + 200 idempoten key sama; 409 key sama body beda", async () => {
    const sha = (await import("node:crypto")).createHash;
    const hash = sha("sha256").update(JSON.stringify(VALID_OBJ_BODY), "utf8").digest("hex");
    let idemRow: { request_hash: string; response: unknown } | undefined;
    const app = appWith((text) => {
      if (text.startsWith("SELECT role")) return SESSION_OWNER as unknown as QueryResult;
      if (text.startsWith("SELECT request_hash, response FROM idempotency_keys")) {
        return { rows: idemRow ? [idemRow] : [], rowCount: idemRow ? 1 : 0 } as unknown as QueryResult;
      }
      if (text.startsWith("INSERT INTO idempotency_keys")) {
        idemRow = { request_hash: hash, response: { id: "replay", state: "OBJECTIVE_CREATED" } };
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      // G2: mock entitlement queries — return org + plan + count
      if (text.includes("FROM memberships") && text.includes("organizations")) {
        return { rows: [{ id: "org-1", name: "TestOrg", slug: "test", plan_tier: "FREE", onboarding_step: 5, onboarding_completed: null, autonomy_level: 1 }], rowCount: 1 } as unknown as QueryResult;
      }
      if (text.includes("FROM subscription_plans")) {
        return { rows: [{ max_objectives: 100 }], rowCount: 1 } as unknown as QueryResult;
      }
      if (text.includes("count(*)::int FROM objectives")) {
        return { rows: [{ count: 0 }], rowCount: 1 } as unknown as QueryResult;
      }
      return { rows: [], rowCount: 1 } as unknown as QueryResult;
    });
    const h = { "x-user-id": "u-own", "idempotency-key": "key-42" };
    const r1 = await app.inject({ method: "POST", url: "/objectives", payload: VALID_OBJ_BODY, headers: h });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().state).toBe("OBJECTIVE_CREATED");
    // replay idempoten
    const r2 = await app.inject({ method: "POST", url: "/objectives", payload: VALID_OBJ_BODY, headers: h });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().id).toBe("replay"); // response tersimpan di idempotency_keys
    // konflik: key sama, body beda
    const r3 = await app.inject({
      method: "POST", url: "/objectives",
      payload: { ...VALID_OBJ_BODY, title: "Bedanya sini" }, headers: h,
    });
    expect(r3.statusCode).toBe(409);
    expect(r3.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});

describe("Webhook pembayaran", () => {
  const whPayload = {
    external_id: "pkg-1:1:1", amount: "500000.00", kind: "REVENUE" as const, provider: "xendit",
  };
  const body = JSON.stringify(whPayload);
  const sig = createHmac("sha256", WH_SECRET).update(body).digest("hex");

  it("401 tanpa X-Signature", async () => {
    const app = appWith(() => ({ rows: [], rowCount: 0 } as unknown as QueryResult));
    const res = await app.inject({
      method: "POST", url: "/webhooks/payments/xendit", payload: whPayload,
      headers: { "x-user-id": "u-own" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("401 HMAC salah", async () => {
    const app = appWith(() => ({ rows: [], rowCount: 0 } as unknown as QueryResult));
    const res = await app.inject({
      method: "POST", url: "/webhooks/payments/xendit", payload: whPayload,
      headers: { "x-user-id": "u-own", "x-signature": "deadbeef" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  // D5: signature diverifikasi SEBELUM zod-validasi payload — payload invalid
  // + signature salah harus 401 (auth first), bukan 422 (feedback struktur).
  it("D5: payload invalid + signature salah → 401 (bukan 422)", async () => {
    const app = appWith(() => ({ rows: [], rowCount: 0 } as unknown as QueryResult));
    const res = await app.inject({
      method: "POST", url: "/webhooks/payments/xendit",
      payload: { wrong_field: true }, // schema-invalid
      headers: { "x-signature": "deadbeef" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  // D5: payload valid + signature BENAR → zod-validasi jalan (422 utk body invalid,
  // atau diproses). Signature benar atas payload invalid → 422 (bukan 401).
  it("D5: signature benar + payload invalid → 422 (validasi jalan setelah auth)", async () => {
    const app = appWith(() => ({ rows: [], rowCount: 0 } as unknown as QueryResult));
    const badBody = JSON.stringify({ wrong_field: true });
    const sig = createHmac("sha256", WH_SECRET).update(badBody).digest("hex");
    const res = await app.inject({
      method: "POST", url: "/webhooks/payments/xendit",
      payload: { wrong_field: true },
      headers: { "x-signature": sig },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("GET /objectives/:id & reads", () => {
  it("404 objective tidak ada (auditor boleh)", async () => {
    let first = true;
    const app = appWith(() => {
      if (first) { first = false; return SESSION_AUDITOR as QueryResult; }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });
    const res = await app.inject({
      method: "GET", url: "/objectives/00000000-0000-4000-8000-000000000009",
      headers: { "x-user-id": "u-aud" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("403 operator < owner di POST stop", async () => {
    const app = appWith(() => ({ rows: [{ role: "operator" }], rowCount: 1 } as QueryResult));
    const res = await app.inject({
      method: "POST", url: "/objectives/xxx/stop", payload: { reason: "sudah cukup" },
      headers: { "x-user-id": "u-op" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("health", () => {
  it("200 tanpa sesi", async () => {
    const app = appWith(() => ({ rows: [], rowCount: 0 } as unknown as QueryResult));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});

describe("Dashboard endpoints (§36)", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const dashPool = makePool((text) => {
    if (/FROM users WHERE id/i.test(text)) return SESSION_OWNER as QueryResult;
    if (/INSERT INTO users/i.test(text)) return { rows: [{ id: uid, role: "owner" }], rowCount: 1 } as QueryResult;
    if (/FROM economic_snapshots/i.test(text)) return { rows: [], rowCount: 0 } as unknown as QueryResult;
    if (/FROM approvals WHERE/i.test(text)) return { rows: [], rowCount: 0 } as unknown as QueryResult;
    return { rows: [], rowCount: 0 } as unknown as QueryResult;
  });
  const dashApp = buildApp({ pool: dashPool, deps: deps(), webhookSecret: WH_SECRET });

  it("GET / menyajikan dashboard.html", async () => {
    const res = await dashApp.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Economic Control Center");
  });

  it("POST /dev/seed-user idempoten → owner", async () => {
    const r1 = await dashApp.inject({ method: "POST", url: "/dev/seed-user",
      headers: { "x-user-id": uid } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().user.role).toBe("owner");
    const r2 = await dashApp.inject({ method: "POST", url: "/dev/seed-user",
      headers: { "x-user-id": uid } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().user.role).toBe("owner");
  });

  it("POST /dev/seed-user tanpa header → 422", async () => {
    const r = await dashApp.inject({ method: "POST", url: "/dev/seed-user" });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /objectives sesi owner → list + snapshot join", async () => {
    const res = await dashApp.inject({ method: "GET", url: "/objectives",
      headers: { "x-user-id": uid } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.objectives)).toBe(true);
  });

  it("GET /objectives tanpa sesi → 401", async () => {
    const res = await dashApp.inject({ method: "GET", url: "/objectives" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /approvals tanpa query → inbox lintas-objective; dengan query → 200", async () => {
    // §11 master prompt: approvals = economic decision inbox organisasi.
    // objective_id kini OPSIONAL (tanpa filter = seluruh objective tenant).
    const r1 = await dashApp.inject({ method: "GET", url: "/approvals",
      headers: { "x-user-id": uid } });
    expect(r1.statusCode).toBe(200);
    expect(Array.isArray(r1.json().approvals)).toBe(true);
    const r2 = await dashApp.inject({ method: "GET", url: "/approvals?objective_id=00000000-0000-0000-0000-000000000000",
      headers: { "x-user-id": uid } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().approvals).toEqual([]);
  });
});

// ═══ D2/D3: signup enumeration + login rate-limit key ════════════════════════
describe("D2 signup enumeration + D3 login rate-limit", () => {
  const SESSION_OWNER_ROW = { rows: [{ role: "owner", is_admin: false }], rowCount: 1 };

  function authPool() {
    return makePool((text) => {
      // signup: existing check
      if (text.includes("SELECT id FROM users WHERE email")) {
        return { rows: [{ id: "u-exist" }], rowCount: 1 } as unknown as QueryResult; // email sudah ada
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });
  }

  it("D2: signup duplikat → 409 dengan pesan generik (tanpa 'email sudah terdaftar')", async () => {
    const app = buildApp({ pool: authPool(), deps: deps(), webhookSecret: WH_SECRET });
    const res = await app.inject({
      method: "POST", url: "/auth/signup",
      payload: { email: "ada@example.com", password: "Passw0rd!x" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).not.toContain("email sudah terdaftar");
    expect(res.json().error.message).toContain("cek email Anda");
  });

  it("D3: 11x login salah dari IP sama → 429 RATE_LIMITED", async () => {
    // pool: user tidak ditemukan → 401 tiap percobaan
    const pool = makePool(() => ({ rows: [], rowCount: 0 } as unknown as QueryResult));
    const app = buildApp({ pool, deps: deps(), webhookSecret: WH_SECRET });
    const email = "victim@example.com";
    let last = 0;
    for (let i = 0; i < 11; i += 1) {
      const r = await app.inject({
        method: "POST", url: "/auth/login",
        payload: { email, password: "wrong-pass" },
        remoteAddress: "203.0.113.7",
      });
      last = r.statusCode;
    }
    expect(last).toBe(429);
    expect([401, 429]).toContain(last);
  });

  it("D3: rate-limit tidak mengunci akun korban dari IP BERBEDA (anti-DoS akun)", async () => {
    const pool = makePool(() => ({ rows: [], rowCount: 0 } as unknown as QueryResult));
    const app = buildApp({ pool, deps: deps(), webhookSecret: WH_SECRET });
    const email = "victim2@example.com";
    // attacker dari IP A mengisi rate-limit 11x
    for (let i = 0; i < 11; i += 1) {
      await app.inject({
        method: "POST", url: "/auth/login",
        payload: { email, password: "wrong" },
        remoteAddress: "203.0.113.99",
      });
    }
    // korban dari IP B tetap bisa mencoba (tidak 429)
    const r = await app.inject({
      method: "POST", url: "/auth/login",
      payload: { email, password: "wrong" },
      remoteAddress: "198.51.100.5",
    });
    expect(r.statusCode).not.toBe(429);
  });
});
// Bukti bug: user FREE bisa buat 3+ objective via onboarding step5 (jalur
// tanpa quota check). Fix: checkObjectiveQuota dipasang di SEMUA jalur create.
describe("D1 billing quota — FREE max 1 objective", () => {
  const uid = "22222222-2222-4222-8222-222222222222";

  function quotaPool(count: number) {
    return makePool((text) => {
      if (/FROM users WHERE id/i.test(text)) return SESSION_OWNER as QueryResult;
      // getOrgForUser
      if (text.includes("FROM memberships")) {
        return { rows: [{ id: "org-d1", name: "OrgD1", slug: "d1", plan_tier: "FREE",
          onboarding_step: 4, onboarding_completed: null, autonomy_level: 2 }], rowCount: 1 } as unknown as QueryResult;
      }
      // plan max_objectives (checkObjectiveQuota)
      if (text.includes("FROM subscription_plans")) {
        return { rows: [{ max_objectives: 1 }], rowCount: 1 } as unknown as QueryResult;
      }
      // hitung objective aktif user
      if (text.includes("count(*)::int FROM objectives")) {
        return { rows: [{ count }], rowCount: 1 } as unknown as QueryResult;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });
  }

  it("step5 ditolak 429 saat quota FREE penuh (1 aktif)", async () => {
    const app = buildApp({ pool: quotaPool(1), deps: deps(), webhookSecret: WH_SECRET });
    const res = await app.inject({
      method: "POST", url: "/onboarding/step5",
      payload: { title: "Objek kedua", target_profit: "1000000.00" },
      headers: { "x-user-id": uid },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("RATE_LIMITED");
    expect(res.json().error.message).toContain("objective limit reached (1/1)");
  });

  it("step5 lolos saat masih ada slot (0 aktif)", async () => {
    const app = buildApp({ pool: quotaPool(0), deps: deps(), webhookSecret: WH_SECRET });
    const res = await app.inject({
      method: "POST", url: "/onboarding/step5",
      payload: { title: "Objek pertama", target_profit: "1000000.00" },
      headers: { "x-user-id": uid },
    });
    // 422 = venture belum ada (stub kosong) — tapi BUKAN 429: quota lolos.
    expect(res.statusCode).not.toBe(429);
  });

  it("POST /objectives juga 429 saat quota penuh (jalur lama tertutup juga)", async () => {
    const app = buildApp({ pool: quotaPool(1), deps: deps(), webhookSecret: WH_SECRET });
    const res = await app.inject({
      method: "POST", url: "/objectives", payload: VALID_OBJ_BODY,
      headers: { "x-user-id": uid, "idempotency-key": "d1-key" },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.message).toContain("objective limit reached (1/1)");
  });
});
