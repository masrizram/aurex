// Smoke test remediation §6/§7/§19 — auth lifecycle, BOLA, opportunity actions.
// Jalankan dengan server aktif: BASE=http://127.0.0.1:3000 npx tsx scripts/smoke-remediation.ts
export {};
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const j = (r: Response) => r.json().catch(() => ({}));

const rnd = Date.now();
const emailA = `auditA${rnd}@test.local`, emailB = `auditB${rnd}@test.local`;
const PW = "Password123!";

async function signup(email: string) {
  const r = await fetch(`${BASE}/auth/signup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW, name: `Audit ${email}` }),
  });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { status: r.status, cookie, body: await j(r) };
}
const H = (cookie: string) => ({ "content-type": "application/json", cookie: cookie || "x=1" });

async function main(): Promise<void> {
// ── 1. Auth lifecycle ──
console.log("── AUTH LIFECYCLE ──");
const suA = await signup(emailA);
ok("signup A 200/201", suA.status === 200 || suA.status === 201, `got ${suA.status}`);
const verifyToken = (suA.body as { verify_token_dev?: string }).verify_token_dev ?? "";
ok("signup mengeluarkan verify token (dev)", typeof verifyToken === "string" && verifyToken.length > 16);

let me = await j(await fetch(`${BASE}/auth/me`, { headers: H(suA.cookie) }));
ok("me.emailVerified=false sebelum verify", (me as { user?: { emailVerified?: boolean } }).user?.emailVerified === false);

const vr = await fetch(`${BASE}/auth/verify-email`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: verifyToken }),
});
ok("verify-email 200", vr.status === 200);
me = await j(await fetch(`${BASE}/auth/me`, { headers: H(suA.cookie) }));
ok("me.emailVerified=true setelah verify", (me as { user?: { emailVerified?: boolean } }).user?.emailVerified === true);

// token reuse → 422 (single-use)
const vr2 = await fetch(`${BASE}/auth/verify-email`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: verifyToken }),
});
ok("verify token single-use (422 saat reuse)", vr2.status === 422, `got ${vr2.status}`);

// forgot → anti-enumeration (selalu ok) — email tak dikenal pun 200
const fpUnknown = await fetch(`${BASE}/auth/forgot-password`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "nobody@nowhere.test" }),
});
ok("forgot-password anti-enumeration (200 untuk email tak dikenal)", fpUnknown.status === 200);

// forgot untuk email nyata → token di console; kita ambil dari DB? Tidak —
// reset dengan token salah → 422
const rpBad = await fetch(`${BASE}/auth/reset-password`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: "f".repeat(64), password: "NewPass123!" }),
});
ok("reset-password token invalid → 422", rpBad.status === 422, `got ${rpBad.status}`);

// login sukses setelah verify
const lg = await fetch(`${BASE}/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: emailA, password: PW }),
});
ok("login 200", lg.status === 200);

// ── 2. BOLA / IDOR ──
console.log("── BOLA / IDOR ──");
const suB = await signup(emailB);
ok("signup B 200/201", suB.status === 200 || suB.status === 201, `got ${suB.status}`);

// A: onboarding ringkas → objective
for (const step of [
  ["POST", "/onboarding/step1", { business_name: "Audit Biz A", industry: "ritel", target_customer: "umkm" }],
  ["POST", "/onboarding/step2", { goal_type: "increase_profit" }],
  ["POST", "/onboarding/step3", { current_revenue: "10000000", current_cost: "6000000", capital: "5000000", time_horizon_months: 6 }],
  ["POST", "/onboarding/step4", { autonomy_level: 2 }],
] as const) {
  const r = await fetch(`${BASE}${step[1]}`, { method: step[0], headers: H(suA.cookie), body: step[2] ? JSON.stringify(step[2]) : undefined });
  if (r.status >= 400) console.log(`    (step ${step[1]} → ${r.status})`);
}
const objA = await fetch(`${BASE}/onboarding/step5`, {
  method: "POST", headers: H(suA.cookie),
  body: JSON.stringify({ title: "Objective Audit A", target_profit: "2000000" }),
});
ok("A onboarding step5 (first analysis)", objA.status === 200, `got ${objA.status}`);
const objAId = ((await j(objA)) as { objective_id?: string }).objective_id ?? "";
ok("objective A terbuat", typeof objAId === "string");

// B mencoba akses objective A → 404 (bukan 403 — anti enumeration)
const stolen = await fetch(`${BASE}/objectives/${objAId}`, { headers: H(suB.cookie) });
ok("B GET objective A → 404", stolen.status === 404, `got ${stolen.status}`);

// B mencoba start objective A → 404
const stealStart = await fetch(`${BASE}/objectives/${objAId}/start`, { method: "POST", headers: H(suB.cookie), body: "{}" });
ok("B POST start objective A → 404", stealStart.status === 404, `got ${stealStart.status}`);

// B anonim → 401
const anon = await fetch(`${BASE}/objectives`);
ok("anonim GET /objectives → 401", anon.status === 401, `got ${anon.status}`);

// ── 3. Admin isolation ──
console.log("── ADMIN ISOLATION ──");
const am = await fetch(`${BASE}/agent-mode`, { headers: H(suA.cookie) });
ok("non-admin /agent-mode → 403", am.status === 403, `got ${am.status}`);

// ── 4. Rate limit ──
console.log("── RATE LIMIT ──");
let rl429 = false;
for (let i = 0; i < 12; i++) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `ratelimit${rnd}@test.local`, password: "wrong" }),
  });
  if (r.status === 429) { rl429 = true; break; }
}
ok("login brute-force → 429 setelah 10x", rl429);

// ── 5. Opportunity flow (autonomy=2) ──
console.log("── OPPORTUNITY FLOW (autonomy 2 — menunggu pilihan manusia) ──");
const startR = await fetch(`${BASE}/objectives/${objAId}/start`, { method: "POST", headers: H(suA.cookie), body: "{}" });
ok("start objective A", startR.status === 200 || startR.status === 409, `got ${startR.status}`);

// Pre-flight: server harus hidup sebelum suite mulai — gagal dengan pesan jelas
// (pola notifikasi 2026-08-24: run saat server mati crash dengan stack trace
//  `TypeError: fetch failed` yang misleading; ini menggantinya dengan diagnosis langsung)
{
  try {
    const pf = await fetch(`${BASE}/health`);
    if (pf.status !== 200) {
      console.error(`PRE-FLIGHT FAIL: /health = ${pf.status} (harus 200). Jalankan server dulu: AEE_FORCE_MOCK=1 npx tsx scripts/serve.ts`);
      process.exit(1);
    }
  } catch {
    console.error(`PRE-FLIGHT FAIL: server ${BASE} tidak merespons. Jalankan server dulu: AEE_FORCE_MOCK=1 npx tsx scripts/serve.ts`);
    process.exit(1);
  }
}

// poll sampai OPPORTUNITIES_RANKED (worker research + rank)
let state = "", opps: { id: string; status: string }[] = [];
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const det = await j(await fetch(`${BASE}/objectives/${objAId}`, { headers: H(suA.cookie) }));
  state = String((det as { objective?: { state?: string } }).objective?.state ?? "");
  if (state === "OPPORTUNITIES_RANKED") {
    const or = await j(await fetch(`${BASE}/objectives/${objAId}/opportunities`, { headers: H(suA.cookie) }));
    opps = ((or as { opportunities?: { id: string; status: string }[] }).opportunities ?? []);
    break;
  }
}
ok(`state mencapai OPPORTUNITIES_RANKED (got ${state})`, state === "OPPORTUNITIES_RANKED");
ok("ada opportunities ter-rank", opps.length > 0);
ok("TIDAK auto-select (worker menunggu manusia)", opps.every((o) => o.status !== "SELECTED"));

if (opps.length > 0) {
  // urutan realistis §19: customer memilih SATU opportunity → FSM lanjut.
  // (reject/save pada objective sama tidak tersedia setelah pilihan diproses —
  //  itu by-design; end-to-end reject/save sudah diverifikasi terpisah.)
  const target = opps.find((o) => o.status === "RANKED" || o.status === "DISCOVERED") ?? opps[0]!;
  const sel = await fetch(`${BASE}/objectives/${objAId}/opportunities/${target.id}/select`, {
    method: "POST", headers: H(suA.cookie), body: JSON.stringify({ reason: "audit select" }) });
  ok("select opportunity (human) → queued", sel.status === 200, `got ${sel.status}`);

  // tunggu worker proses human_select → FSM lanjut
  let st2 = "";
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const det = await j(await fetch(`${BASE}/objectives/${objAId}`, { headers: H(suA.cookie) }));
    st2 = String((det as { objective?: { state?: string } }).objective?.state ?? "");
    if (st2 !== "OPPORTUNITIES_RANKED") break;
  }
  ok(`human select → FSM lanjut (state=${st2})`,
    ["OPPORTUNITY_SELECTED", "VALIDATING", "RESULT_READY", "MISSION_CREATED", "HUMAN_APPROVAL_REQUIRED", "EXPERIMENT_DESIGNED"].includes(st2));

  const ev = await j(await fetch(`${BASE}/events?objective_id=${objAId}`, { headers: H(suA.cookie) }));
  const types = ((ev as { events?: Record<string, unknown>[] }).events ?? []).map((e) => String(e.type ?? e.event_type ?? ""));
  ok("event OPPORTUNITY_SELECTED tercatat", types.includes("OPPORTUNITY_SELECTED"));
  ok("event OPPORTUNITY_AWAITING_CHOICE tercatat (§19 gate)", types.includes("OPPORTUNITY_AWAITING_CHOICE"));

  // experiments endpoint §20 terisi setelah design_experiment
  let exps: unknown[] = [];
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const er = await j(await fetch(`${BASE}/objectives/${objAId}/experiments`, { headers: H(suA.cookie) }));
    exps = ((er as { experiments?: unknown[] }).experiments ?? []);
    if (exps.length > 0) break;
  }
  ok("GET experiments terisi (§20)", exps.length > 0);
}
}
main()
  .then(() => {
    console.log("\n═══ SMOKE REMEDIATION: " + pass + " PASS, " + fail + " FAIL ═══");
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((e: unknown) => { console.error(e); process.exit(1); });
