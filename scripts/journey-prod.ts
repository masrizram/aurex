/**
 * JOURNEY TEST PRODUCTION Lengkap — homepage → register → verify → login → dashboard → core FSM.
 * Target: aurex-api.fly.dev (prod). Core loop memakai agent REAL (research 3.5–8 menit) —
 * durasi total run ~10–15 menit.
 *
 * Verify-email di prod: link dicetak ke log container → diambil via `flyctl logs`.
 * Jalankan dari direktori repo (butuh flyctl auth): npx tsx scripts/journey-prod.ts
 */
const BASE = process.env.JOURNEY_BASE ?? "https://aurex-api.fly.dev";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  const s = cond ? "✓" : "✗";
  console.log(`  ${s} ${name}${detail ? ` (${detail})` : "0/0" === detail ? "" : ` (${detail})`}`);
  cond ? pass++ : fail++;
}
const j = (r: Response) => r.json().catch(() => ({}));
const now = () => new Date().toISOString().slice(11, 19);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function flyLogs(): Promise<string> {
  // flyctl logs -a aurex-api (last N lines; --no-tail agar keluar langsung)
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile("flyctl", ["logs", "-a", "aurex-api", "--no-tail"], { timeout: 45_000, maxBuffer: 8 * 1024 * 4 },
      (err: Error | null, stdout: string | null, _stderr: string | null) => resolve(err ? "" : String(stdout ?? "")));
  });
}

async function main(): Promise<void> {
  const ts = Date.now().toString(36);
  const email = `journey${ts}@aurex.test`;
  const password = `Journey#2026!${ts}`;
  const cookieOf = (r: Response): string =>
    (r.headers.get("set-cookie") ?? "").split(";")[0] || "";
  const H = (cookie: string) => ({ "content-type": "application/json", cookie });

  console.log(`══ JOURNEY PROD ${BASE} — ${new Date().toISOString()} ══`);
  console.log(`user: ${email}`);

  // ── 1. HOMEPAGE ──
  console.log("\n── 1. HOMEPAGE (landing publik) ──");
  const home = await fetch(`${BASE}/`);
  ok("GET / → 200", home.status === 200, `got ${home.status}`);
  const homeHtml = await home.text();
  ok("title landing AEE", /AI-Powered Economic Intelligence/.test(homeHtml), homeHtml.match(/<title>[^<]*<\/title>/)?.[0] ?? "?");
  ok("landing bebas KIMI/GLM", !/KIMI|GLM|streamlake/.test(homeHtml));
  ok("landing punya CTA ke /app", /href="\/app"/.test(homeHtml));
  ok("landing punya anchor pricing", homeHtml.includes('id="pricing"'));
  const appPage = await fetch(`${BASE}/app`);
  ok("GET /app → 200 (SPA)", appPage.status === 200);

  // ── 2. REGISTER ──
  console.log("\n── 2. REGISTER ──");
  const su = await fetch(`${BASE}/auth/signup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: "Journey Tester" }),
  });
  ok("signup → 200/201", su.status === 200 || su.status === 201, `got ${su.status}`);
  const suJ = (await j(su)) as { verify_token_dev?: string };
  const suCookie = cookieOf(su);
  ok("set-cookie session (HttpOnly)", suCookie.startsWith("aee_session="));
  const me = (await j(await fetch(`${BASE}/auth/me`, { headers: H(suCookie) }))) as { user?: { emailVerified?: boolean } };
  ok("me.emailVerified=false sebelum verify", me?.user?.emailVerified === false);

  // ── 3. VERIFY (dari log Fly) ──
  console.log("\n── 3. VERIFY EMAIL (token dari log container) ──");
  let token = suJ.verify_token_dev ?? "";
  // di prod NODE_ENV=production → verify_token_dev tidak dikirim; ambil dari log container
  for (let i = 0; i < 6 && !token; i++) {
    await sleep(8_000);
    const logs = await flyLogs();
    const m = logs.match(new RegExp(`Email verification link for ${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: \\/auth\\/verify\\?token=([a-f0-9]{64})`));
    if (m?.[1]) token = m[1]!;
  }
  ok("verify token tersedia (dev-field ATAU flyctl logs)", Boolean(token), token ? `${token.slice(0, 8)}…` : "tidak ketemu");
  if (token) {
    const v = await fetch(`${BASE}/auth/verify-email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    ok("verify-email → 200", v.status === 200, `got ${v.status}`);
    const me2 = (await j(await fetch(`${BASE}/auth/me`, { headers: H(suCookie) }))) as { user?: { emailVerified?: boolean } };
    ok("me.emailVerified=true setelah verify", me2?.user?.emailVerified === true);
    const v2 = await fetch(`${BASE}/auth/verify-email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    ok("verify token single-use (422 reuse)", v2.status === 422, `got ${v2.status}`);
  }

  // ── 4. LOGIN ──
  console.log("\n── 4. LOGIN ──");
  const badLogin = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
  ok("login salah → 401", badLogin.status === 401, `got ${badLogin.status}`);

  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  ok("login benar → 200", login.status === 200, `got ${login.status}`);
  const lgCookie = cookieOf(login);
  ok("login set-cookie session baru", lgCookie.startsWith("aee_session="));
  const meL = (await j(await fetch(`${BASE}/auth/me`, { headers: H(lgCookie) }))) as { user?: { email?: string; emailVerified?: boolean } };
  ok("session login valid (me.email)", meL?.user?.email === email, JSON.stringify(meL?.user?.email));
  const logout = await fetch(`${BASE}/auth/logout`, { method: "POST", headers: H(lgCookie) });
  ok("logout → 200", logout.status === 200, `got ${logout.status}`);
  const meLogout = await fetch(`${BASE}/auth/me`, { headers: H(lgCookie) });
  ok("session mati setelah logout (401)", meLogout.status === 401, `got ${meLogout.status}`);

  // login ulang untuk melanjutkan journey
  const login2 = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = cookieOf(login2);
  ok("login ulang → 200", login2.status === 200);

  // ── 5. DASHBOARD ──
  console.log("\n── 5. DASHBOARD (SPA + data) ──");
  const spa = await fetch(`${BASE}/app`);
  ok("SPA /app 200", spa.status === 200);
  const objectives = await j(await fetch(`${BASE}/objectives`, { headers: H(cookie) }));
  ok("GET /objectives → list (data dashboard)", Array.isArray((objectives as { objectives?: unknown[] }).objectives), `count=${((objectives as { objectives?: unknown[] }).objectives ?? []).length}`);
  const billing = await j(await fetch(`${BASE}/billing/plan`, { headers: H(cookie) }));
  ok("GET /billing/plan → data plan", billing != null && typeof billing === "object", JSON.stringify(billing).slice(0, 80));
  const onbStatus = await j(await fetch(`${BASE}/onboarding/status`, { headers: H(cookie) }));
  ok("GET /onboarding/status", onbStatus != null && typeof onbStatus === "object", JSON.stringify(onbStatus).slice(0, 80));

  // ── 6. CORE: onboarding → objective → start → research REAL → select → experiment → mission approval ──
  console.log("\n── 6. CORE FSM (agent REAL — mulai " + now() + ") ──");
  for (const [step, body] of [
    ["step1", { business_name: `Journey Biz ${ts}`, industry: "ritel", target_customer: "umkm" }],
    ["step2", { goal_type: "increase_profit" }],
    ["step3", { current_revenue: "12000000", current_cost: "7000000", capital: "5000000", time_horizon_months: 6 }],
    ["step4", { autonomy_level: 2 }],
  ] as const) {
    const r = await fetch(`${BASE}/onboarding/${step}`, {
      method: "POST", headers: H(cookie), body: JSON.stringify(body),
    });
    ok(`onboarding ${step} → 200/201`, r.status === 200 || r.status === 201, `got ${r.status}`);
  }
  const step5 = await fetch(`${BASE}/onboarding/step5`, {
    method: "POST", headers: H(cookie),
    body: JSON.stringify({ title: "Journey Objective", target_profit: "3000000" }),
  });
  ok("onboarding step5 → 200/201", step5.status === 200 || step5.status === 201, `got ${step5.status}`);
  const step5J = (await j(step5)) as { objective?: { id?: string; state?: string }, objective_id?: string };
  const objId = step5J?.objective?.id ?? step5J?.objective_id;
  ok("objective terbuat (id ada)", Boolean(objId), objId ?? "null");

  if (!objId) {
    console.log("\n═══ JOURNEY PROD: " + pass + " PASS, " + fail + " FAIL ═══");
    return;
  }

  const start = await fetch(`${BASE}/objectives/${objId}/start`, { method: "POST", headers: H(cookie), body: "{}" });
  ok("start objective → 200", start.status === 200, `got ${start.status}`);

  // research REAL: 3.5–8 menit → poll 12 menit max
  let state = "", opps: { id: string; status: string; title?: string }[] = [];
  console.log(`  … menunggu research REAL (poll ${now()} — max 12 menit)…`);
  for (let i = 0; i < 120; i++) {
    await sleep(6_000);
    const det = await j(await fetch(`${BASE}/objectives/${objId}`, { headers: H(cookie) }));
    state = String((det as { objective?: { state?: string } }).objective?.state ?? "");
    if (state === "OPPORTUNITIES_RANKED") {
      const or = await j(await fetch(`${BASE}/objectives/${objId}/opportunities`, { headers: H(cookie) }));
      opps = ((or as { opportunities?: { id: string; status: string; title?: string }[] }).opportunities ?? []);
      break;
    }
    if (i % 10 === 9) console.log(`    … ${now()} state=${state}`);
  }
  ok(`research REAL selesai → OPPORTUNITIES_RANKED`, state === "OPPORTUNITIES_RANKED", `got ${state}`);
  ok("opportunities ter-rank (REAL)", opps.length > 0, `${opps.length} opp`);
  if (opps.length > 0) {
    console.log(`    opp: ${opps.map((o) => (o.title ?? o.id).toString().slice(0, 40)).join(" | ").slice(0, 200)}`);
  }

  if (opps.length > 0) {
    const target = opps.find((o) => o.status === "RANKED") ?? opps[0]!;
    const sel = await fetch(`${BASE}/objectives/${objId}/opportunities/${target.id}/select`, {
      method: "POST", headers: H(cookie), body: JSON.stringify({ reason: "journey select" }) });
    ok("human select opportunity → 200", sel.status === 200, `got ${sel.status}`);

    let st2 = "";
    for (let i = 0; i < 60; i++) {
      await sleep(5_000);
      const det = await j(await fetch(`${BASE}/objectives/${objId}`, { headers: H(cookie) }));
      st2 = String((det as { objective?: { state?: string } }).objective?.state ?? "");
      if (st2 !== "OPPORTUNITIES_RANKED" && st2 !== "OPPORTUNITY_SELECTED") break;
    }
    ok(`FSM lanjut setelah select (state=${st2})`,
      ["VALIDATING", "RESULT_READY", "EXPERIMENT_DESIGNED", "MISSION_CREATED", "HUMAN_APPROVAL_REQUIRED"].includes(st2));

    // experiments & results §20
    let exps: unknown[] = [];
    for (let i = 0; i < 30; i++) {
      await sleep(5_000);
      const er = await j(await fetch(`${BASE}/objectives/${objId}/experiments`, { headers: H(cookie) }));
      exps = ((er as { experiments?: unknown[] }).experiments ?? []);
      if (exps.length > 0) break;
    }
    ok("experiments terisi (§20)", exps.length > 0, `${exps.length} exp`);

    // missions + approval flow (autonomy 2 → HUMAN_APPROVAL_REQUIRED)
    let missions: { id: string; status: string }[] = [];
    for (let i = 0; i < 30; i++) {
      await sleep(5_000);
      const mr = await j(await fetch(`${BASE}/objectives/${objId}/missions`, { headers: H(cookie) }));
      missions = ((mr as { missions?: { id: string; status: string }[] }).missions ?? []);
      if (missions.length > 0) break;
    }
    ok("missions terisi", missions.length > 0, `${missions.length} mission`);
    if (missions.length > 0) {
      // GET /approvals menuntut query objective_id (422 tanpa itu) — sertakan
      const aps = await j(await fetch(`${BASE}/approvals?objective_id=${objId}`, { headers: H(cookie) }));
      const approvals = ((aps as { approvals?: { id: string; status: string }[] }).approvals ?? []);
      ok("approvals tercatat (autonomy gate)", approvals.length > 0, `${approvals.length} approval`);
      if (approvals.length > 0) {
        const ap = approvals[0]!;
        const appr = await fetch(`${BASE}/approvals/${ap.id}/approve`, {
          method: "POST", headers: H(cookie), body: JSON.stringify({ note: "journey approve" }) });
        ok("approve mission → 200", appr.status === 200, `got ${appr.status}`);
      }
    }

    // events lineage
    const ev = await j(await fetch(`${BASE}/events?objective_id=${objId}`, { headers: H(cookie) }));
    const types = ((ev as { events?: Record<string, unknown>[] }).events ?? []).map((e) => String(e.type ?? e.event_type ?? ""));
    ok("event OPPORTUNITY_AWAITING_CHOICE (§19)", types.includes("OPPORTUNITY_AWAITING_CHOICE"));
    ok("event OPPORTUNITY_SELECTED tercatat", types.includes("OPPORTUNITIES_SELECTED") || types.includes("OPPORTUNITY_SELECTED"));
  }

  // economics view
  const eco = await fetch(`${BASE}/objectives/${objId}/economics`, { headers: H(cookie) });
  ok("GET economics → 200", eco.status === 200, `got ${eco.status}`);

  console.log(`\n═══ JOURNEY PROD: ${pass} PASS, ${fail} FAIL ═══ (${now()})`);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => { console.error(e); process.exit(1); });
process.on("exit", (code: number) => {
  if (code === 0 && fail > 0) process.exitCode = 1;
});
