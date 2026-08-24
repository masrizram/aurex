/**
 * Reproduksi bug wizard onboarding user (2026-08-24): capital = 0.
 * Flow: signup → verify → login → step1..step5 dengan capital "0" (default UI).
 * Sebelum fix 009: step5 → 500 "objectives_capital_approved_check" (error Postgres mentah).
 * Sesudah fix: step5 → 200, objective terbuat, research dimulai.
 * Jalankan dengan server MOCK lokal hidup (port 3000).
 */
const BASE = "http://127.0.0.1:3000";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  const mark = cond ? "✓" : "✗";
  if (cond) pass++; else fail++;
  console.log(`  ${mark} ${name}${detail ? ` (${detail})` : ""}`);
}
const j = async (r: Response) => ({ status: r.status, body: await r.json() as Record<string, unknown> });
const H = (cookie?: string) => ({ "content-type": "application/json", ...(cookie ? { cookie } : {}) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`══ REPRO WIZARD capital=0 — ${new Date().toISOString()} ══`);

  // 0. Pre-flight server
  try {
    const h = await fetch(`${BASE}/health`);
    if (!h.ok) throw new Error(String(h.status));
  } catch {
    console.error("PRE-FLIGHT FAIL: server tidak merespons. Jalankan: AEE_FORCE_MOCK=1 npx tsx scripts/serve.ts");
    process.exit(1);
  }

  const email = `wizard${Date.now().toString(36)}@aurex.test`;
  const password = "Wizard!Passw0rd";

  // 1. Signup + session
  const su = await j(await fetch(`${BASE}/auth/signup`, { method: "POST", headers: H(), body: JSON.stringify({ email, password }) }));
  ok("signup 200/201", su.status === 200 || su.status === 201, `got ${su.status}`);
  const cookie = (su.body.session_cookie as string) ?? ((su.body as { set_cookie?: string }).set_cookie);
  const cookieHdr = cookie ? `aee_session=${cookie}` : "";
  // fallback: ambil dari header set-cookie
  let sessionCookie = "";
  {
    const r = await fetch(`${BASE}/auth/signup`, { method: "POST", headers: H(), body: JSON.stringify({ email: "x" + email, password }) });
    const sc = r.headers.get("set-cookie");
    if (sc) sessionCookie = sc.split(";")[0] ?? "";
  }
  const auth = sessionCookie || cookieHdr;
  ok("session cookie ada", Boolean(auth), auth ? auth.slice(0, 24) + "…" : "tidak ada");

  // verify email via dev-field
  const token = (su.body as { verify_token_dev?: string }).verify_token_dev;
  if (token) {
    const v = await j(await fetch(`${BASE}/auth/verify-email`, { method: "POST", headers: H(), body: JSON.stringify({ token }) }));
    ok("verify-email 200", v.status === 200, `got ${v.status}`);
  } else {
    ok("verify token (dev) tersedia", false, "prod tidak mengirim — jalankan di dev/MOCK");
  }

  // 2. Login
  const li = await fetch(`${BASE}/auth/login`, { method: "POST", headers: H(), body: JSON.stringify({ email, password }) });
  const sc = li.headers.get("set-cookie");
  const loginCookie = sc ? sc.split(";")[0] ?? "" : "";
  ok("login 200", li.status === 200, `got ${li.status}`);

  // 3. WIZARD FLOW — persis seperti UI user
  console.log("\n── WIZARD (Organization → Business → Baseline capital=0 → Goal → Exec) ──");
  const s1 = await j(await fetch(`${BASE}/onboarding/step1`, { method: "POST", headers: H(loginCookie), body: JSON.stringify({ business_name: "Warung Kopi Subur", industry: "F&B", target_customer: "Pekerja kantoran" }) }));
  ok("step1 Business 200/201", s1.status === 200 || s1.status === 201, `got ${s1.status}`);

  // step2 UI menunggu goal_type — tapi UI memilih goal SETELAH baseline (step index 3). API: step2 = goal_type.
  const s3 = await j(await fetch(`${BASE}/onboarding/step3`, { method: "POST", headers: H(loginCookie), body: JSON.stringify({ current_revenue: "0", current_cost: "0", capital: "0", time_horizon_months: 6 }) }));
  ok("step3 Baseline (capital=0) 200/201", s3.status === 200 || s3.status === 201, `got ${s3.status}`);

  const s2 = await j(await fetch(`${BASE}/onboarding/step2`, { method: "POST", headers: H(loginCookie), body: JSON.stringify({ goal_type: "increase_profit" }) }));
  ok("step2 Goal 200/201", s2.status === 200 || s2.status === 201, `got ${s2.status}`);
  const s4 = await j(await fetch(`${BASE}/onboarding/step4`, { method: "POST", headers: H(loginCookie), body: JSON.stringify({ autonomy_level: 2 }) }));
  ok("step4 Exec 200/201", s4.status === 200 || s4.status === 201, `got ${s4.status}`);

  // 4. STEP 5 — titik error user ("Mulai Analisis")
  const s5 = await j(await fetch(`${BASE}/onboarding/step5`, { method: "POST", headers: H(loginCookie), body: JSON.stringify({ title: "increase profit — Warung Kopi Subur", target_profit: "5000000.00" }) }));
  const bugGone = s5.status === 200 || s5.status === 201;
  ok("STEP 5 'Mulai Analisis' → 200/201 (BUG FIX)", bugGone, `got ${s5.status}${bugGone ? "" : " — " + JSON.stringify(s5.body).slice(0, 140)}`);
  if (bugGone) {
    const objId = s5.body.objective_id as string | undefined;
    ok("objective terbuat", Boolean(objId), objId?.slice(0, 8) ?? "-");
    // journey-prod parity: start objective → RESEARCHING → research job
    const st0 = await fetch(`${BASE}/objectives/${objId}/start`, { method: "POST", headers: H(loginCookie) });
    ok("start objective → 200", st0.status === 200, `got ${st0.status}`);
    await st0.json().catch(() => ({}));
    // poll sampai opps benar-benar siap (RESEARCHING → OPPORTUNITIES_RANKED)
    for (let i = 0; i < 30; i++) {
      const st = await j(await fetch(`${BASE}/objectives/${objId}`, { headers: H(loginCookie) }));
      const state = String(((st.body as { objective?: { state?: string } }).objective?.state) ?? "");
      if (state === "OPPORTUNITIES_RANKED" || state === "HUMAN_APPROVAL_REQUIRED" || state === "OPPORTUNITY_SELECTED") { ok("FSM mencapai opps ready", true, state); break; }
      if (i === 29) ok("FSM mencapai opps ready", false, `timeout state=${state}`);
      await sleep(2_000);
    }
  }

  console.log(`\n═══ WIZARD REPRO: ${pass} PASS, ${fail} FAIL ═══`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
