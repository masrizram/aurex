/**
 * scripts/serve-prod.ts — Production entry point for Fly.io.
 * Baca DATABASE_URL + DATABASE_APP_URL dari env (no WSL, no Docker local).
 * Run migrations idempotent, start API + worker.
 */
import "dotenv/config";
import { Pool } from "pg";
import { buildApp } from "@aee/api";
import { createAgents } from "@aee/agents";
import { PgBossQueue } from "@aee/orchestrator/runtime";
import { startWorker } from "../apps/worker/src/index.js";
import pgBossCtor from "pg-boss";

const PORT = Number(process.env.PORT ?? 3000);

// ── DB URLs from environment ───────────────────────────────────────────────
const ADMIN_URL = process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_APP_URL ?? ADMIN_URL;

if (!ADMIN_URL) {
  console.error("[serve-prod] DATABASE_URL env var required");
  process.exit(1);
}

// ── Wait for DB to be ready ─────────────────────────────────────────────────
async function waitForDb(url: string, maxAttempts = 30): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query("SELECT 1");
      console.log(`[serve-prod] DB ready (attempt ${attempt}/${maxAttempts})`);
      await pool.end();
      return;
    } catch {
      console.log(`[serve-prod] DB belum siap (attempt ${attempt}/${maxAttempts}), retry 5s…`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await pool.end().catch(() => {});
  throw new Error("[serve-prod] DB tidak terjangkau setelah " + maxAttempts + " percobaan");
}

await waitForDb(ADMIN_URL);

// ── Run migrations (idempotent) ────────────────────────────────────────────
const { execFile } = await import("node:child_process");
await new Promise<void>((resolve) => {
  execFile("npx", ["tsx", "scripts/run-migrations.ts"], {
    timeout: 120_000,
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: ADMIN_URL },
  }, () => {
    console.log("[serve-prod] migrations OK (idempotent)");
    resolve();
  });
});

// ── Pools + Queue ──────────────────────────────────────────────────────────
const apiPool = new Pool({ connectionString: APP_URL, max: 8 });
apiPool.on("error", (err) => console.error("[apiPool] error (diabaikan):", err.message));
const boss = new pgBossCtor({ connectionString: ADMIN_URL }) as never;
const queue = new PgBossQueue(boss as never);

// ── Agents ──────────────────────────────────────────────────────────────────
const agents = createAgents({
  baseUrl: process.env.NINEROUTER_BASE_URL ?? "http://localhost:20128/v1",
  kimi: { model: process.env.KIMI_MODEL ?? "streamlake/kimi-k3", apiKey: process.env.KIMI_API_KEY ?? "" },
  glm: { model: process.env.GLM_MODEL ?? "streamlake/glm-5.2", apiKey: process.env.GLM_API_KEY ?? "" },
});

// ── API ────────────────────────────────────────────────────────────────────
const app = buildApp({
  pool: apiPool,
  queue,
  deps: { agents, worker: { start: () => startWorker({ queue, pool: apiPool, agents }) } },
  logger: undefined,
});
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`[serve-prod] AEE API listening on 0.0.0.0:${PORT}`);
console.log(`[serve-prod] agent mode: REAL · KIMI=${process.env.KIMI_MODEL ?? "streamlake/kimi-k3"} · GLM=${process.env.GLM_MODEL ?? "streamlake/glm-5.2"}`);
