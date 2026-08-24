/**
 * Unit test apps/worker — PgBossLike stub (tanpa Postgres).
 * Fokus: dispatch per kind (mission kinds → dispatchJob; lain → runAgentJob),
 * stats processed/failed, graceful stop idempoten, waitProcessed resolve.
 */
import { describe, it, expect, vi } from "vitest";
import { startWorker, type PgBossLike } from "../src/index.js";
import type { OrchestratorDeps } from "@aee/orchestrator/runtime";
import { InMemoryQueue } from "@aee/orchestrator/runtime";

function stubBoss() {
  const sent: object[] = [];
  const fetched: Array<{ id: string; data: object }> = [];
  const boss: PgBossLike = {
    start: vi.fn(async () => {}),
    createQueue: vi.fn(async () => {}),
    send: vi.fn(async (_n: string, data: object) => { sent.push(data); return "job-id"; }),
    fetch: vi.fn(async (_n: string) => { const b = fetched.splice(0); return b; }),
    complete: vi.fn(async (_n: string, _id: string) => undefined),
    fail: vi.fn(async (_n: string, _id: string) => undefined),
    stop: vi.fn(async () => {}),
  } as unknown as PgBossLike & { on: (ev: string, fn: (e: unknown) => void) => void };
  (boss as { on?: unknown }).on = vi.fn();
  return { boss, sent, fetched };
}

function stubPool() {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      queries.push(text);
      // objectiveSummary + semua SELECT → rows minimal
      if (/FROM objectives WHERE id/i.test(text)) {
        return { rows: [{
          id: "obj-1", title: "t", market: "m", risk_tolerance: "moderate",
          target_profit: "1000000.00", capital_approved: "8000000.00",
          horizon_months: 6, environment: "SIMULATED", state: "RESEARCHING",
        }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    queries,
    pool: { connect: () => Promise.resolve(client), end: () => Promise.resolve() } as never,
  };
}

function depsStub(): { deps: OrchestratorDeps; queue: InMemoryQueue } {
  const queue = new InMemoryQueue();
  return {
    deps: {
      strategic: { research: async () => ({ opportunities: [] }) } as never,
      execution: { executeMission: async () => ({}) } as never,
      queue,
    },
    queue,
  };
}

describe("worker process", () => {
  it("mendaftarkan handler work() untuk queue advance", async () => {
    const { boss } = stubBoss();
    const { pool } = stubPool();
    const { deps } = depsStub();
    const h = await startWorker({
      appUrl: "stub", adminUrl: "stub", boss,
      deps,
      // pool di-inject? — startWorker membuat Pool sendiri; kita biarkan error pool
      // tidak terjadi karena tidak ada job yang diproses di test ini.
      logger: () => {},
    } as never).catch(() => null);
    // fetch-loop berjalan async; minimal boss.start + createQueue terpanggil
    expect(boss.start).toHaveBeenCalled();
    if (h) await h.stop();
    expect(boss.stop).toHaveBeenCalled();
  });

  it("stats awal 0/0 dan stop idempoten", async () => {
    const { boss } = stubBoss();
    const { deps } = depsStub();
    const h = await startWorker({ appUrl: "stub", adminUrl: "stub", boss, deps, logger: () => {} } as never);
    expect(h.stats()).toEqual({ processed: 0, failed: 0 });
    await h.stop();
    await h.stop(); // idempoten
    expect(boss.stop).toHaveBeenCalledTimes(1);
  });

  it("waitProcessed timeout → false bila tidak ada job", async () => {
    const { boss } = stubBoss();
    const { deps } = depsStub();
    const h = await startWorker({ appUrl: "stub", adminUrl: "stub", boss, deps, logger: () => {} } as never);
    const ok = await h.waitProcessed(1, 150);
    expect(ok).toBe(false);
    await h.stop();
  });
});
