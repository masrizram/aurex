/**
 * scripts/serve.ts — dev/demo entry (dashboard + worker + API satu proses).
 *
 *   npx tsx scripts/serve.ts            # port 3000
 *   AEE_PORT=8080 npx tsx scripts/serve.ts
 *
 * #1 Production-safe DB handling:
 *   - DATABASE_URL / DATABASE_APP_URL = SATU-SATUNYA source of truth.
 *   - Tanpa hardcode host. Fallback probe WSL hanya jika AEE_DEV_PROBE=1
 *     DAN bukan production (dev/demo di mesin ini).
 *   - ResilientPool: transient error → bounded retry; pool error tidak crash.
 *   - /health: api=up + db=healthy|unhealthy (readiness terpisah).
 *   - Worker fetch loop sudah punya catch + backoff sendiri.
 *
 * Production (Fly.io) memakai scripts/serve-prod.ts — tidak ada logika WSL.
 */
import "dotenv/config";
import { ResilientPool } from "@aee/db";
import { buildApp } from "@aee/api";
import { createAgents } from "@aee/agents";
import { PgBossQueue } from "@aee/orchestrator/runtime";
import { startWorker } from "../apps/worker/src/index.js";
import pgBossCtor from "pg-boss";
import type { Pool } from "pg";

const PORT = Number(process.env.AEE_PORT ?? 3000);
const IS_PROD = process.env.NODE_ENV === "production";

// ── 1. URL DB: env dulu, selalu. ────────────────────────────────────────────
function dbUrlFromEnv(): string | null {
  return process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL ?? null;
}

/** Dev/demo fallback (WSL docker) — HANYA bila env mengizinkan, non-prod. */
async function devProbeUrl(): Promise<string | null> {
  if (IS_PROD) return null;
  if (process.env.AEE_DEV_PROBE !== "1") return null;
  const { execFile } = await import("node:child_process");
  const run = (cmd: string, args: string[]): Promise<string> =>
    new Promise((resolve) => {
      execFile(cmd, args, { timeout: 60_000 }, (_e, stdout) => resolve(String(stdout ?? "")));
    });
  // Start container bila mati (dev machine).
  await run("wsl.exe", ["-e", "bash", "-c",
    "docker inspect aee-orch-pg >/dev/null 2>&1 && docker start aee-orch-pg 2>/dev/null; for i in $(seq 1 60); do docker exec aee-orch-pg pg_isready -U postgres -d aee >/dev/null 2>&1 && break; sleep 1; done"]);
  const probe = async (url: string): Promise<boolean> => {
    const { Pool: P } = await import("pg");
    const pool = new P({ connectionString: url, max: 1, connectionTimeoutMillis: 4000 });
    try { await pool.query("SELECT 1"); return true; }
    catch { return false; }
    finally { await pool.end().catch(() => {}); }
  };
  // Kandidat: env port → localhost + IP WSL (dev-only; tidak pernah menulis
  // nilai ini ke kode/config prod).
  const port = process.env.AEE_DB_PORT ?? "55433";
  const ip = await new Promise<string>((resolve) => {
    execFile("wsl.exe", ["-e", "bash", "-c", "hostname -I | awk '{print $1}'"],
      { timeout: 20_000 }, (_e, stdout) => resolve(String(stdout ?? "").replace(/[\0\r\n ]/g, "")));
  });
  const candidates = [ip, "localhost"].filter(Boolean);
  for (const host of candidates) {
    const url = `postgres://postgres:auditpass@${host}:${port}/aee`;
    if (await probe(url)) { console.log(`[serve] dev probe: DB host ${host}`); return url; }
  }
  return null;
}

// ── 2. Resolve URL (env → dev probe) ────────────────────────────────────────
let APP_URL = dbUrlFromEnv();
if (!APP_URL) {
  console.log("[serve] DATABASE_URL/DATABASE_APP_URL tidak di-set — mencoba dev probe (AEE_DEV_PROBE)…");
  APP_URL = await devProbeUrl();
}
if (!APP_URL) {
  console.error("[serve] Tidak ada koneksi DB: set DATABASE_URL/DATABASE_APP_URL di .env (lihat .env.example).");
  process.exit(1);
}
const ADMIN_URL = process.env.DATABASE_URL ?? APP_URL;

console.log(`[serve] DB URL dari env: ${maskUrl(APP_URL)}`);

function maskUrl(url: string): string {
  return url.replace(/:[^:@/]+@/, ":***@");
}

// ── 3. Pool resilient + agents + queue ──────────────────────────────────────
const apiPool = new ResilientPool({ url: APP_URL, label: "apiPool", max: 8, onEvent: (m) => console.log(m) });
const boss = new pgBossCtor({ connectionString: ADMIN_URL }) as never;
const queue = new PgBossQueue(boss as never);
const agents = createAgents();
console.log("[serve] agent mode:", agents.mode, "·", agents.modelLabel);
const deps = { strategic: agents.strategic, execution: agents.execution, queue };

const app = buildApp({
  pool: apiPool.raw as Pool,
  deps,
  webhookSecret: "whsec-demo",
  dbHealth: () => apiPool.health(),
});

// ── 4. Worker + boss: start di background dengan bounded retry (#1) ────────
// boss.start() saat DB down TIDAK menjatuhkan proses; di-retry hingga sukses.
const workerLog = (m: string) => { if (!/loop error/.test(m)) console.log("[worker]", m); };

// ── 5. Listen FIRST: API hidup walau DB down (readiness = db unhealthy) ─────
await app.listen({ port: PORT, host: "127.0.0.1" });
apiPool.startProbing(5_000);

console.log("");
console.log("  ╔══════════════════════════════════════════════╗");
console.log("  ║  AEE — Economic Control Center               ║");
console.log(`  ║  buka:  http://127.0.0.1:${PORT}                    ║`);
console.log("  ║  health: /health (api + db readiness)        ║");
console.log("  ║  stop :  Ctrl+C                              ║");
console.log("  ╚══════════════════════════════════════════════╝");
console.log("");

let worker: Awaited<ReturnType<typeof startWorker>> | null = null;
{
  const MAX_START_RETRIES = 60; // ~5 menit, backoff 5s
  const startWithRetry = async (): Promise<void> => {
    for (let attempt = 1; attempt <= MAX_START_RETRIES; attempt++) {
      try {
        worker = await startWorker({
          appUrl: APP_URL, adminUrl: ADMIN_URL, boss: boss as never,
          deps: deps as never, pollIntervalMs: 400,
          logger: workerLog,
        });
        console.log(`[worker] started (attempt ${attempt})`);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[worker] start gagal (attempt ${attempt}/${MAX_START_RETRIES}), retry 5s: ${msg.slice(0, 100)}`);
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
    console.error("[worker] TIDAK berhasil start setelah retry maksimum — API tetap hidup (readiness mengikuti DB).");
  };
  void startWithRetry(); // background — tidak menahan listen
}

// ── 6. Migrasi idempoten di background (bounded retry) — tidak menahan boot ─
{
  const { execFile } = await import("node:child_process");
  const runMigrations = (): Promise<void> =>
    new Promise((resolve, reject) => {
      // Windows: npx harus via cmd shell (spawn npx ENOENT tanpa shell).
      const isWin = process.platform === "win32";
      execFile(isWin ? "npx.cmd" : "npx", ["tsx", "scripts/run-migrations.ts"], {
        timeout: 120_000, cwd: process.cwd(), shell: isWin,
        env: { ...process.env, DATABASE_URL: ADMIN_URL },
      }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  const migrateWithRetry = async (): Promise<void> => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      try {
        await runMigrations();
        console.log("[serve] migrations OK (idempotent)");
        return;
  } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[serve] migrations gagal (attempt ${attempt}/12), retry 10s: ${msg.slice(0, 100)}`);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
    console.error("[serve] migrations GAGAL setelah 12 percobaan — /health tetap unhealthy.");
  };
  void migrateWithRetry();
}

// ── 6b. Dev DB keeper: saat DB down & AEE_DEV_PROBE=1, coba start container
// (throttled 60s). Non-prod only; production DB dikelola platform (Fly.io).
{
  const devProbe = process.env.AEE_DEV_PROBE === "1" && !IS_PROD;
  if (devProbe) {
    let lastAttempt = 0;
    setInterval(() => { void (async () => {
      if (apiPool.health().db === "healthy") return;
      if (Date.now() - lastAttempt < 60_000) return;
      lastAttempt = Date.now();
      const { execFile } = await import("node:child_process");
      console.log("[serve] DB down — mencoba start container dev (AEE_DEV_PROBE=1)…");
      execFile("wsl.exe", ["-e", "bash", "-c",
        "docker start aee-orch-pg 2>/dev/null || docker run -d --name aee-orch-pg --restart unless-stopped -v aee-orch-data:/var/lib/postgresql/data -e POSTGRES_PASSWORD=auditpass -e POSTGRES_DB=aee -p 0.0.0.0:55433:5432 postgres:16-alpine"],
        { timeout: 60_000 }, () => { /* best effort */ });
    })(); }, 15_000).unref?.();
  }
}

// ── 5. Transient DB errors tidak menjatuhkan proses ─────────────────────────
process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (/terminating|ECONNREFUSED|ECONNRESET|57P01|EPIPE|ETIMEDOUT/i.test(msg)) {
    console.error("[uncaught] pg connection drop (diabaikan):", msg);
  } else {
    console.error("[uncaught]", err);
    process.exit(1);
  }
});
process.on("unhandledRejection", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (/terminating|ECONNREFUSED|ECONNRESET|57P01|EPIPE|ETIMEDOUT/i.test(msg)) {
    console.error("[unhandled] pg connection drop (diabaikan):", msg);
  } else {
    console.error("[unhandled]", err);
    process.exit(1);
  }
});

async function shutdown(): Promise<void> {
  console.log("\n[serve] shutting down…");
  apiPool.stopProbing();
  try { if (worker) await worker.stop(); } catch { /* ignore */ }
  try { await app.close(); } catch { /* ignore */ }
  try { await apiPool.end(); } catch { /* ignore */ }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
