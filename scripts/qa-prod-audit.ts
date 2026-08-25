#!/usr/bin/env node
// ═══ QA PRODUCTION AUDIT — AUREX black-box harness ═══
// Target: https://aurex-api.fly.dev (prod v13, commit ec1ae9e, agents MOCK)
// Metode: real user action → system response → state change → bukti.
// Semua temuan direkam dengan evidence mentah. Tidak ada assert yang direlakan.
export {};

const BASE = process.env.QA_BASE ?? "https://aurex-api.fly.dev";
const TAG = process.env.QA_TAG ?? `qa${Date.now().toString(36)}`;
let pass = 0, fail = 0;
const defects: Array<{sev: string, id: string, title: string, area: string, evidence: string, expected: string, actual: string}> = [];
const notes: string[] = [];
let D = 0;
function log(s: string) { console.log(s); }
function ok(name: string, cond: boolean, evidence = "-") {
  if (cond) { pass++; log(`  ✓ ${name}`); }
  else { fail++; log(`  ✗ ${name} — ${evidence}`); }
}
function defect(sev: "P0"|"P1"|"P2"|"P3", title: string, area: string, evidence: string, expected: string, actual: string) {
  D++;
  defects.push({ sev, id: `QA-${String(D).padStart(3, "0")}`, title, area, evidence, expected, actual });
  log(`  ⚠ DEFECT ${sev} [QA-${String(D).padStart(3, "0")}]: ${title} — ${evidence}`);
}
function section(s: string) { log(`\n── ${s} ──`); }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{status: number, body: any, headers: any, text: string, ms: number}> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* html/text */ }
  return { status: res.status, body: json, headers: res.headers, text, ms: Date.now() - t0 };
}
function cookie(res: { headers: any }): string {
  const c = res.headers?.get?.("set-cookie") ?? "";
  const m = /aee_session=([^;]+)/.exec(c);
  return m ? `aee_session=${m[1]}` : "";
}
const H = (sid: string) => ({ cookie: sid });

async function signup(email: string, password: string, name?: string): Promise<{ sid: string, userId: string, email: string }> {
  const r = await req("POST", "/auth/signup", { email, password, name });
  if (r.status !== 200) throw new Error(`signup ${email} gagal: ${r.status} ${r.text.slice(0, 150)}`);
  return { sid: cookie(r), userId: r.body.user.id, email };
}
async function poll(fn: () => Promise<string | false>, timeoutMs: number, label: string): Promise<string | false> {
  const t0 = Date.now();
  let last: string | false = "";
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (last !== false) return last;
    await sleep(3000);
  }
  log(`    … timeout ${label}: last=${String(last)}`);
  return false;
}

// ═══════════════════════ PHASE A: ENTRY POINTS ═══════════════════════
section("PHASE A: Entry points & public surface");
{
  const lat: number[] = [];
  for (let i = 0; i < 5; i++) { const r = await req("GET", "/"); lat.push(r.ms); }
  const p50 = lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)];
  ok(`GET / landing 200 (P50 ${p50}ms, n=5)`, lat.length === 5 && (await req("GET", "/")).status === 200);
  notes.push(`latency / P50=${p50}ms samples=[${lat.join(",")}]`);
  const home = await req("GET", "/");
  ok("landing tak redirect ke /app", !String(home.headers.get("location") ?? "").includes("/app"), String(home.headers.get("location")));
  ok("branding AUREX", /AUREX/i.test(home.text), "AUREX tidak ditemukan");
  ok("CTA href=/app ada", /href="\/app"/.test(home.text), "tidak ada link /app");
  const leakTerms = ["pg-boss", "moonshot", "streamlake", "FSM ", "OBJECTIVE_CREATED", "RESEARCHING", "KIMI_MODEL", "opportunity_fsm"];
  const found = leakTerms.filter((t) => home.text.includes(t));
  ok("landing bebas leak internal", found.length === 0, `leak: ${found.join(",")}`);
  for (const p of ["/app", "/admin", "/auth/login", "/onboarding", "/dashboard.html", "/landing"]) {
    const r = await req("GET", p);
    ok(`GET ${p} → 200 SPA`, r.status === 200 && /<html/i.test(r.text), `HTTP ${r.status}`);
  }
  for (const p of ["/platform", "/solutions", "/pricing", "/enterprise", "/insights"]) {
    const r = await req("GET", p);
    log(`  · ${p} → HTTP ${r.status} ${r.status === 404 ? "(404 — bukan route SPA fallback?)" : ""}`);
  }
  const r404 = await req("GET", "/nonexistent-" + TAG);
  ok("route asing → 404 (bukan 500)", r404.status === 404, `HTTP ${r404.status}`);
  const am = await req("GET", "/agent-mode");
  ok("GET /agent-mode → MOCK (prod)", am.body?.mode === "MOCK", JSON.stringify(am.body));
  // cookie flags via signup langsung di sini? tidak — Phase B.
}

// ═══════════════════════ PHASE B: AUTH QA ═══════════════════════
section("PHASE B: Auth QA (positif & negatif)");
let SID_A = "", SID_B = "", EMAIL_A = "", EMAIL_B = "";
{
  EMAIL_A = `usera.${TAG}@aurex.test`;
  EMAIL_B = `userb.${TAG}@aurex.test`;
  const a = await signup(EMAIL_A, "QaTest#12345", "User A");
  SID_A = a.sid; ok("signup A → 200 + cookie", !!SID_A);
  const raw = await fetch(`${BASE}/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL_B, password: "QaTest#12345", name: "User B" }) });
  const btxt = (await raw.text());
  SID_B = cookie({ headers: raw.headers });
  ok("signup B → 200 + cookie", raw.status === 200 && !!SID_B, `HTTP ${raw.status} ${btxt.slice(0, 120)}`);
  // cookie security flags
  const setc = String(raw.headers.get("set-cookie") ?? "");
  ok("cookie httpOnly", /httponly/i.test(setc), setc.slice(0, 100));
  ok("cookie secure (prod)", /secure/i.test(setc), setc.slice(0, 100));
  ok("cookie sameSite", /samesite/i.test(setc), setc.slice(0, 100));
  notes.push(`set-cookie: ${setc.replace(/aee_session=[^;]+/, "aee_session=<redacted>")}`);

  // negatif
  let r = await req("POST", "/auth/signup", { email: EMAIL_A, password: "QaTest#12345" });
  ok("signup duplikat → 409", r.status === 409, `HTTP ${r.status} ${r.text.slice(0, 80)}`);
  r = await req("POST", "/auth/login", { email: "bukan-email", password: "x" });
  ok("login email invalid → 422", r.status === 422, `HTTP ${r.status}`);
  r = await req("POST", "/auth/login", { email: EMAIL_A, password: "" });
  ok("login password kosong → 422", r.status === 422, `HTTP ${r.status}`);
  r = await req("POST", "/auth/login", { email: EMAIL_A, password: "WrongPass#1" });
  ok("login password salah → 401", r.status === 401, `HTTP ${r.status}`);
  r = await req("POST", "/auth/login", { email: `ghost.${TAG}@aurex.test`, password: "x" });
  ok("login akun tidak ada → 401", r.status === 401, `HTTP ${r.status}`);
  r = await req("POST", "/auth/login", { email: EMAIL_A, password: "QaTest#12345", extra_field: "x" });
  log(`  · login dengan field ekstra → HTTP ${r.status} (strict schema?)`);
  // login valid → session persist
  r = await req("POST", "/auth/login", { email: EMAIL_A, password: "QaTest#12345" });
  ok("login A valid → 200", r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 100)}`);
  if (cookie(r)) SID_A = cookie(r);
  const me = await req("GET", "/auth/me", undefined, H(SID_A));
  ok("/auth/me → 200 email cocok", me.status === 200 && me.body?.user?.email === EMAIL_A, `HTTP ${me.status} ${r.text.slice(0, 80)}`);
  const mePlan = me.body?.plan?.tier ?? me.body?.planTier ?? me.body?.org?.plan_tier;
  ok("default plan FREE", mePlan === "FREE", `plan=${mePlan}`);
  const autonomy = me.body?.autonomy ?? me.body?.user?.autonomy ?? me.body?.org?.autonomy_level;
  ok("default autonomy = 2 (Approval Required)", Number(autonomy) === 2, `autonomy=${autonomy}`);
  // logout
  r = await req("POST", "/auth/logout", {}, H(SID_A));
  ok("logout → 200", r.status === 200, `HTTP ${r.status}`);
  const meAfter = await req("GET", "/auth/me", undefined, H(SID_A));
  ok("session mati setelah logout", meAfter.status === 401, `HTTP ${meAfter.status}`);
  // re-login untuk phase berikutnya
  r = await req("POST", "/auth/login", { email: EMAIL_A, password: "QaTest#12345" });
  SID_A = cookie(r) || SID_A;
  ok("re-login A → 200", r.status === 200, `HTTP ${r.status}`);
}

// ═══════════════════════ PHASE C: GUARDS & TENANCY ═══════════════════════
section("PHASE C: Route guards & cross-tenant adversarial");
let OBJ_A = "";
{
  // anonim
  let r = await req("GET", "/objectives");
  ok("GET /objectives anon → 401", r.status === 401, `HTTP ${r.status}`);
  r = await req("GET", "/admin/overview");
  ok("GET /admin/overview anon → 401", r.status === 401, `HTTP ${r.status}`);
  r = await req("GET", "/billing/plan");
  ok("GET /billing/plan anon → 401", r.status === 401, `HTTP ${r.status}`);

  // USER A onboarding penuh → objective
  const steps: Array<[string, unknown]> = [
    ["step1", { business_name: `Biz ${TAG}`, industry: "ritel", target_customer: "umkm" }],
    ["step2", { goal_type: "increase_profit" }],
    ["step3", { current_revenue: "12000000", current_cost: "7000000", capital: "5000000", time_horizon_months: 6 }],
    ["step4", { autonomy_level: 2 }],
  ];
  for (const [s, body] of steps) {
    const rr = await req("POST", `/onboarding/${s}`, body, H(SID_A));
    ok(`onboarding ${s} → 200/201`, rr.status === 200 || rr.status === 201, `HTTP ${rr.status} ${rr.text.slice(0, 100)}`);
  }
  const s5 = await req("POST", "/onboarding/step5", { title: `Objective ${TAG}`, target_profit: "3000000" }, H(SID_A));
  ok("step5 → 200/201 (wizard fix)", s5.status === 200 || s5.status === 201, `HTTP ${s5.status} ${s5.text.slice(0, 150)}`);
  OBJ_A = s5.body?.objective?.id ?? s5.body?.objective_id ?? "";
  ok("objective A terbuat", !!OBJ_A, JSON.stringify(s5.body).slice(0, 120));

  // cross-tenant probes (B terhadap objek milik A)
  if (OBJ_A) {
    r = await req("GET", `/objectives/${OBJ_A}`, undefined, H(SID_B));
    ok("B→A objective → 404/403", [404, 403].includes(r.status), `HTTP ${r.status}`);
    r = await req("GET", `/objectives/${OBJ_A}/opportunities`, undefined, H(SID_B));
    ok("B→A opportunities → 404/403", [404, 403].includes(r.status), `HTTP ${r.status}`);
    r = await req("POST", `/objectives/${OBJ_A}/start`, {}, H(SID_B));
    ok("B→A start → 404/403", [404, 403].includes(r.status), `HTTP ${r.status}`);
    r = await req("POST", `/objectives/${OBJ_A}/stop`, {}, H(SID_B));
    ok("B→A stop → 404/403", [404, 403].includes(r.status), `HTTP ${r.status}`);
    r = await req("GET", `/objectives/${OBJ_A}/economics`, undefined, H(SID_B));
    ok("B→A economics → 404/403", [400, 404, 403].includes(r.status), `HTTP ${r.status}`);
    r = await req("GET", `/events?objective_id=${OBJ_A}`, undefined, H(SID_B));
    ok("B→A events → 404/403/kosong", [404, 403].includes(r.status) || (Array.isArray(r.body?.events) && r.body.events.length === 0), `HTTP ${r.status}`);
    // UUID enumeration: id non-UUID
    r = await req("GET", "/objectives/not-a-uuid");
    ok("non-UUID id → 404 (anti-enumeration)", r.status === 404, `HTTP ${r.status}`);
    r = await req("GET", `/objectives/${crypto.randomUUID()}`, undefined, H(SID_A));
    ok("UUID random → 404 (bukan 500/403 leak)", r.status === 404, `HTTP ${r.status}`);
    r = await req("GET", `/objectives/${crypto.randomUUID()}`, undefined, H(SID_B));
    ok("B→random UUID → 404", r.status === 404, `HTTP ${r.status}`);
  }
}

// ═══════════════════════ PHASE D: CORE FSM JOURNEY (A) ═══════════════════════
section("PHASE D: Core FSM journey (USER A, agents MOCK)");
{
  if (OBJ_A) {
    const start = await req("POST", `/objectives/${OBJ_A}/start`, {}, H(SID_A));
    ok("start objective → 200", start.status === 200, `HTTP ${start.status} ${start.text.slice(0, 120)}`);
    // double-start → harus ditolak
    const start2 = await req("POST", `/objectives/${OBJ_A}/start`, {}, H(SID_A));
    ok("double-start ditolak (idempotency guard)", [400, 409].includes(start2.status), `HTTP ${start2.status} ${start2.text.slice(0, 100)}`);
    const st = await poll(async () => {
      const d = await req("GET", `/objectives/${OBJ_A}`, undefined, H(SID_A));
      return d.body?.objective?.state === "OPPORTUNITIES_RANKED" ? d.body.objective.state : false;
    }, 120_000, "research MOCK");
    ok("research → OPPORTUNITIES_RANKED ≤120s", st === "OPPORTUNITIES_RANKED", `state=${st}`);
    const or = await req("GET", `/objectives/${OBJ_A}/opportunities`, undefined, H(SID_A));
    const opps = or.body?.opportunities ?? [];
    ok("opportunities ter-rank ≥1", opps.length > 0, `${opps.length} opp`);
    if (opps.length > 0) {
      const o0 = opps[0];
      ok("opp #1 punya score/rank", (o0.score ?? o0.rank) != null, JSON.stringify(o0).slice(0, 100));
      ok("opp #1 punya expected_upside/capital", (o0.expected_upside ?? o0.capital_required) != null, JSON.stringify(o0).slice(0, 100));
      // USER B tidak bisa select opp milik A
      const selB = await req("POST", `/objectives/${OBJ_A}/opportunities/${o0.id}/select`, { reason: "inject" }, H(SID_B));
      ok("B→A select opp → 404/403", [404, 403].includes(selB.status), `HTTP ${selB.status}`);
      const sel = await req("POST", `/objectives/${OBJ_A}/opportunities/${o0.id}/select`, { reason: "qa select" }, H(SID_A));
      ok("human select → 200", sel.status === 200, `HTTP ${sel.status} ${sel.text.slice(0, 100)}`);
    }
    // tunggu experiment + mission + approval
    const st2 = await poll(async () => {
      const d = await req("GET", `/objectives/${OBJ_A}`, undefined, H(SID_A));
      const s = d.body?.objective?.state ?? "";
      return ["EXPERIMENT_DESIGNED", "MISSION_CREATED", "HUMAN_APPROVAL_REQUIRED", "VALIDATING", "RESULT_READY"].includes(s) ? s : false;
    }, 120_000, "post-select FSM");
    ok("FSM lanjut setelah select", !!st2, `state=${st2}`);
    const er = await req("GET", `/objectives/${OBJ_A}/experiments`, undefined, H(SID_A));
    const exps = er.body?.experiments ?? [];
    ok("experiments terisi", exps.length > 0, `${exps.length} exp`);
    if (exps.length > 0) {
      const e0 = exps[0];
      for (const f of ["hypothesis", "budget", "duration_days", "success_metric"]) {
        ok(`experiment field ${f}`, (e0[f] ?? e0[f.toUpperCase()] ?? null) != null, JSON.stringify(e0).slice(0, 120));
      }
    }
    const mr = await req("GET", `/objectives/${OBJ_A}/missions`, undefined, H(SID_A));
    const missions = mr.body?.missions ?? [];
    ok("missions terisi", missions.length > 0, `${missions.length} mission`);
    if (missions.length > 0) {
      const aps = await req("GET", `/approvals?objective_id=${OBJ_A}`, undefined, H(SID_A));
      const approvals = aps.body?.approvals ?? [];
      ok("approvals tercatat", approvals.length > 0, `${approvals.length} approval`);
      if (approvals.length > 0) {
        const ap = approvals[0];
        // USER B tidak bisa approve/reject approval milik A — 422 di sini berarti
        // handler mengecek kepemilikan SETELAH validasi body (leak), catat status.
        const rejB = await req("POST", `/approvals/${ap.id}/reject`, { note: "inject" }, H(SID_B));
        ok("B→A reject approval → 404/403", [404, 403].includes(rejB.status), `HTTP ${rejB.status} (${rejB.body?.error?.message ?? rejB.text.slice(0, 80)})`);
        const appr = await req("POST", `/approvals/${ap.id}/approve`, { note: "qa approve" }, H(SID_A));
        ok("approve mission → 200", appr.status === 200, `HTTP ${appr.status} ${appr.text.slice(0, 100)}`);
        // double-approve → ditolak
        const appr2 = await req("POST", `/approvals/${ap.id}/approve`, { note: "double" }, H(SID_A));
        ok("double-approve ditolak", [400, 409].includes(appr2.status), `HTTP ${appr2.status}`);
      }
    }
  }
}

// ═══════════════════════ PHASE E: API NEGATIVE & IDEMPOTENCY ═══════════════════════
section("PHASE E: API negative & idempotency");
{
  let r = await req("POST", "/auth/signup", "INVALID_JSON{{", { "content-type": "application/json" });
  ok("signup JSON invalid → 400 (bukan 500)", [400].includes(r.status), `HTTP ${r.status}`);
  r = await req("POST", "/auth/login", { email: "x@y.z" });
  ok("login missing field → 422", r.status === 422, `HTTP ${r.status}`);
  r = await req("POST", "/objectives", { random: "payload" }, H(SID_A));
  log(`  · POST /objectives body asing → HTTP ${r.status} (extract payload intent)`);
  const big = { email: "x".repeat(100_000) };
  r = await req("POST", "/auth/login", big, H(""));
  log(`  · oversized body login → HTTP ${r.status}`);
  r = await req("GET", "/objectives/00000000-0000-0000-0000-000000000000", undefined, H(SID_A));
  ok("UUID nil → 404", r.status === 404, `HTTP ${r.status}`);
  r = await req("GET", "/approvals", undefined, H(SID_A));
  log(`  · GET /approvals tanpa objective_id → HTTP ${r.status} (422 by design)`);
  r = await req("POST", `/objectives/${OBJ_A}/abort`, {}, H(SID_A));
  log(`  · abort objective running → HTTP ${r.status}`);
}

// ═══════════════════════ PHASE F: BILLING & ENTITLEMENT ═══════════════════════
section("PHASE F: Billing & entitlement");
{
  const b = await req("GET", "/billing/plan", undefined, H(SID_A));
  ok("GET /billing/plan → 200", b.status === 200, `HTTP ${b.status}`);
  ok("billing plan FREE", b.body?.plan?.tier === "FREE", JSON.stringify(b.body?.plan));
  ok("usage credits ada", b.body?.usage != null, JSON.stringify(b.body?.usage));
  ok("subscription null (belum upgrade)", b.body?.subscription == null, JSON.stringify(b.body?.subscription));
}

// ═══════════════════════ PHASE G: ADMIN RBAC ═══════════════════════
section("PHASE G: Admin RBAC");
{
  // customer biasa
  let r = await req("GET", "/admin/overview", undefined, H(SID_A));
  ok("customer → /admin/overview = 403", r.status === 403, `HTTP ${r.status}`);
  r = await req("GET", "/admin/users", undefined, H(SID_A));
  ok("customer → /admin/users = 403", r.status === 403, `HTTP ${r.status}`);
  r = await req("GET", "/admin/objectives", undefined, H(SID_A));
  ok("customer → /admin/objectives = 403", r.status === 403, `HTTP ${r.status}`);
  // admin (rizkiiramdaniii) — login
  const al = await req("POST", "/auth/login", { email: "rizkiiramdaniii@gmail.com", password: "secret123" });
  if (al.status === 200) {
    const sidAdmin = cookie(al);
    r = await req("GET", "/admin/overview", undefined, H(sidAdmin));
    ok("admin → /admin/overview = 200", r.status === 200, `HTTP ${r.status}`);
    r = await req("GET", "/admin/users", undefined, H(sidAdmin));
    ok("admin → /admin/users = 200", r.status === 200, `HTTP ${r.status}`);
    const emails = (r.body?.users ?? []).map((u: any) => u.email);
    ok("admin melihat user B (bukan hanya diri)", emails.includes(EMAIL_B), `n=${emails.length}`);
  } else {
    ok("login admin (rizkiiramdaniii) → 200", false, `HTTP ${al.status} ${al.text.slice(0, 100)}`);
  }
}

// ═══════════════════════ PHASE H: PERF SAMPLING ═══════════════════════
section("PHASE H: Perf sampling");
{
  const lat: Record<string, number[]> = { "/": [], "/app": [], "/health": [] };
  for (let i = 0; i < 8; i++) {
    for (const p of Object.keys(lat)) {
      const r = await req("GET", p);
      (lat[p] ??= []).push(r.ms);
    }
  }
  for (const [p, arr0] of Object.entries(lat)) {
    const s = [...(arr0 ?? [])].sort((x, y) => x - y);
    const p50 = s[Math.floor(s.length / 2)] ?? -1;
    const p95 = s[Math.floor(s.length * 0.95)] ?? -1;
    notes.push(`${p}: P50=${p50}ms P95=${p95}ms n=${s.length} samples=[${s.join(",")}]`);
    ok(`${p} P95 < 2000ms`, p95 >= 0 && p95 < 2000, `P95=${p95}ms`);
  }
}

// ═══════════════════════ SUMMARY ═══════════════════════
log(`\n═══ QA ${TAG}: ${pass} PASS, ${fail} FAIL ═══`);
if (defects.length > 0) {
  log("\n── DEFECT LIST ──");
  for (const d of defects) log(`  [${d.sev}] ${d.id} ${d.title} :: ${d.evidence.slice(0, 120)}`);
}
log("\n── NOTES ──");
for (const n of notes) log(`  · ${n}`);
