// E2E Canonical Gate (cookie-session variant) — validasi customer journey
// terhadap server live dengan MANAJEMEN COOKIE EKSPLISIT.
// Varian ini menutup celah harness: node fetch TIDAK menyimpan cookie
// otomatis; varian original memakai x-user-id yang hanya valid di dev.
// Untuk PROD (cookie-first, D6), journey HARUS dilalui dengan cookie session.
const BASE = process.env.BASE || "http://127.0.0.1:3100";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

// ── Cookie jar minimal (header Set-Cookie pertama) ──
let cookie: string | null = null;

async function j<T = any>(path: string, opts: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0] ?? null;
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

(async () => {
  console.log("═══ AUREX E2E CANONICAL GATE (cookie-session) ═══\nBASE:", BASE, "\n");

  // ── LANDING / CONTROL CENTER served ──
  const root = await fetch(BASE + "/").then(r => r.text());
  ok("GET / serves React shell", root.includes("root") || root.length > 50000);
  const leaks = ["RESULT_READY", "MISSION_CREATED", "KIMI k3", "GLM 5.2", "4188 tokens", "streamlake/"];
  const foundLeak = leaks.filter(l => root.includes(l));
  ok("No raw FSM/model leak in served shell", foundLeak.length === 0, `leaks=${foundLeak.join(",")}`);

  // ── HEALTH ──
  const health = await j("/health");
  ok("GET /health ok", health.status === 200 && health.body?.status === "ok");

  // ── AUTH (signup new user, session cookie) ──
  const email = `e2e-${Date.now()}@aurex.test`;
  const su = await j("/auth/signup", { method: "POST", body: JSON.stringify({ email, password: "password123", name: "E2E", org_name: "E2E Org" }) });
  ok("SIGNUP creates account", su.status === 200 && !!su.body?.user?.id, JSON.stringify(su.body).slice(0, 120));
  const uid = su.body?.user?.id as string;
  ok("Got user id", typeof uid === "string" && uid.length > 10);
  ok("Signup set session cookie", !!cookie && /aee_session=/.test(cookie ?? ""));

  // ── AUTH/me (cookie) ──
  const me = await j("/auth/me");
  ok("GET /auth/me (cookie session)", me.status === 200 && me.body?.user?.id === uid);

  // ── ONBOARDING: Organization → Business → Baseline → Goal → ExecPref ──
  const s1 = await j("/onboarding/step1", { method: "POST", body: JSON.stringify({ business_name: "Kopi E2E", industry: "F&B", target_customer: "Pekerja kantoran" }) });
  ok("ONBOARDING Business (venture)", s1.status === 200 && !!s1.body?.venture_id, JSON.stringify(s1.body).slice(0, 120));
  const s3 = await j("/onboarding/step3", { method: "POST", body: JSON.stringify({ current_revenue: "10000000", current_cost: "7000000", capital: "2000000", time_horizon_months: 6 }) });
  ok("ONBOARDING Economic Baseline", s3.status === 200);
  const s2 = await j("/onboarding/step2", { method: "POST", body: JSON.stringify({ goal_type: "increase_profit" }) });
  ok("ONBOARDING Goal", s2.status === 200);
  const s4 = await j("/onboarding/step4", { method: "POST", body: JSON.stringify({ autonomy_level: 2 }) });
  ok("ONBOARDING Execution Preference = Approval Required (2)", s4.status === 200);
  const s5 = await j("/onboarding/step5", { method: "POST", body: JSON.stringify({ title: "Increase profit Kopi E2E", target_profit: "20000000" }) });
  ok("FIRST ANALYSIS (objective created + research started)", s5.status === 200 && !!s5.body?.objective_id, JSON.stringify(s5.body).slice(0, 160));
  const objId = s5.body?.objective_id as string;

  // ── CONTROL CENTER: objectives list ──
  const objs = await j("/objectives");
  ok("CONTROL CENTER objectives list", objs.status === 200 && Array.isArray(objs.body?.objectives) && objs.body.objectives.length >= 1);

  // ── OBJECTIVE detail ──
  const det = await j(`/objectives/${objId}`);
  ok("OBJECTIVE detail", det.status === 200 && !!det.body?.objective);

  // ── OPPORTUNITIES ──
  const opps = await j(`/objectives/${objId}/opportunities`);
  ok("OPPORTUNITIES endpoint", opps.status === 200 && Array.isArray(opps.body?.opportunities));

  // ── ACTIVITY / EVENTS ──
  const evts = await j(`/events?objective_id=${objId}`);
  ok("ACTIVITY events endpoint", evts.status === 200 && Array.isArray(evts.body?.events));

  // ── APPROVALS ──
  const appr = await j(`/approvals?objective_id=${objId}`);
  ok("APPROVALS endpoint", appr.status === 200 && Array.isArray(appr.body?.approvals));

  // ── BILLING ──
  const bill = await j("/billing/plan");
  ok("BILLING plan endpoint", bill.status === 200 && !!bill.body?.plan);

  // ── LOGOUT (mengakhiri session — hygiene) ──
  const lo = await j("/auth/logout", { method: "POST" });
  ok("LOGOUT ok", lo.status === 200 || lo.status === 204);
  const me2 = await j("/auth/me");
  ok("Session mati setelah logout", me2.status === 401);

  console.log(`\n═══ RESULT: ${pass} PASS, ${fail} FAIL ═══`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error("E2E crashed:", e); process.exit(1); });
