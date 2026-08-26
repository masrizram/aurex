// ═════════════════════════════════════════════════════════════════
// Product-layer contract tests (§42 master prompt) — fastify.inject,
// DB = stub pool. Fokus: bentuk payload /overview, decision pack
// approvals (§11), events global lintas-objective (§16), dan isolasi
// tenant di setiap query baru.
// ═════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import type { Pool, QueryResult } from "pg";
import { buildApp } from "../src/index.js";
import { checkObjectiveQuota } from "../src/context.js";
import { MockStrategicAgent, MockExecutionAgent } from "@aee/agents";
import { InMemoryQueue } from "@aee/orchestrator/runtime";

type QueryHandler = (text: string, values?: unknown[]) => QueryResult;

function makeClient(handler: QueryHandler): PoolClientLike {
  return {
    query: (text: string, values?: unknown[]) => Promise.resolve(handler(text, values)),
    release: () => undefined,
  } as unknown as PoolClientLike;
}
interface PoolClientLike { query: (t: string, v?: unknown[]) => Promise<QueryResult>; release: () => void }

function makePool(handler: QueryHandler): Pool {
  return {
    connect: () => Promise.resolve(makeClient(handler)),
  } as unknown as Pool;
}

const SESSION_OWNER = { rows: [{ role: "owner", is_admin: false }], rowCount: 1 };

function deps() {
  return {
    strategic: new MockStrategicAgent(),
    execution: new MockExecutionAgent(),
    queue: new InMemoryQueue(),
  };
}

const UID = "22222222-2222-4222-8222-222222222222";
const H = { "x-user-id": UID };

describe("D9 quota semantics — NULL plan column = unlimited, bukan 1", () => {
  it("ENTERPRISE (max_objectives NULL) tetap boleh create meski sudah ada objective aktif", async () => {
    // Regresi: `?? 1` lama men-coerce NULL→1 sehingga ENTERPRISE dibatasi 1.
    await expect(
      checkObjectiveQuota(
        makeClient((text) => {
          if (/FROM subscription_plans/.test(text))
            return { rows: [{ max_objectives: null }], rowCount: 1 } as unknown as QueryResult;
          if (/count\(\*\)::int FROM objectives/.test(text))
            return { rows: [{ count: 7 }], rowCount: 1 } as unknown as QueryResult;
          throw new Error("unexpected query: " + text.slice(0, 60));
        }) as never,
        "u-ent", "org-1", "ENTERPRISE",
      ),
    ).resolves.toBeUndefined();
  });

  it("FREE (max 1) ditolak saat kuota habis", async () => {
    await expect(
      checkObjectiveQuota(
        makeClient((text) => {
          if (/FROM subscription_plans/.test(text))
            return { rows: [{ max_objectives: 1 }], rowCount: 1 } as unknown as QueryResult;
          if (/count\(\*\)::int FROM objectives/.test(text))
            return { rows: [{ count: 1 }], rowCount: 1 } as unknown as QueryResult;
          throw new Error("unexpected query: " + text.slice(0, 60));
        }) as never,
        "u-free", "org-2", "FREE",
      ),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });

  it("plan row hilang → fallback konservatif 1 (bukan unlimited)", async () => {
    await expect(
      checkObjectiveQuota(
        makeClient((text) => {
          if (/FROM subscription_plans/.test(text))
            return { rows: [], rowCount: 0 } as unknown as QueryResult;
          if (/count\(\*\)::int FROM objectives/.test(text))
            return { rows: [{ count: 1 }], rowCount: 1 } as unknown as QueryResult;
          throw new Error("unexpected query: " + text.slice(0, 60));
        }) as never,
        "u-x", "org-3", "GHOST_TIER",
      ),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });
});

describe("GET /ai-economics — akuntabilitas AI (§17)", () => {
  it("agregasi model_runs per agent/purpose; tenant-scoped", async () => {
    let q = "";
    const app = buildApp({
      pool: makePool((text) => {
        if (/FROM users WHERE id/i.test(text)) return SESSION_OWNER as unknown as QueryResult;
        if (/FROM model_runs mr/.test(text)) {
          q = text;
          return {
            rows: [{
              agent: "KIMI", purpose: "research", runs: 3, succeeded: 2, failed: 1,
              input_tokens: "1200", output_tokens: "340", cost: null, avg_latency_ms: 820,
            }],
            rowCount: 1,
          } as unknown as QueryResult;
        }
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
      }),
      deps: deps(),
      webhookSecret: "whsec-test",
    });
    const res = await app.inject({ method: "GET", url: "/ai-economics", headers: H });
    expect(res.statusCode).toBe(200);
    const row = res.json().by_agent_purpose[0];
    expect(row.agent).toBe("KIMI");
    expect(row.runs).toBe(3);
    expect(row.cost).toBeNull(); // billing adapter belum mencatat → UI tampil —
    expect(q).toMatch(/o\.user_id = \$\d+/); // isolasi tenant
  });
});

describe("GET /overview — Economic Control Center aggregate", () => {
  it("200 dengan scoreboard/trajectory/attention/events; angka dari snapshot ledger", async () => {
    const seen: string[] = [];
    const app = buildApp({
      pool: makePool((text) => {
        seen.push(text);
        if (/FROM users WHERE id/i.test(text)) return SESSION_OWNER as unknown as QueryResult;
        if (/FROM objectives o\s*$/i.test(text) || (/FROM objectives o/.test(text) && /ORDER BY o\.created_at DESC LIMIT 50/.test(text)))
          return {
            rows: [{
              id: "obj-1", title: "Naikkan profit", state: "MISSION_APPROVED",
              business_mode: "DISCOVERY", environment: "SIMULATED",
              target_profit: "5000000.00", capital_approved: "20000000.00",
              current_cycle: 1, row_version: 1, created_at: "2026-08-01T00:00:00Z",
              business_name: "Kopi Nusantara",
            }],
            rowCount: 1,
          } as unknown as QueryResult;
        if (/FROM economic_snapshots s/.test(text)) {
          return {
            rows: [
              {
                objective_id: "obj-1", objective_title: "Naikkan profit",
                revenue: "1000000.00", cogs: "400000.00", gross_profit: "600000.00",
                gross_margin: "0.60", opex: "200000.00", operating_profit: "300000.00",
                capital_deployed: "2000000.00", capital_remaining: "18000000.00",
                drawdown: "0.00", roi: "0.05", created_at: "2026-08-25T10:00:00Z",
              },
              {
                objective_id: "obj-1", objective_title: "Naikkan profit",
                revenue: "1500000.00", cogs: "600000.00", gross_profit: "900000.00",
                gross_margin: "0.60", opex: "250000.00", operating_profit: "500000.00",
                capital_deployed: "2500000.00", capital_remaining: "17500000.00",
                drawdown: "0.00", roi: "0.06", created_at: "2026-08-26T10:00:00Z",
              },
            ],
            rowCount: 2,
          } as unknown as QueryResult;
        }
        if (/FROM capital_transactions t/.test(text))
          return { rows: [{ verified_revenue: "750000.00", verified_cost: "300000.00" }], rowCount: 1 } as unknown as QueryResult;
        if (/FROM approvals a JOIN objectives/.test(text))
          return {
            rows: [{
              id: "ap-1", objective_id: "obj-1", category: "LARGE_CAPITAL", status: "PENDING",
              capital_at_risk: "5000000.00", why_required: "Modal > batas otonomi",
              what_will_happen: "Deploy kampanye", expires_at: null, created_at: "2026-08-26T09:00:00Z",
              objective_title: "Naikkan profit",
            }],
            rowCount: 1,
          } as unknown as QueryResult;
        if (/FROM executions e/.test(text)) return { rows: [], rowCount: 0 } as unknown as QueryResult;
        if (/FROM experiments e/.test(text)) return { rows: [{ status: "MEASURING", count: 2 }], rowCount: 1 } as unknown as QueryResult;
        if (/FROM decisions d/.test(text)) return { rows: [{ decision: "SCALE", count: 1 }], rowCount: 1 } as unknown as QueryResult;
        if (/FROM missions m/.test(text)) return { rows: [{ status: "COMPLETED", count: 1 }], rowCount: 1 } as unknown as QueryResult;
        if (/FROM events e JOIN objectives/.test(text))
          return {
            rows: [{
              id: "ev-1", objective_id: "obj-1", event_type: "MISSION_APPROVED",
              payload: { why: "ok" }, created_at: "2026-08-26T11:00:00Z",
              objective_title: "Naikkan profit",
            }],
            rowCount: 1,
          } as unknown as QueryResult;
        throw new Error("unexpected query: " + text.slice(0, 80));
      }),
      deps: deps(),
      webhookSecret: "whsec-test",
    });

    const res = await app.inject({ method: "GET", url: "/overview", headers: H });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Scoreboard dari snapshot terakhir per objective + verified dari ledger RECONCILED
    expect(body.scoreboard.revenue).toBe(1500000);
    expect(body.scoreboard.operating_profit).toBe(500000);
    expect(body.scoreboard.capital_deployed).toBe(2500000);
    expect(body.scoreboard.verified_revenue).toBe(750000);
    // ROI portofolio = identitas engine (net = op + cogs) ÷ modal objektif aktif
    expect(body.scoreboard.portfolio_roi).toBeCloseTo((500000 + 600000) / 20000000);

    // Trajectory mempertahankan seri kronologis untuk grafik
    expect(body.trajectory).toHaveLength(2);
    expect(body.trajectory[0].revenue).toBe("1000000.00");

    // Attention queue membawa decision pack minimal utk approval pending
    expect(body.attention.pending_approvals).toHaveLength(1);
    expect(body.attention.pending_approvals[0].capital_at_risk).toBe("5000000.00");
    expect(body.counts.experiments_total).toBe(2);

    // Tenant isolation: SEMUA query data wajib menyaring user_id
    const tenantScoped = seen.filter((q) =>
      /FROM economic_snapshots s|FROM capital_transactions t|FROM approvals a|FROM executions e|FROM experiments e|FROM decisions d|FROM missions m|FROM events e/.test(q)
    );
    expect(tenantScoped.length).toBeGreaterThan(0);
    for (const q of tenantScoped) {
      expect(/user_id = \$1|o\.user_id = \$1/.test(q)).toBe(true);
    }

    // Tanpa sesi → 401
    const anon = await app.inject({ method: "GET", url: "/overview" });
    expect(anon.statusCode).toBe(401);
  });
});

describe("GET /approvals — economic decision inbox (§11)", () => {
  it("tanpa objective_id → inbox organisasi; baris membawa kolom keputusan engine", async () => {
    let inboxQuery = "";
    const app = buildApp({
      pool: makePool((text) => {
        if (/FROM users WHERE id/i.test(text)) return SESSION_OWNER as unknown as QueryResult;
        if (/FROM approvals a/.test(text)) {
          inboxQuery = text;
          return {
            rows: [{
              id: "ap-9", objective_id: "obj-9", category: "IRREVERSIBLE", status: "PENDING",
              payload: { legacy: true }, why_required: "Aksi permanen",
              what_will_happen: "Hapus kanal iklan lama", capital_at_risk: "0.00",
              expected_upside: "1200000.00", expected_downside: "-300000.00",
              reversible: false, expires_at: "2026-09-01T00:00:00Z",
              decided_at: null, decided_by: null, created_at: "2026-08-26T08:00:00Z",
              objective_title: "Restrukturisasi kanal",
            }],
            rowCount: 1,
          } as unknown as QueryResult;
        }
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
      }),
      deps: deps(),
      webhookSecret: "whsec-test",
    });

    const res = await app.inject({ method: "GET", url: "/approvals", headers: H });
    expect(res.statusCode).toBe(200);
    const a = res.json().approvals[0];
    // Decision pack dari KOLOM ASLI (ditulis engine saat approval dibuat)
    expect(a.why_required).toBe("Aksi permanen");
    expect(a.what_will_happen).toBe("Hapus kanal iklan lama");
    expect(a.expected_upside).toBe("1200000.00");
    expect(a.reversible).toBe(false);
    expect(a.objective_title).toBe("Restrukturisasi kanal");
    // Isolasi tenant pada jalur inbox (param posisi bisa $2 karena objective_id opsional di $1)
    expect(inboxQuery).toMatch(/o\.user_id = \$\d+/);
  });
});

describe("GET /events — economic timeline (§16)", () => {
  it("tanpa objective_id → seluruh event tenant, terbaru dulu", async () => {
    let evQuery = "";
    const app = buildApp({
      pool: makePool((text) => {
        if (/FROM users WHERE id/i.test(text)) return SESSION_OWNER as unknown as QueryResult;
        if (/FROM events e/.test(text)) {
          evQuery = text;
          return {
            rows: [
              { id: "ev-a", event_type: "OPPORTUNITIES_RANKED", payload: {}, created_at: "2026-08-26T12:00:00Z", stage: "SELECTING", objective_title: "A" },
              { id: "ev-b", event_type: "RESEARCH_STARTED", payload: {}, created_at: "2026-08-25T12:00:00Z", stage: "RESEARCHING", objective_title: "B" },
            ],
            rowCount: 2,
          } as unknown as QueryResult;
        }
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
      }),
      deps: deps(),
      webhookSecret: "whsec-test",
    });

    const res = await app.inject({ method: "GET", url: "/events", headers: H });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0].event_type).toBe("OPPORTUNITIES_RANKED");
    expect(evQuery).not.toMatch(/AND e\.objective_id = \$/); // tanpa filter wajib
    expect(evQuery).toMatch(/o\.user_id = \$\d+/);           // tapi tetap ter-scope tenant

    const filtered = await app.inject({ method: "GET", url: "/events?objective_id=00000000-0000-0000-0000-000000000000", headers: H });
    expect(filtered.statusCode).toBe(200);
  });
});
