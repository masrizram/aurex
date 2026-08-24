/**
 * scripts/serve.ts — jalankan AEE untuk dicoba (dashboard + worker).
 *
 *   npx tsx scripts/serve.ts            # port 3000, container start otomatis
 *   AEE_PORT=8080 npx tsx scripts/serve.ts
 *
 * Env: DATABASE_URL (superuser), DATABASE_APP_URL (aee_app) — default menunjuk
 * container scratch aee-orch-pg (:55433). Bila localhost-forward WSL bermasalah,
 * otomatis fallback ke IP WSL.
 */
import "dotenv/config";
import { Pool } from "pg";
import { buildApp } from "@aee/api";
import { createAgents } from "@aee/agents";
import { PgBossQueue } from "@aee/orchestrator/runtime";
import { startWorker } from "../apps/worker/src/index.js";
import pgBossCtor from "pg-boss";

const PORT = Number(process.env.AEE_PORT ?? 3000);

// ── Pastikan container DB hidup ────────────────────────────────────────────
async function ensureDb(): Promise<void> {
  const { execFile } = await import("node:child_process");
  const run = (cmd: string, args: string[]) =>
    new Promise<string>((resolve) => {
      execFile(cmd, args, { timeout: 60_000 }, (_e, stdout) => resolve(String(stdout ?? "")));
    });
  // Named volume agar data selamat dari restart daemon/VM; bila daemon WSL
  // crash-loop (lingkungan hari ini), tunggu sampai sehat lalu lanjut.
  await run("wsl.exe", ["-e", "bash", "-c",
    `for try in $(seq 1 12); do
       docker start aee-orch-pg 2>/dev/null && break
       docker run -d --name aee-orch-pg --restart unless-stopped -v aee-orch-data:/var/lib/postgresql/data -e POSTGRES_PASSWORD=auditpass -e POSTGRES_DB=aee -p 0.0.0.0:55433:5432 postgres:16-alpine 2>/dev/null && break
       sleep 5
     done
     for i in $(seq 1 90); do docker exec aee-orch-pg pg_isready -U postgres -d aee >/dev/null 2>&1 && break; sleep 1; done`]);
  // Self-heal: daemon restart bisa menelan container lama → recreate dgn volume sama.
  await run("wsl.exe", ["-e", "bash", "-c",
    "docker inspect aee-orch-pg >/dev/null 2>&1 || docker run -d --name aee-orch-pg --restart unless-stopped -v aee-orch-data:/var/lib/postgresql/data -e POSTGRES_PASSWORD=auditpass -e POSTGRES_DB=aee -p 0.0.0.0:55433:5432 postgres:16-alpine; for i in $(seq 1 60); do docker exec aee-orch-pg pg_isready -U postgres -d aee >/dev/null 2>&1 && break; sleep 1; done"]);
}

async function resolveHost(): Promise<string> {
  const probe = async (url: string) => {
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 4000 });
    try { await pool.query("SELECT 1"); return true; }
    catch { return false; }
    finally { await pool.end().catch(() => {}); }
  };
  const { execFile } = await import("node:child_process");
  const ip = (await new Promise<string>((resolve) => {
    execFile("wsl.exe", ["-e", "bash", "-c", "hostname -I | awk '{print $1}'"],
      { timeout: 20_000 }, (_e, stdout) => resolve(String(stdout ?? "").replace(/[\0\r\n ]/g, "")));
  }));
  const candidates = [ip, "localhost"].filter(Boolean);
  for (const host of candidates) {
    const url = `postgres://postgres:auditpass@${host}:55433/aee`;
    if (await probe(url)) { console.log(`[serve] DB host: ${host}`); return host; }
  }
  throw new Error("DB tidak terjangkau di localhost maupun IP WSL — jalankan: wsl.exe -e bash -c 'docker start aee-orch-pg'");
}

await ensureDb();
let HOST = "";
for (let attempt = 1; attempt <= 30; attempt++) {
  try { HOST = await resolveHost(); break; }
  catch { console.log("[serve] DB belum siap (attempt " + attempt + "/30), retry 5s…"); await new Promise(r => setTimeout(r, 5000)); }
}
if (!HOST) { console.error("[serve] DB tidak terjangkau setelah 30 percobaan. Pastikan WSL + docker hidup."); process.exit(1); }
const ADMIN = `postgres://postgres:auditpass@${HOST}:55433/aee`;

// Self-heal schema: docker daemon crash-loop bisa membawa container baru tanpa
// data → migrate idempoten (checksum sama = skip) + aktifkan login aee_app.
{
  const { execFile } = await import("node:child_process");
  const ex = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => new Promise<void>((resolve) => {
    execFile(cmd, args, { timeout: 120_000, cwd: process.cwd(), env: { ...process.env, ...env } }, () => resolve());
  });
  await ex("npx", ["tsx", "scripts/run-migrations.ts"], { DATABASE_URL: ADMIN });
  console.log("[serve] migrations OK (idempotent)");
  await ex("wsl.exe", ["-e", "bash", "-c",
    "docker exec aee-orch-pg psql -U postgres -d aee -c \"ALTER ROLE aee_app LOGIN PASSWORD 'auditpass'\""]);
}
const ADMIN_URL = ADMIN;
const APP_URL = `postgres://aee_app:auditpass@${HOST}:55433/aee`;

// ── Pool, API, worker — queue pg-boss dibagi keduanya ──────────────────────
const apiPool = new Pool({ connectionString: APP_URL, max: 8 });
apiPool.on("error", (err) => console.error("[apiPool] error (diabaikan):", err.message));
const boss = new pgBossCtor({ connectionString: ADMIN_URL }) as never;
const queue = new PgBossQueue(boss as never);
const _agents = createAgents();
console.log("[serve] agent mode:", _agents.mode, "·", _agents.modelLabel);
const deps = {
  strategic: _agents.strategic,
  execution: _agents.execution,
  queue,
};

const app = buildApp({ pool: apiPool, deps, webhookSecret: "whsec-demo" });
const worker = await startWorker({
  appUrl: APP_URL, adminUrl: ADMIN_URL, boss: boss as never,
  deps: deps as never, pollIntervalMs: 400,
  logger: (m) => { if (!/loop error/.test(m)) console.log("[worker]", m); },
});
await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(``);
console.log(`  ╔══════════════════════════════════════════════╗`);
console.log(`  ║  AEE — Economic Control Center               ║`);
console.log(`  ║  buka:  http://127.0.0.1:${PORT}                    ║`);
console.log(`  ║  stop :  Ctrl+C                              ║`);
console.log(`  ╚══════════════════════════════════════════════╝`);
console.log(``);

// Tangani error pg yang tidak tertangkap (daemon docker restart → koneksi drop).
// Demo: proses tetap hidup, bukan crash.
process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (/terminating|ECONNREFUSED|ECONNRESET|57P01/.test(msg)) {
    console.error("[uncaught] pg connection drop (diabaikan):", msg);
  } else {
    console.error("[uncaught]", err);
    process.exit(1);
  }
});
process.on("unhandledRejection", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (/terminating|ECONNREFUSED|ECONNRESET|57P01/.test(msg)) {
    console.error("[unhandled] pg connection drop (diabaikan):", msg);
  } else {
    console.error("[unhandled]", err);
    process.exit(1);
  }
});

async function shutdown(): Promise<void> {
  console.log("\\n[serve] shutting down…");
  try { await worker.stop(); } catch { /* ignore */ }
  try { await app.close(); } catch { /* ignore */ }
  try { await apiPool.end(); } catch { /* ignore */ }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
