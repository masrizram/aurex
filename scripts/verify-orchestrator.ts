/**
 * INTEGRATION verify-orchestrator.ts — Phase 6 vs Postgres scratch (port 55433).
 * ROLE RUNTIME aee_app (SELECT+INSERT+UPDATE terbatas) — bukan superuser.
 *
 * Skenario:
 *  S1  seed objective (owner) → OBJECTIVE_CREATED, deadline NULL
 *  S2  advance("normalize") → OBJECTIVE_VALIDATED, deadline terisi created+horizon
 *  S3  advance("start_research") → RESEARCHING, cycle#1 ACTIVE, job research ter-enqueue
 *  S4  runAgentJob(research) [mock] → OPPORTUNITIES_RANKED, ≥1 opportunity skor engine
 *  S5  runAgentJob(rank_select) → OPPORTUNITY_SELECTED
 *  S6  runAgentJob(design_experiment) → RESULT_READY (SIMULATED COMPLETED, metrik 0)
 *  S7  runAgentJob(design_mission) → autonomy 3 → MISSION_APPROVED
 *  S8  runAgentJob(dispatch_glm) → RESULT_READY via EXECUTION_COMPLETED
 *  S9  stale row_version → OrchestratorError STALE_STATE
 *  S10 double-dispatch idem (mission:1:attempt1) → 1 baris executions
 * S11  stop_objective dari RESULT_READY → STOPPED terminal
 * S12  transisi keluar STOPPED → INVALID_TRANSITION
 * S13  aee_app CANNOT UPDATE capital_transactions (append-only tetap utuh)
 * S14  pg-boss roundtrip: send → work → done (PgBossQueue)
 * S15  events audit: setiap advance menulis event STATE_UPDATED
 * S16  test loop-timeout: advance transisi invalid dari RESEARCHING → INVALID_TRANSITION
 *
 * Jalankan: DATABASE_APP_URL=... npx tsx scripts/verify-orchestrator.ts
 * Exit 0 bila SEMUA tahap lolos.
 */
import { Pool, type PoolClient } from "pg";
import PgBoss from "pg-boss";
import { randomUUID, createHmac } from "node:crypto";
import {
  QUEUE_ADVANCE, advance as advanceDb, runAgentJob, PgBossQueue, InMemoryQueue,
  type AgentJob, type OrchestratorDeps,
} from "@aee/orchestrator/runtime";
import { dispatchJob } from "@aee/orchestrator/mission-manager";
import { MockStrategicAgent, MockExecutionAgent } from "@aee/agents";

const APP_URL = process.env.DATABASE_APP_URL ?? "postgres://aee_app:auditpass@localhost:55433/aee";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "whsec-verify-local";
const advance = advanceDb;

let passed = 0;
let failed = 0;

function stage(name: string, ok: boolean, detail: string): void {
  if (ok) { passed += 1; console.log(`  ✓ ${name} — ${detail}`); }
  else { failed += 1; console.log(`  ✗ ${name} — ${detail}`); }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: APP_URL, max: 5 });
  const client = await pool.connect();
  try {
    // S1 seed (INSERT adalah hak aee_app) — user owner dulu (objectives.user_id NOT NULL)
    // idempoten: email unik per-proses via suffix uuid pendek, ON CONFLICT tak diperlukan.
    const userId = randomUUID();
    const email = `verify-orch-${userId.slice(0, 8)}@local.test`;
    await client.query(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES ($1, $2, 'x', 'owner')`, [userId, email]);
    const objId = randomUUID();
    await client.query(
      `INSERT INTO objectives (id, user_id, title, target_profit, capital_approved, horizon_months,
         deadline, market, risk_tolerance, autonomy_level, state, current_cycle, environment)
       VALUES ($1,$2,'Verify Orchestrator','2000000.00','10000000.00',12, NULL,'id-digital','moderate',3,
         'OBJECTIVE_CREATED',0,'SIMULATED')`, [objId, userId]);
    stage("S1 seed objective", true, `${objId} OBJECTIVE_CREATED deadline NULL`);

    // deps mock + queue in-memory
    const queue = new InMemoryQueue();
    const deps = {
      strategic: new MockStrategicAgent(),
      execution: new MockExecutionAgent(),
      queue,
    };

    // S2 normalize
    const r2 = await advance(client, objId, "normalize", deps);
    stage("S2 normalize → OBJECTIVE_VALIDATED", r2.ok, r2.ok ? `deadline terisi` : r2.reason);
    const o2 = (await client.query<{ deadline: string }>(
      `SELECT deadline::text AS deadline FROM objectives WHERE id = $1`, [objId])).rows[0]!;
    stage("S2b deadline terisi created+horizon", /^\d{4}-\d{2}-\d{2}$/.test(o2.deadline), `deadline=${o2.deadline}`);

    // S3 start_research
    const r3 = await advance(client, objId, "start_research", deps);
    stage("S3 start_research → RESEARCHING", r3.ok, r3.ok ? `job research ter-enqueue` : r3.reason);
    const cyc = (await client.query<{ id: string; cycle_number: number }>(
      `SELECT id, cycle_number FROM cycles WHERE objective_id=$1 AND status='ACTIVE'`, [objId])).rows[0];
    stage("S3b cycle#1 ACTIVE", !!cyc && cyc.cycle_number === 1, cyc ? `cycle ${cyc.cycle_number}` : "cycle hilang");

    // S4 research (mock) → OPPORTUNITIES_RANKED
    const job4: AgentJob = { kind: "research", objectiveId: objId, idem: `research:${objId}:c1` };
    const r4 = await runAgentJob(client, job4, deps);
    const st4 = (await client.query<{ state: string }>(`SELECT state FROM objectives WHERE id=$1`, [objId])).rows[0]!;
    stage("S4 research → OPPORTUNITIES_RANKED", r4.ok && st4.state === "OPPORTUNITIES_RANKED", r4.detail);
    const opps = (await client.query<{ n: string }>(
      `SELECT count(*)::text n FROM opportunities WHERE cycle_id=$1`, [cyc!.id])).rows[0]!;
    stage("S4b opportunities ter-insert", opps.n !== "0", `${opps.n} baris, skor engine`);

    // S5 rank_select → OPPORTUNITY_SELECTED
    const r5 = await runAgentJob(client, { kind: "rank_select", objectiveId: objId, idem: `select:${cyc!.id}` }, deps);
    const st5 = (await client.query<{ state: string }>(`SELECT state FROM objectives WHERE id=$1`, [objId])).rows[0]!;
    stage("S5 rank_select → OPPORTUNITY_SELECTED", r5.ok && st5.state === "OPPORTUNITY_SELECTED", r5.detail);

    // S6 design_experiment → RESULT_READY
    const r6 = await runAgentJob(client, { kind: "design_experiment", objectiveId: objId, idem: `exp:${cyc!.id}` }, deps);
    const st6 = (await client.query<{ state: string }>(`SELECT state FROM objectives WHERE id=$1`, [objId])).rows[0]!;
    stage("S6 design_experiment → RESULT_READY", r6.ok && st6.state === "RESULT_READY", r6.detail);

    // S7 design_mission → MISSION_APPROVED (autonomy 3)
    const r7 = await runAgentJob(client, { kind: "design_mission", objectiveId: objId, idem: `mission:${cyc!.id}` }, deps);
    const st7 = (await client.query<{ state: string }>(`SELECT state FROM objectives WHERE id=$1`, [objId])).rows[0]!;
    stage("S7 design_mission → MISSION_APPROVED", r7.ok && st7.state === "MISSION_APPROVED", r7.detail);

    // S8 dispatch_glm → RESULT_READY via EXECUTION_COMPLETED
    const missionRow = (await client.query<{ id: string }>(
      `SELECT id FROM missions WHERE objective_id=$1 ORDER BY created_at DESC LIMIT 1`, [objId])).rows[0]!;
    const r8 = await runAgentJob(client, { kind: "dispatch_glm", objectiveId: objId, idem: `dispatch:${missionRow.id}:1` }, deps);
    const st8 = (await client.query<{ state: string }>(`SELECT state FROM objectives WHERE id=$1`, [objId])).rows[0]!;
    stage("S8 dispatch_glm → RESULT_READY", r8.ok && st8.state === "RESULT_READY", r8.detail);
    const execCount = (await client.query<{ n: string }>(
      `SELECT count(*)::text n FROM executions WHERE mission_id=$1`, [missionRow.id])).rows[0]!;
    stage("S8b executions = 1", execCount.n === "1", `n=${execCount.n}`);

    // S9 race nyata: 2 koneksi advance("normalize") serentak pada objective segar —
    // advisory lock + optimistic concurrency menjamin TEPAT 1 sukses, 1 ditolak,
    // row_version naik tepat 1 (tak ada transisi ganda).
    const objRace = randomUUID();
    await client.query(
      `INSERT INTO objectives (id, user_id, title, target_profit, capital_approved, horizon_months,
         deadline, market, risk_tolerance, autonomy_level, state, current_cycle, environment)
       VALUES ($1,$2,'Verify Race','2000000.00','10000000.00',12, NULL,'id-digital','moderate',3,
         'OBJECTIVE_CREATED',0,'SIMULATED')`, [objRace, userId]);
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    let okCount = 0; let rejCount = 0;
    const race = await Promise.allSettled([
      advance(c1, objRace, "normalize", deps),
      advance(c2, objRace, "normalize", deps),
    ]);
    c1.release(); c2.release();
    for (const r of race) {
      if (r.status === "fulfilled" && r.value.ok) okCount += 1; else rejCount += 1;
    }
    const rv = (await client.query<{ row_version: number; state: string }>(
      `SELECT row_version, state FROM objectives WHERE id=$1`, [objRace])).rows[0]!;
    stage("S9 race normalize ×2 → tepat 1 sukses",
      okCount === 1 && rejCount === 1 && rv.state === "OBJECTIVE_VALIDATED" && rv.row_version === 2,
      `ok=${okCount} rej=${rejCount} state=${rv.state} rv=${rv.row_version} (default 1 → +1)`);

    // S10 re-run dispatch idem → idempoten (state sudah RESULT_READY, skip)
    const r10 = await runAgentJob(client, { kind: "dispatch_glm", objectiveId: objId, idem: `dispatch:${missionRow.id}:1` }, deps);
    const execCount2 = (await client.query<{ n: string }>(
      `SELECT count(*)::text n FROM executions WHERE mission_id=$1`, [missionRow.id])).rows[0]!;
    stage("S10 idempoten re-dispatch", r10.ok && execCount2.n === "1", `detail="${r10.detail}" n=${execCount2.n}`);

    // S11 stop_objective → STOPPED
    const r11 = await advance(client, objId, "stop_objective", deps);
    const st11 = (await client.query<{ state: string }>(`SELECT state FROM objectives WHERE id=$1`, [objId])).rows[0]!;
    stage("S11 stop_objective → STOPPED", r11.ok && st11.state === " " ? false : r11.ok && st11.state === "STOPPED", r11.ok ? `state=${st11.state}` : r11.reason);

    // S12 transisi keluar STOPPED → INVALID_TRANSITION
    const r12 = await advance(client, objId, "analyze", deps);
    stage("S12 STOPPED terminal → INVALID_TRANSITION", !r12.ok && r12.code === "INVALID_TRANSITION", r12.ok ? "harusnya ditolak" : r12.reason);

    // S13 aee_app TIDAK BISA UPDATE capital_transactions
    let permDenied = false;
    try {
      await client.query(`UPDATE capital_transactions SET amount = 1 WHERE objective_id = $1`, [objId]);
    } catch { permDenied = true; }
    stage("S13 aee_app tanpa UPDATE ledger", permDenied, permDenied ? "permission denied (sesuai DDL)" : "BOLEH — LEAK!");

    // S14 pg-boss roundtrip — antrean = infrastruktur owner-managed (schema pgboss),
    // bukan data domain; worker domain memakai role app saat memproses.
    let bossOk = false; let bossDetail = "";
    const ownerUrl = process.env.DATABASE_URL;
    if (ownerUrl) {
      const boss = new PgBoss({
        connectionString: ownerUrl,
        pollingIntervalSeconds: 1,   // polling cepat utk test (default 2s + interval antrean)
      });
      await boss.start();
      try {
        const q = new PgBossQueue(boss);
        await q.enqueue({ kind: "research", objectiveId: objId, idem: `boss-test:${objId}` });
        bossDetail = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("timeout 10s")), 10_000);
          void boss.work(QUEUE_ADVANCE, async (jobs) => {
            clearTimeout(timer);
            const first = jobs[0] as { data: { kind: string } } | undefined;
            resolve(`received ${first ? first.data.kind : "kosong"}`);
            return true;
          }).catch(reject);
        });
        bossOk = bossDetail.startsWith("received");
      } catch (e) {
        bossDetail = e instanceof Error ? e.message : String(e);
      } finally {
        await boss.stop();
      }
    } else {
      bossDetail = "skip — DATABASE_URL (owner) tidak diset";
    }
    stage("S14 pg-boss roundtrip", bossOk, bossDetail);

    // S15 events audit trail
    const ev = (await client.query<{ n: string }>(
      `SELECT count(*)::text n FROM events WHERE objective_id=$1 AND type='STATE_UPDATED'`, [objId])).rows[0]!;
    stage("S15 events STATE_UPDATED ≥ 10", parseInt(ev.n, 10) >= 10, `n=${ev.n}`);

    // S16 negative: transisi invalid dari state awal baru
    const obj2 = randomUUID();
    await client.query(
      `INSERT INTO objectives (id, user_id, title, target_profit, capital_approved, horizon_months,
         deadline, market, risk_tolerance, autonomy_level, state, current_cycle, environment)
       VALUES ($1,$2,'Verify Negative','2000000.00','10000000.00',12, NULL,'id-digital','moderate',3,
         'OBJECTIVE_CREATED',0,'SIMULATED')`, [obj2, userId]);
    const r16 = await advance(client, obj2, "analyze", deps);
    stage("S16 invalid dari OBJECTIVE_CREATED", !r16.ok && r16.code === "INVALID_TRANSITION", r16.ok ? "harusnya ditolak" : r16.reason);

    // ═══ S21+ INTEGRASI PHASE 8–9 (mission manager + result processor) ═══
    // Objective utama (objId) sudah STOPPED (S11) — pakai obj2 (OBJECTIVE_CREATED).
    // Mock GLM revenue 600000 → tier EVIDENCED saat persist + revenue_claimed 600000,
    // sehingga webhook 500000 (≤ klaim) bisa direkonsiliasi (S25).
    const deps2 = {
      strategic: new MockStrategicAgent(),
      execution: new MockExecutionAgent({ revenue: "600000.00" }),
      queue,
    };
    await advance(client, obj2, "normalize", deps2);
    await advance(client, obj2, "start_research", deps2);
    const cyc2 = (await client.query<{ id: string }>(
      `SELECT id FROM cycles WHERE objective_id=$1 AND status='ACTIVE'`, [obj2])).rows[0]!;
    await runAgentJob(client, { kind: "research", objectiveId: obj2, idem: `research:${cyc2.id}` }, deps2);
    await runAgentJob(client, { kind: "rank_select", objectiveId: obj2, idem: `select:${cyc2.id}` }, deps2);
    await runAgentJob(client, { kind: "design_experiment", objectiveId: obj2, idem: `exp:${cyc2.id}` }, deps2);
    await runAgentJob(client, { kind: "design_mission", objectiveId: obj2, idem: `mission:${cyc2.id}` }, deps2);
    const mission2 = (await client.query<{ id: string }>(
      `SELECT id FROM missions WHERE objective_id=$1 ORDER BY created_at DESC LIMIT 1`, [obj2])).rows[0]!;
    const rDispatch2 = await runAgentJob(client, { kind: "dispatch_glm", objectiveId: obj2, idem: `dispatch:${mission2.id}:1` }, deps2);
    const stD2 = (await client.query<{ state: string }>(`SELECT state FROM objectives WHERE id=$1`, [obj2])).rows[0]!;
    stage("S21 siklus penuh → RESULT_READY", rDispatch2.ok && stD2.state === "RESULT_READY", rDispatch2.detail);
    const interpJob = queue.jobs.find((j) => j.kind === "interpret_results");
    queue.jobs.length = 0; // bersihkan sisa job siklus-1/2 yang terkumpul
    stage("S21b job interpret_results ter-enqueue", !!interpJob,
      interpJob ? `kind=${interpJob.kind} idem=${interpJob.idem}` : "queue kosong");

    // S22 mission-manager interpret_results → T20+T21+T23 ITERATE → T29 → T13 approve
    const r22 = await dispatchJob(client, { kind: "interpret_results", objectiveId: obj2, idem: `interpret:${cyc2.id}` }, deps2);
    const st22 = (await client.query<{ state: string; current_cycle: number }>(
      `SELECT state, current_cycle FROM objectives WHERE id=$1`, [obj2])).rows[0]!;
    stage("S22 interpret_results → ITERATING → MISSION_APPROVED", r22.ok && st22.state === "MISSION_APPROVED", r22.detail ?? (r22 as { reason?: string }).reason);
    const drow = (await client.query<{ decision: string; evidence: string }>(
      `SELECT decision, array_length(evidence_ids, 1)::text AS evidence FROM decisions WHERE objective_id=$1 ORDER BY created_at DESC LIMIT 1`, [obj2])).rows[0];
    stage("S22b decision ITERATE + evidence", !!drow && drow.decision === "ITERATE" && drow.evidence !== "0",
      drow ? `decision=${drow.decision} evidence=${drow.evidence}` : "decision hilang");

    // S23 mission_next re-entry idempoten (state sudah MISSION_APPROVED → skip, tak ada duplikat)
    const r23 = await dispatchJob(client, { kind: "mission_next", objectiveId: obj2, idem: `mnext:${obj2}:c1` }, deps2);
    const st23 = (await client.query<{ state: string }>(`SELECT state FROM objectives WHERE id=$1`, [obj2])).rows[0]!;
    stage("S23 mission_next re-entry idempoten", r23.ok && st23.state === "MISSION_APPROVED",
      `state=${st23.state} detail="${r23.detail ?? (r23 as { reason?: string }).reason}"`);
    const mcount = (await client.query<{ n: string }>(
      `SELECT count(*)::text n FROM missions WHERE objective_id=$1`, [obj2])).rows[0]!;
    const vcount = (await client.query<{ n: string }>(
      `SELECT count(*)::text n FROM mission_versions mv JOIN missions m ON m.id=mv.mission_id WHERE m.objective_id=$1 AND mv.version=2`, [obj2])).rows[0]!;
    stage("S23b mission v2 ada (dibuat S22)", mcount.n === "2" && vcount.n === "1", `missions=${mcount.n} version2=${vcount.n}`);
    const djob = queue.jobs.find((j) => j.kind === "dispatch_glm");
    stage("S23c dispatch_glm(v2) ter-enqueue", !!djob, djob ? `idem=${djob.idem}` : "queue kosong");

    // S24 dispatch v2 → RESULT_READY lagi (siklus-2)
    const missionV2 = (await client.query<{ id: string }>(
      `SELECT id FROM missions WHERE objective_id=$1 ORDER BY created_at DESC LIMIT 1`, [obj2])).rows[0]!;
    const r24 = await runAgentJob(client, { kind: "dispatch_glm", objectiveId: obj2, idem: `dispatch:${missionV2.id}:1` }, deps2);
    const st24 = (await client.query<{ state: string }>(`SELECT state FROM objectives WHERE id=$1`, [obj2])).rows[0]!;
    stage("S24 dispatch v2 → RESULT_READY", r24.ok && st24.state === "RESULT_READY", r24.detail);

    // S25 webhook pembayaran REVENUE utk execution v2 → RECONCILED + ledger + snapshot
    const { processPaymentWebhook } = await import("@aee/orchestrator/result-processor");
    const exec2 = (await client.query<{ id: string; idemKey: string }>(
      `SELECT e.id, e.idempotency_key AS "idemKey" FROM executions e
       JOIN missions m ON m.id = e.mission_id WHERE m.objective_id=$1
       ORDER BY e.started_at DESC NULLS LAST, e.id DESC LIMIT 1`, [obj2])).rows[0]!;
    const whBody = JSON.stringify({
      external_id: exec2.idemKey, amount: "500000.00", kind: "REVENUE", provider: "xendit",
    });
    const whSig = createHmac("sha256", WEBHOOK_SECRET).update(whBody, "utf8").digest("hex");
    const r25 = await processPaymentWebhook(client,
      { external_id: exec2.idemKey, amount: "500000.00", kind: "REVENUE", provider: "xendit" },
      whBody, whSig, WEBHOOK_SECRET);
    stage("S25 webhook REVENUE → RECONCILED", r25.ok, r25.ok ? r25.detail : `${r25.code}: ${r25.detail}`);
    const led25 = (await client.query<{ n: string }>(
      `SELECT count(*)::text n FROM capital_transactions WHERE objective_id=$1 AND amount=500000.00`, [obj2])).rows[0]!;
    stage("S25b ledger REVENUE tertulis", led25.n === "1", `baris=${led25.n}`);
    const snap25 = (await client.query<{ n: string }>(
      `SELECT count(*)::text n FROM economic_snapshots WHERE objective_id=$1`, [obj2])).rows[0]!;
    stage("S25c snapshot ter-update", snap25.n !== "0", `snapshots=${snap25.n}`);

    // S26 tier hasil naik ke RECONCILED pada execution_results (dinaikkan webhook S25)
    const tier26 = (await client.query<{ tier: string }>(
      `SELECT verification_tier AS tier FROM execution_results WHERE execution_id=$1`, [exec2.id])).rows[0];
    stage("S26 tier execution_results = RECONCILED", tier26?.tier === "RECONCILED",
      `tier=${tier26?.tier ?? "hilang"} (dari SELF_REPORTED/EVIDENCED oleh webhook)`);

    // S27 profit dari ledger: webhook 500rb < target 2jt → belum ACHIEVED
    // (bukti guard profit_from_ledger memakai ledger, bukan klaim GLM)
    const r27obj = (await client.query<{ target: string }>(
      `SELECT target_profit::text AS target FROM objectives WHERE id=$1`, [obj2])).rows[0]!;
    const { ledgerFacts } = await import("@aee/orchestrator/result-processor");
    const { computeSnapshot, achievedFromLedger } = await import("@aee/economics");
    const facts27 = await ledgerFacts(client, obj2);
    const snap27 = computeSnapshot(facts27, "10000000.00");
    stage("S27 profit ledger < target → belum ACHIEVED",
      snap27.netProfit === "500000.00" && !achievedFromLedger(snap27.netProfit, r27obj.target),
      `netProfit=${snap27.netProfit} target=${r27obj.target} → achieved=false`);

    // S28 ACHIEVED via ledger: tambah REVENUE hingga ≥ target, lalu interpret_results
    // ulang pada objective v3 (state RESULT_READY) → T37 terjadi.
    // Top-up REVENUE kedua via webhook KEDUA pada execution v2 — klaim 600000 sudah
    // habis oleh webhook pertama (500000) → sisa 100000 saja yang sah ≤ klaim.
    // Untuk mencapai net 2.1jt kita perlu eksekusi dengan klaim lebih besar:
    // INSERT ledger langsung (hak INSERT aee_app, double-entry REVENUE) sbg simulasi
    // pembayaran yang sah secara skema.
    await client.query(
      `INSERT INTO capital_transactions (objective_id, cycle_id, execution_id, idempotency_key,
         debit_account, credit_account, amount, verification_tier, memo)
       VALUES ($1,$2,$3,$4,'CASH','REVENUE',1600000.00,'RECONCILED','webhook top-up S28')`,
      [obj2, cyc2.id, exec2.id, `webhook:${exec2.idemKey}:topup-s28`]);
    const facts28 = await ledgerFacts(client, obj2);
    const snap28 = computeSnapshot(facts28, "10000000.00");
    const r28i = await dispatchJob(client, { kind: "interpret_results", objectiveId: obj2, idem: `interpret:${cyc2.id}:2` }, deps2);
    const st28 = (await client.query<{ state: string }>(`SELECT state FROM objectives WHERE id=$1`, [obj2])).rows[0]!;
    stage("S28 profit ≥ target → ACHIEVED (T37)",
      snap28.netProfit === "2100000.00" && st28.state === "ACHIEVED",
      `netProfit=${snap28.netProfit} state=${st28.state} detail=${r28i.detail ?? (r28i as { reason?: string }).reason}`);

    // S29 stop dari ACHIEVED (terminal) → INVALID_TRANSITION
    const r29 = await advance(client, obj2, "stop_objective", deps);
    stage("S29 ACHIEVED terminal", !r29.ok && r29.code === "INVALID_TRANSITION",
      r29.ok ? "harusnya terminal" : r29.reason);

    // ═══ S30+ INTEGRASI API GATEWAY (Phase 10, §8) ═══
    // Boot fastify port ephemeral; jalur HTTP penuh obj3: create (Idempotency-Key)
    // → start → worker loop → gerbang autonomy 1 → approve via API (T34) → dispatch
    // → RESULT_READY → webhook via HTTP (HMAC) → callback negative → GET reads.
    const { buildApp } = await import("@aee/api");
    const appPool = new Pool({ connectionString: process.env.DATABASE_APP_URL });
    const apiDeps = {
      strategic: new MockStrategicAgent(),
      execution: new MockExecutionAgent({ revenue: "600000.00" }),
      queue: new InMemoryQueue(),
    };
    const app = buildApp({ pool: appPool, deps: apiDeps, webhookSecret: "whsec-verify" });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.addresses()[0]!;
    const base = `http://127.0.0.1:${addr.port}`;
    const H = { "x-user-id": userId, "content-type": "application/json" };
    const iKey = `verify-api-${userId.slice(0, 8)}`;
    const objBody = {
      title: "Obj3 via API", target_profit: "1500000.00",
      capital_approved: "8000000.00", horizon_months: 9, market: "id-saas",
      risk_tolerance: "moderate", autonomy_level: 1,
    };
    try {
      const hc = await fetch(`${base}/health`);
      stage("S30 GET /health", hc.status === 200 && ((await hc.json()) as { status: string }).status === "ok",
        `status=${hc.status}`);

      const r401 = await fetch(`${base}/objectives`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Tanpa sesi", target_profit: "1000000.00",
          capital_approved: "5000000.00", horizon_months: 6, market: "x", risk_tolerance: "low" }),
      });
      stage("S31 POST /objectives tanpa sesi → 401", r401.status === 401,
        `status=${r401.status}`);

      const created = await fetch(`${base}/objectives`, {
        method: "POST", headers: { ...H, "idempotency-key": iKey },
        body: JSON.stringify(objBody),
      });
      const createdBody = await created.json() as { id: string; state: string };
      stage("S32 POST /objectives (owner, Idempotency-Key) → 201",
        created.status === 201 && createdBody.state === "OBJECTIVE_CREATED",
        `status=${created.status} id=${createdBody.id}`);

      const replay = await fetch(`${base}/objectives`, {
        method: "POST", headers: { ...H, "idempotency-key": iKey },
        body: JSON.stringify(objBody),
      });
      const replayBody = await replay.json() as { id: string };
      stage("S32b replay Idempotency-Key sama → 200 + id sama",
        replay.status === 200 && replayBody.id === createdBody.id,
        `status=${replay.status} id=${replayBody.id}`);

      const started = await fetch(`${base}/objectives/${createdBody.id}/start`, {
        method: "POST", headers: H, body: "{}" });
      const startedBody = await started.json() as { cycle_id: string | null };
      stage("S33 POST /objectives/:id/start → cycle_id",
        started.status === 200 && !!startedBody.cycle_id,
        `status=${started.status} cycle=${startedBody.cycle_id}`);

      // worker loop sampai gerbang autonomy 1 → HUMAN_APPROVAL_REQUIRED
      let gateReached = false; let apiState = "";
      for (let i = 0; i < 12 && !gateReached; i++) {
        const job = apiDeps.queue.jobs.shift();
        if (!job) break;
        const c2 = await appPool.connect();
        try {
          const out = await runAgentJob(c2, job, apiDeps);
          if (!out.ok) break;
          const st = (await c2.query<{ state: string }>(
            `SELECT state FROM objectives WHERE id=$1`, [createdBody.id])).rows[0];
          apiState = st?.state ?? "";
          gateReached = apiState === "HUMAN_APPROVAL_REQUIRED";
        } finally { c2.release(); }
      }
      stage("S34 worker loop sampai gerbang", gateReached, `state=${apiState}`);

      if (gateReached) {
        const apRow = (await client.query<{ id: string }>(
          `SELECT id FROM approvals WHERE objective_id=$1 AND status='PENDING' ORDER BY created_at DESC LIMIT 1`,
          [createdBody.id])).rows[0];
        const appr = await fetch(`${base}/approvals/${apRow!.id}/approve`, {
          method: "POST", headers: H, body: JSON.stringify({ note: "lanjut" }) });
        const apprBody = await appr.json() as { status: string; resumed_to: string };
        stage("S35 POST /approvals/:id/approve (T34 resume)",
          appr.status === 200 && apprBody.status === "APPROVED",
          `status=${appr.status} resumed_to=${apprBody.resumed_to}`);

        // Worker loop lanjutan: dispatch_glm (mission v1 autonomy-1 post-approve)
        // → RESULT_READY kedua (hasil eksekusi); lalu interpret_results → mission v2
        // (autonomy 1 → gate lagi → sudah pernah di-approve → kita berhenti di gerbang
        // kedua ATAU RESULT_READY). Target stage: execution tercipta.
        let execCreated = false;
        for (let i = 0; i < 16 && !execCreated; i++) {
          const job = apiDeps.queue.jobs.shift();
          if (!job) break;
          const c2 = await appPool.connect();
          try {
            const { dispatchJob } = await import("@aee/orchestrator/mission-manager");
            const out = job.kind === "interpret_results" || job.kind === "mission_next"
              ? await dispatchJob(c2, job as { kind: "interpret_results" | "mission_next";
                  objectiveId: string; idem: string }, apiDeps)
              : await runAgentJob(c2, job, apiDeps);
            if (!out.ok) break;
            const n = (await c2.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM executions e
               JOIN missions m ON m.id=e.mission_id WHERE m.objective_id=$1`,
              [createdBody.id])).rows[0];
            execCreated = (n?.n ?? "0") !== "0";
            const st = (await c2.query<{ state: string }>(
              `SELECT state FROM objectives WHERE id=$1`, [createdBody.id])).rows[0];
            apiState = st?.state ?? "";
          } finally { c2.release(); }
        }
        stage("S36 resume → dispatch → execution tercipta", execCreated,
          `state=${apiState}`);

        const ex3 = (await client.query<{ id: string; idemKey: string }>(
          `SELECT e.id, e.idempotency_key AS "idemKey" FROM executions e
           JOIN missions m ON m.id = e.mission_id WHERE m.objective_id=$1
           ORDER BY e.started_at DESC NULLS LAST LIMIT 1`, [createdBody.id])).rows[0];
        if (ex3) {
          const whBody = JSON.stringify({
            external_id: ex3.idemKey, amount: "300000.00", kind: "REVENUE", provider: "xendit" });
          const sig = createHmac("sha256", "whsec-verify").update(whBody).digest("hex");
          const wh = await fetch(`${base}/webhooks/payments/xendit`, {
            method: "POST", headers: { "content-type": "application/json", "x-signature": sig },
            body: whBody });
          const whJson = await wh.json() as { received: boolean; code: string };
          stage("S37 POST /webhooks/payments/:provider (HMAC) → received",
            wh.status === 200 && whJson.received === true,
            `status=${wh.status} code=${whJson.code}`);
          const tier3 = (await client.query<{ tier: string }>(
            `SELECT verification_tier AS tier FROM execution_results WHERE execution_id=$1`,
            [ex3.id])).rows[0];
          stage("S37b tier hasil obj3 = RECONCILED (via HTTP)",
            tier3?.tier === "RECONCILED", `tier=${tier3?.tier}`);

          const whBad = await fetch(`${base}/webhooks/payments/xendit`, {
            method: "POST", headers: { "content-type": "application/json", "x-signature": "bad" },
            body: whBody });
          stage("S37c webhook HMAC salah → 401", whBad.status === 401, `status=${whBad.status}`);
        } else {
          stage("S37 webhook obj3", false, "execution obj3 tidak ditemukan");
        }

        const cb403 = await fetch(`${base}/executions/00000000-0000-4000-8000-000000000001/result`, {
          method: "POST", headers: H, body: JSON.stringify({}) });
        stage("S38 callback GLM role owner → 403", cb403.status === 403,
          `status=${cb403.status}`);
      }

      const reads = await fetch(`${base}/objectives/${createdBody.id}`, { headers: H });
      const readsBody = await reads.json() as {
        objective: { id: string }; snapshot: unknown;
      };
      stage("S39 GET /objectives/:id + snapshot",
        reads.status === 200 && readsBody.objective?.id === createdBody.id,
        `status=${reads.status} snapshot=${readsBody.snapshot ? "ada" : "null"}`);
    // ══════════ PHASE 12–14: worker process nyata (pg-boss) + dashboard ══════════
    // S40 — worker nyata: pg-boss boss (superuser URL) + konsumsi antrean `advance`
    //      untuk obj4; worker harus memproses job tanpa driver manual.
    {
      const { startWorker } = await import("../apps/worker/src/index.js");
      const { PgBossQueue } = await import("@aee/orchestrator/runtime");
      const pgBossCtor = (await import("pg-boss")).default;

      const adminUrl = process.env.DATABASE_URL ?? "";
      const boss = new pgBossCtor({ connectionString: adminUrl }) as never;

      // Obj4 via API dengan worker aktif (autonomy 3 — tanpa gerbang manusia).
      const userId4 = randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES ($1,$2,'x','owner')`,
        [userId4, `verify-s40-${userId4.slice(0, 8)}@local.test`]);

      const bossQueue = new PgBossQueue(boss as never);
      const workerDeps = {
        strategic: new MockStrategicAgent(),
        execution: new MockExecutionAgent({ revenue: "600000.00" }),
        queue: bossQueue,
      };
      const worker = await startWorker({
        appUrl: APP_URL, adminUrl: adminUrl, boss: boss as never,
        deps: workerDeps as never, logger: () => {},
      });

      // App kedua dengan queue = PgBossQueue: enqueue API masuk pg-boss,
      // worker nyata satu-satunya konsumen (fase S30–S39 memakai InMemoryQueue
      // karena konsumennya adalah loop manual verify).
      const apiPool4 = new Pool({ connectionString: APP_URL });
      const app4 = buildApp({ pool: apiPool4, deps: { ...apiDeps, queue: bossQueue }, webhookSecret: "whsec-verify" });
      await app4.listen({ port: 0, host: "127.0.0.1" });
      const base4 = `http://127.0.0.1:${app4.addresses()[0]!.port}`;

      const H4 = { "x-user-id": userId4, "content-type": "application/json" };
      const obj4Body = {
        title: "Obj worker E2E", target_profit: "1500000.00", capital_approved: "8000000.00",
        horizon_months: 9, market: "id-saas", risk_tolerance: "moderate", autonomy_level: 3,
      };
      const create4 = await fetch(`${base4}/objectives`, {
        method: "POST", headers: { ...H4, "idempotency-key": `s40-${userId4.slice(0, 8)}` },
        body: JSON.stringify(obj4Body) });
      const obj4 = (await create4.json()) as { id: string };
      const start4 = await fetch(`${base4}/objectives/${obj4.id}/start`, {
        method: "POST", headers: H4, body: "{}" });
      stage("S40 obj4 create+start (autonomy 3, worker aktif)",
        create4.status === 201 && start4.status === 200,
        `create=${create4.status} start=${start4.status}`);

      // Tunggu worker: autonomy 3 → siklus penuh tanpa intervensi manusia.
      // Berhenti saat gerbang/terminal atau timeout 30s.
      let finalState4 = "";
      const t0 = Date.now();
      while (Date.now() - t0 < 30_000) {
        const st = (await client.query<{ state: string }>(
          `SELECT state FROM objectives WHERE id=$1`, [obj4.id])).rows[0];
        finalState4 = st?.state ?? "";
        if (finalState4 === "HUMAN_APPROVAL_REQUIRED" || finalState4 === "ACHIEVED"
          || finalState4 === "BLOCKED" || finalState4 === "STOPPED") break;
        await new Promise((r) => setTimeout(r, 300));
      }
      const wstats = worker.stats();
      stage("S40b worker memproses antrean (pg-boss nyata) → autonomy-3 berjalan",
        wstats.processed >= 4 && finalState4 !== "",
        `processed=${wstats.processed} failed=${wstats.failed} state=${finalState4}`);

      // S41 — idempotensi worker: job `research` duplikat saat obj4 sudah jauh
      // melampaui riset TIDAK BOLEH menghasilkan transisi baru yang mundur ke
      // jalur riset. Bukti lineage: hitung event OPPORTUNITIES_RANKED obj4 —
      // harus tetap 1 (siklus riset hanya sekali) walau job duplikat masuk,
      // dan state setelahnya tetap fase eksekusi/iterasi (>= DESIGNING secara
      // urutan siklus; regresi = kembali ke RESEARCHING/ANALYZING).
      const evBefore = (await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM events WHERE objective_id=$1 AND type='OPPORTUNITIES_RANKED'`,
        [obj4.id])).rows[0]?.n;
      await bossQueue.enqueue({ kind: "research", objectiveId: obj4.id, idem: `verify-dup-${obj4.id}-1` });
      await new Promise((r) => setTimeout(r, 2000));
      const evAfter = (await client.query<{ n: string; state: string }>(
        `SELECT (SELECT count(*)::text FROM events WHERE objective_id=$1 AND type='OPPORTUNITIES_RANKED') AS n,
                (SELECT state FROM objectives WHERE id=$1) AS state`,
        [obj4.id])).rows[0];
      const regressed = ["RESEARCHING", "ANALYZING"].includes(evAfter?.state ?? "");
      stage("S41 job duplikat research → idempoten (tanpa transisi riset baru)",
        evAfter?.n === evBefore && !regressed,
        `events=${evBefore}→${evAfter?.n} state=${evAfter?.state} processed=${worker.stats().processed}`);

      // S42 — dashboard HTML tersaji via API.
      const dash = await fetch(`${base4}/`);
      const dashBody = await dash.text();
      stage("S42 GET / dashboard §36",
        dash.status === 200 && dashBody.includes("Economic Control Center"),
        `status=${dash.status} len=${dashBody.length}`);

      // S43 — GET /objectives list (worker-produced obj4 terlihat).
      const list = await fetch(`${base4}/objectives`, { headers: H4 });
      const listBody = (await list.json()) as { objectives: Array<{ id: string; state: string }> };
      const found4 = listBody.objectives?.some((o) => o.id === obj4.id);
      stage("S43 GET /objectives list memuat obj4",
        list.status === 200 && found4 === true,
        `status=${list.status} n=${listBody.objectives?.length}`);

      // S44 — dev seed-user idempoten (demo §36 dashboard self-bootstrap).
      const suid = randomUUID();
      const s1 = await fetch(`${base4}/dev/seed-user`, {
        method: "POST", headers: { "x-user-id": suid, "content-type": "application/json" }, body: "{}" });
      const s2 = await fetch(`${base4}/dev/seed-user`, {
        method: "POST", headers: { "x-user-id": suid, "content-type": "application/json" }, body: "{}" });
      const su2 = (await s2.json()) as { user?: { role: string } };
      stage("S44 POST /dev/seed-user idempoten → owner",
        s1.status === 200 && s2.status === 200 && su2.user?.role === "owner",
        `s1=${s1.status} s2=${s2.status} role=${su2.user?.role}`);

      const wsFinal = worker.stats();
      stage("S44b worker stats final — tanpa crash",
        wsFinal.processed >= 1, `processed=${wsFinal.processed} failed=${wsFinal.failed}`);
      await worker.stop();
      await app4.close();
      await apiPool4.end();
    }

    } finally {
      await app.close();
      await appPool.end();
    }

    console.log(`\nHASIL: ${passed} lulus / ${failed} gagal`);
    if (failed > 0) process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((e: unknown) => { console.error("FATAL", e); process.exit(1); });
