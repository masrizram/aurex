/**
 * TEMP runtime smoke Admin Control Center vs PG scratch (55433) — dihapus setelah run.
 * Alur: signup A → promote is_admin (owner SQL) → tembak endpoint admin via HTTP
 * cookie → verifikasi enkripsi API key provider di DB → 403 utk non-admin →
 * audit_logs terisi → cleanup fixture (FK-safe).
 */
import { Pool } from "pg";
import { buildApp } from "@aee/api";
import { MockStrategicAgent, MockExecutionAgent } from "@aee/agents";
import { InMemoryQueue } from "@aee/orchestrator/runtime";

const ownerUrl = process.env.DATABASE_URL ?? "";
const appUrl = process.env.DATABASE_APP_URL ?? "";
if (!ownerUrl || !appUrl) throw new Error("DATABASE_URL & DATABASE_APP_URL wajib");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const ts = Date.now().toString(36);
const emailA = `admsmoke-a-${ts}@test.local`;
const emailB = `admsmoke-b-${ts}@test.local`;

const jar: Record<"a" | "b", string | null> = { a: null, b: null };
async function j(k: "a" | "b", path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(jar[k] ? { cookie: jar[k]! } : {}), ...(opts.headers || {}) },
    redirect: "manual",
  });
  const sc = res.headers.get("set-cookie");
  if (sc) jar[k] = sc.split(";")[0] ?? null;
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const appPool = new Pool({ connectionString: appUrl, max: 5 });
const app = buildApp({
  pool: appPool,
  deps: { strategic: new MockStrategicAgent(), execution: new MockExecutionAgent(), queue: new InMemoryQueue() },
  webhookSecret: "whsec-admsmoke",
});
let BASE = "";

async function cleanup(): Promise<void> {
  const ids = await owner.query<{ id: string }>(`SELECT id FROM users WHERE email IN ($1,$2)`, [emailA, emailB]);
  const uids = ids.rows.map((r) => r.id);
  if (uids.length === 0) return;
  // audit_logs append-only + user_id TANPA FK → biarkan baris audit tetap utuh
  // (bukti mutasi admin tidak boleh terhapus); cleanup hanya data fixtur.
  for (const uid of uids) {
    await owner.query(`DELETE FROM sessions WHERE user_id=$1`, [uid]);
    const orgs = await owner.query<{ organization_id: string }>(`SELECT organization_id FROM memberships WHERE user_id=$1`, [uid]);
    await owner.query(`DELETE FROM memberships WHERE user_id=$1`, [uid]);
    for (const o of orgs.rows) {
      const left = await owner.query<{ n: string }>(`SELECT count(*)::text n FROM memberships WHERE organization_id=$1`, [o.organization_id]);
      if (left.rows[0]?.n === "0") await owner.query(`DELETE FROM organizations WHERE id=$1 AND plan_tier<>'ENTERPRISE'`, [o.organization_id]);
    }
    await owner.query(`DELETE FROM users WHERE id=$1`, [uid]);
  }
  await owner.query(`DELETE FROM ai_providers WHERE name LIKE 'Smoke Provider %'`);
}

(async () => {
  console.log("═══ ADMIN RUNTIME SMOKE (live scratch DB) ═══");
  await app.listen({ port: 0, host: "127.0.0.1" });
  BASE = `http://127.0.0.1:${app.addresses()[0]!.port}`;

  try {
    // ── signup A & B ──
    const suA = await j("a", "/auth/signup", { method: "POST", body: JSON.stringify({ email: emailA, password: "Smoke#2026!", name: "Smoke A", org_name: "Smoke Org" }) });
    ok("signup A", suA.status === 200 && !!suA.body?.user?.id, `status=${suA.status}`);
    const suB = await j("b", "/auth/signup", { method: "POST", body: JSON.stringify({ email: emailB, password: "Smoke#2026!", name: "Smoke B" }) });
    ok("signup B (tanpa org)", suB.status === 200 && !!suB.body?.user?.id, `status=${suB.status}`);

    // ── promote A via owner SQL (jalur yang dulu gagal lewat PATCH prod) ──
    const pr = await owner.query<{ id: string }>(`UPDATE users SET is_admin=true WHERE email=$1 RETURNING id`, [emailA]);
    const uidA = pr.rows[0]?.id;
    ok("promote is_admin (owner)", !!uidA);
    if (!uidA) throw new Error("fixture A hilang");

    // ── guard: sebelum promote, B harus 403 ──
    const f403pre = await j("b", "/admin/overview");
    ok("non-admin GET /admin/overview → 403", f403pre.status === 403, `got=${f403pre.status}`);

    // ── overview ──
    const ov = await j("a", "/admin/overview");
    ok("GET /admin/overview → 200 + counts", ov.status === 200 && typeof ov.body?.users === "number" && typeof ov.body?.orgs === "number", `users=${ov.body?.users} orgs=${ov.body?.orgs} providers=${ov.body?.providers}`);

    // ── PATCH user (akar masalah prod: grant UPDATE users) ──
    const pa = await j("a", `/admin/users/${uidA}`, { method: "PATCH", body: JSON.stringify({ name: "Smoke A Edited" }) });
    ok("PATCH /admin/users/:id → 200", pa.status === 200 && pa.body?.user?.name === "Smoke A Edited", `status=${pa.status} err=${JSON.stringify(pa.body).slice(0, 120)}`);

    // ── lifecycle suspend/activate (target: user lain, bukan diri sendiri) ──
    const uidB = (await owner.query<{ id: string }>(`SELECT id FROM users WHERE email=$1`, [emailB])).rows[0]?.id;
    if (!uidB) throw new Error("fixture B hilang");
    const su = await j("a", `/admin/users/${uidB}/suspend`, { method: "POST", body: "{}" });
    ok("POST suspend → SUSPENDED", su.status === 200 && su.body?.user?.status === "SUSPENDED", `status=${su.status} got=${su.body?.user?.status} err=${JSON.stringify(su.body).slice(0, 100)}`);
    const ac = await j("a", `/admin/users/${uidB}/activate`, { method: "POST", body: "{}" });
    ok("POST activate → ACTIVE", ac.status === 200 && ac.body?.user?.status === "ACTIVE", `got=${ac.body?.user?.status}`);

    // ── AI provider: create terenkripsi ──
    const pc = await j("a", "/admin/providers", {
      method: "POST",
      body: JSON.stringify({ name: `Smoke Provider ${ts}`, base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", role: "STRATEGIC", api_key: "sk-smoke-secret-123" }),
    });
    const pid = pc.body?.provider?.id as string | undefined;
    ok("POST /admin/providers → 201", pc.status === 201 && !!pid, `status=${pc.status} err=${JSON.stringify(pc.body).slice(0, 160)}`);

    const pl = await j("a", "/admin/providers?role=STRATEGIC");
    const listed = Array.isArray(pl.body?.providers) ? pl.body.providers.find((p: any) => p.id === pid) : undefined;
    ok("GET providers list memuat provider", !!listed, listed ? `key_preview=${listed.api_key_preview}` : "");
    ok("API key TIDAK pernah plaintext di respons", !JSON.stringify(pl.body).includes("sk-smoke-secret-123"));

    const dbRow = pid
      ? (await owner.query<{ cipher: string; hash: string }>(`SELECT encode(api_key_cipher,'escape') AS cipher, api_key_hash AS hash FROM ai_providers WHERE id=$1`, [pid])).rows[0]
      : undefined;
    ok("DB simpan ciphertext (bukan plaintext)", !!dbRow && !dbRow.cipher.includes("sk-smoke-secret-123") && dbRow.hash !== "sk-smoke-secret-123");

    // ── test connection live (invalid key → ok=false terstruktur, bukan 500) ──
    if (pid) {
      const pt = await j("a", `/admin/providers/${pid}/test-connection`, { method: "POST", body: "{}" });
      ok("POST providers/:id/test-connection terstruktur", pt.status === 200 && typeof pt.body?.ok === "boolean", `ok=${pt.body?.ok} msg=${String(pt.body?.message ?? "").slice(0, 80)}`);
      const pd = await j("a", `/admin/providers/${pid}`, { method: "DELETE" });
      ok("DELETE provider → 200/204", pd.status === 200 || pd.status === 204, `got=${pd.status}`);
    }

    // ── objectives raw-state ditolak ──
    const badObj = await j("a", "/admin/objectives/00000000-0000-0000-0000-000000000000", { method: "PATCH", body: JSON.stringify({ state: "ACHIEVED" }) });
    ok("PATCH objectives state mentah → 400/422", badObj.status === 400 || badObj.status === 422, `got=${badObj.status}`);

    // ── audit log mencatat mutasi ──
    const al = await j("a", "/admin/audit?action=users.update&limit=10");
    ok("GET /admin/audit ada users.update", al.status === 200 && (al.body?.audit?.length ?? 0) >= 1, `rows=${al.body?.audit?.length} err=${JSON.stringify(al.body).slice(0, 100)}`);
    const alDb = await owner.query<{ n: string }>(
      `SELECT count(*)::text n FROM audit_logs WHERE action='users.update' AND user_id=$1`, [uidA]);
    ok("audit_logs baris nyata di DB", alDb.rows[0]?.n !== "0", `n=${alDb.rows[0]?.n}`);

    // ── system health ──
    const sh = await j("a", "/admin/system");
    ok("GET /admin/system → 200", sh.status === 200 && !!sh.body?.queue, `keys=${Object.keys(sh.body ?? {}).join(",")}`);
  } finally {
    await cleanup().catch((e) => console.error("cleanup error:", (e as Error).message));
    await owner.end();
    await app.close();
  }

  console.log(`\n═══ ADMIN SMOKE: ${pass} PASS, ${fail} FAIL ═══`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error("SMOKE CRASHED:", e);
  await cleanup().catch(() => {});
  await owner.end().catch(() => {});
  process.exit(1);
});
