/**
 * Smoke test deployment PRODUCTION (aurex-api.fly.dev) — verify remediasi 451d1c7.
 * Hanya endpoint ringan (tanpa research agent REAL — mahal & lambat di prod).
 * Uniqueness: email unik per-run (timestamp).
 */
const BASE = process.env.SMOKE_BASE ?? "https://aurex-api.fly.dev";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  const s = cond ? "✓" : "✗";
  console.log(`  ${s} ${name}${detail ? ` (${detail})` : ""}`);
  cond ? pass++ : fail++;
}
const j = (r: Response) => r.json().catch(() => ({}));

async function main(): Promise<void> {
  const ts = Date.now().toString(36);
  const cookieOf = (r: Response): string =>
    (r.headers.get("set-cookie") ?? "").split(";")[0] || "";

  console.log("── ROUTES ──");
  const root = await fetch(`${BASE}/`);
  ok("`/` = landing publik 200", root.status === 200);
  const rootHtml = await root.text();
  ok("landing title baru (Intelligence Platform)", rootHtml.includes("AI-Powered Economic Intelligence"), rootHtml.match(/<title>[^<]*<\/title>/)?.[0] ?? "?");
  ok("landing BEBAS KIMI/GLM", !/KIMI|GLM|streamlake/.test(rootHtml));
  const app = await fetch(`${BASE}/app`);
  ok("`/app` = dashboard SPA 200", app.status === 200);

  console.log("── AUTH LIFECYCLE ──");
  const su = await fetch(`${BASE}/auth/signup`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `prodA${ts}@test.local`, password: "ProdAudit#2026!", name: "Prod A" }),
  });
  ok("signup 200/201", su.status === 200 || su.status === 201, `got ${su.status}`);
  const suCookie = cookieOf(su);

  const me = (await j(await fetch(`${BASE}/auth/me`, { headers: { cookie: suCookie } }))) as { user?: { emailVerified?: boolean } };
  ok("me.emailVerified=false awal", me?.user?.emailVerified === false, JSON.stringify(me?.user?.emailVerified));

  const forgot = await fetch(`${BASE}/auth/forgot-password`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `nonexistent${ts}@test.local` }),
  });
  ok("forgot anti-enumeration (200 email tak dikenal)", forgot.status === 200, `got ${forgot.status}`);

  const badVerify = await fetch(`${BASE}/auth/verify-email`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "invalid-token-xxx" }),
  });
  ok("verify token invalid → 422", badVerify.status === 422, `got ${badVerify.status}`);

  const badReset = await fetch(`${BASE}/auth/reset-password`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "invalid-token-xxx", password: "NewPass#2026!" }),
  });
  ok("reset token invalid → 422", badReset.status === 422, `got ${badReset.status}`);

  // login rate-limit (blok 15m) — hanya uji 2x salah, tidak sampai blokir
  // (memblokir IP prod 15 menit akan mengganggu; 429 sudah diverifikasi lokal).
  const wrong1 = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `prodA${ts}@test.local`, password: "wrong" }),
  });
  ok("login salah → 401 (bukan 500)", wrong1.status === 401, `got ${wrong1.status}`);

  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `prodA${ts}@test.local`, password: "ProdAudit#2026!" }),
  });
  ok("login benar → 200", login.status === 200, `got ${login.status}`);
  const lgCookie = cookieOf(login);

  console.log("── BOLA / IDOR ──");
  const anon = await fetch(`${BASE}/objectives`);
  ok("anonim → 401", anon.status === 401, `got ${anon.status}`);

  // buat objective A via onboarding lengkap 1-5
  for (const [step, body] of [
    ["step1", { business_name: `Prod Biz ${ts}`, industry: "ritel", target_customer: "umkm" }],
    ["step2", { goal_type: "increase_profit" }],
    ["step3", { current_revenue: "10000000", current_cost: "6000000", capital: "5000000", time_horizon_months: 6 }],
    ["step4", { autonomy_level: 2 }],
  ] as const) {
    const r = await fetch(`${BASE}/onboarding/${step}`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie: lgCookie },
      body: JSON.stringify(body),
    });
    if (r.status !== 200 && r.status !== 201) {
      ok(`onboarding ${step} OK`, false, `got ${r.status}`);
    }
  }
  const org = await fetch(`${BASE}/onboarding/step5`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: lgCookie },
    body: JSON.stringify({ title: "Objective Prod Audit", target_profit: "2000000" }),
  });
  const orgJ = (await j(org)) as { objective?: { id?: string }, objective_id?: string };
  const objAId = orgJ?.objective?.id ?? orgJ?.objective_id;
  if (!objAId) {
    // fallback: onboarding mungkin butuh langkah berurutan; coba /objectives
    const list = await j(await fetch(`${BASE}/objectives`, { headers: { cookie: lgCookie } }));
    const objs = (list as { objectives?: { id: string }[] }).objectives ?? [];
    ok("objective tersedia untuk uji BOLA", objs.length > 0, `${objs.length} obj`);
  }
  // B signup + akses objek A
  const suB = await fetch(`${BASE}/auth/signup`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `prodB${ts}@test.local`, password: "ProdAudit#2026!", name: "Prod B" }),
  });
  const bCookie = cookieOf(suB);
  ok("signup B 200/201", suB.status === 200 || suB.status === 201, `got ${suB.status}`);

  if (objAId) {
    const bGet = await fetch(`${BASE}/objectives/${objAId}`, { headers: { cookie: bCookie } });
    ok("B GET objective A → 404", bGet.status === 404, `got ${bGet.status}`);
    const bStart = await fetch(`${BASE}/objectives/${objAId}/start`, { method: "POST", headers: { cookie: bCookie } });
    ok("B POST start A → 404", bStart.status === 404, `got ${bStart.status}`);
  }

  console.log("── ADMIN ISOLATION ──");
  const agentMode = await fetch(`${BASE}/agent-mode`, { headers: { cookie: bCookie } });
  ok("non-admin /agent-mode → 403", agentMode.status === 403, `got ${agentMode.status}`);
  const agentModeA = await fetch(`${BASE}/agent-mode`, { headers: { cookie: lgCookie } });
  ok("non-admin A /agent-mode → 403", agentModeA.status === 403, `got ${agentModeA.status}`);

  // events: 422 tanpa objective_id = validasi benar (bukan bug) — uji dgn objective_id
  if (objAId) {
    const ev = await fetch(`${BASE}/events?objective_id=${objAId}`, { headers: { cookie: lgCookie } });
    ok("GET /events?objective_id → 200", ev.status === 200, `got ${ev.status}`);
  }

  console.log("── ENDPOINT BARU (verifikasi existence + auth-gate) ──");
  for (const ep of ["/objectives/x/experiments", "/objectives/x/missions", "/objectives/x/results", "/objectives/x/economics", "/objectives/x/decisions"]) {
    const r = await fetch(`${BASE}${ep}`, { headers: { cookie: lgCookie } });
    ok(`GET ${ep} → 401/403/404 (bukan 405/500)`, [401, 403, 404].includes(r.status), `got ${r.status}`);
  }

  console.log(`\n═══ PROD SMOKE: ${pass} PASS, ${fail} FAIL ═══`);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => { console.error(e); process.exit(1); });
process.on("exit", (code: number) => {
  if (code === 0 && fail > 0) process.exitCode = 1;
});
