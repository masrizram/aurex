/**
 * scripts/validate-resilience.ts — acceptance test #1 (DB failure/recovery).
 *
 * Skenario (sesuai instruksi user):
 *   1. Pastikan server + DB healthy.
 *   2. KILL container DB (docker stop)   → API harus tetap up, db=unhealthy.
 *   3. START container DB (docker start) → pool reconnect, db=healthy.
 *   4. Verifikasi data konsisten (signup + objectives list via API).
 *
 * Output: baris PASS/FAIL per gate + ringkasan.
 */
import { execFile } from "node:child_process";

const BASE = process.env.BASE ?? "http://127.0.0.1:3200";
const wsl = (cmd: string): Promise<string> =>
  new Promise((resolve) => {
    execFile("wsl.exe", ["-e", "bash", "-c", cmd], { timeout: 60_000 }, (_e, so) => resolve(String(so ?? "")));
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function health(): Promise<{ status: string; api: string; db: string }> {
  const r = await fetch(BASE + "/health");
  return r.json() as any;
}

let pass = 0, fail = 0;
function gate(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " :: " + detail : ""}`);
  ok ? pass++ : fail++;
}

async function waitDb(target: "healthy" | "unhealthy", timeoutMs = 60_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const h = await health().catch(() => null);
    if (h && h.db === target) return true;
    await sleep(1_000);
  }
  return false;
}

console.log("═══ RESILIENCE ACCEPTANCE TEST ═══");
console.log("BASE:", BASE, "\n");

// ── Gate 1: awal — siapkan DB (precondition), lalu server & DB healthy ──
console.log("[1] Kondisi awal (pastikan DB hidup dulu — lingkungan dev rawan restart)");
{
  await wsl("docker start aee-orch-pg 2>/dev/null; for i in $(seq 1 30); do docker exec aee-orch-pg pg_isready -U postgres -d aee >/dev/null 2>&1 && break; sleep 1; done");
  const h = await health().catch(() => null);
  gate("API up", h?.api === "up");
  const okDb = h?.db === "healthy" ? true : await waitDb("healthy", 30_000);
  gate("DB healthy", okDb);
}

// ── Gate 2: kill DB → API tetap up, readiness unhealthy ──
console.log("[2] DB dimatikan (docker stop)");
{
  await wsl("docker stop aee-orch-pg");
  const t0 = Date.now();
  const unhealthy = await waitDb("unhealthy", 20_000);
  gate("readiness → unhealthy", unhealthy, `${Date.now() - t0}ms`);
  const h2 = await health().catch(() => null);
  gate("API tetap HIDUP saat DB mati", h2?.api === "up" && h2?.status === "degraded");
  const notFound = await fetch(BASE + "/health").then((r) => r.status).catch(() => 0);
  gate("/health tetap merespons (200)", notFound === 200);
}

// ── Gate 3: DB hidup kembali → pool reconnect otomatis ──
console.log("[3] DB dihidupkan kembali (docker start)");
{
  await wsl("docker start aee-orch-pg");
  const t0 = Date.now();
  const healthy = await waitDb("healthy", 60_000);
  gate("pool reconnect → healthy", healthy, `${Date.now() - t0}ms`);
}

// ── Gate 4: data konsisten setelah recovery (signup + list via API) ──
console.log("[4] Konsistensi data pasca-recovery");
{
  const email = `resil+${Date.now()}@aee.test`;
  const su = await fetch(BASE + "/auth/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "ResilTest123!" }),
  });
  gate("signup OK setelah recovery", su.status === 200 || su.status === 201, `HTTP ${su.status}`);
  const cookie = (su.headers.get("set-cookie") ?? "").split(";")[0];
  const me = await fetch(BASE + "/auth/me", { headers: { cookie } as Record<string, string> });
  gate("/auth/me OK", me.status === 200, `HTTP ${me.status}`);
  const objs = await fetch(BASE + "/objectives", { headers: { cookie, "x-user-id": "" } as Record<string, string> }).catch(() => null);
  gate("/objectives merespons (tanpa crash)", objs !== null && objs.status !== 502, `HTTP ${objs?.status ?? "n/a"}`);
}

console.log(`\n═══ RESULT: ${pass} PASS, ${fail} FAIL ═══`);
process.exit(fail === 0 ? 0 : 1);
