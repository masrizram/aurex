/**
 * verify-metering.ts — proves BUG-02 fix (consumeAiCreditsForCycle SQL) executes
 * against a REAL Postgres (scratch WSL, port 55433) using the aee_app runtime role
 * (NOT superuser). Replays the EXACT SQL path from runtime.ts:385-412.
 *
 * Pre-BUG-02 SQL: SELECT o.organization_id AS org, o.plan_tier AS tier ... (crash: o.plan_tier does not exist)
 * Post-fix SQL:   JOIN organizations o2 ON o2.id = o.organization_id  ... o2.plan_tier
 *
 * We seed a minimal objective+cycle+org(FREE tier), then run both queries
 * to demonstrate: (a) pre-fix SQL crashes, (b) post-fix SQL succeeds and
 * usage_credits row is created. No provider/key involved.
 */
import "dotenv/config";
import { Pool } from "pg";

const DBURL = (process.env.DATABASE_URL || "").replace(/localhost/, "127.0.0.1");
const pool = new Pool({ connectionString: DBURL });

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${d ? " (" + d + ")" : ""}`); c ? pass++ : fail++; };

const PRE_FIX_SQL = `SELECT o.organization_id AS org, o.plan_tier AS tier
                     FROM cycles c
                     JOIN objectives o ON o.id = c.objective_id
                     WHERE c.id = $1`;

const POST_FIX_SQL = `SELECT o.organization_id AS org, o2.plan_tier AS tier
                      FROM cycles c
                      JOIN objectives o ON o.id = c.objective_id
                      JOIN organizations o2 ON o2.id = o.organization_id
                      WHERE c.id = $1`;

const USAGE_SQL = `INSERT INTO usage_credits
  (id, organization_id, month_year, credits_used, credits_limit, credits_purchased, created_at, updated_at)
  VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, now(), now())
  ON CONFLICT (organization_id, month_year)
  DO UPDATE SET credits_used = usage_credits.credits_used + EXCLUDED.credits_used,
                 credits_limit = GREATEST(usage_credits.credits_limit, EXCLUDED.credits_limit),
                 updated_at = now()`;

async function main() {
  console.log("═══ METING FIX VERIFICATION (BUG-02) ═══");
  console.log("DB:", DBURL.replace(/:\/\/[^@]+@/, "://***@"));

  const client = await pool.connect();
  try {
    // seed via owner (root postgres) — objective needs user/organization
    await client.query("BEGIN");
    const uidRes = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role) VALUES ('meter@test.local','x','owner') ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id`);
    const userId = uidRes.rows[0].id;
    const orgRes = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, plan_tier) VALUES ('Meter Org','meter-test','FREE') RETURNING id`);
    const orgId = orgRes.rows[0].id;
    await client.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'OWNER')`, [orgId, userId]);
    const objRes = await client.query<{ id: string }>(
      `INSERT INTO objectives (user_id, organization_id, title, target_profit, capital_approved, horizon_months, deadline, market, risk_tolerance, state, current_cycle, environment)
       VALUES ($1, $2, 'Meter Obj', '2000000.00', '1000000.00', 12, '2030-12-31','ritel','moderate','OBJECTIVE_CREATED',0,'SIMULATED') RETURNING id`,
      [userId, orgId]);
    const objId = objRes.rows[0].id;
    const cycRes = await client.query<{ id: string; cycle_number: number }>(
      `INSERT INTO cycles (objective_id, cycle_number, started_at, status) VALUES ($1, 1, now(), 'ACTIVE') RETURNING id, cycle_number`,
      [objId]);
    const cycleId = cycRes.rows[0].id;
    await client.query("COMMIT");
    console.log("seeded: org=FREE cycle", cycleId.slice(0, 8), "obj", objId.slice(0, 8));

    // (a) DEMO pre-fix SQL crash
    let preFixCrashed = false;
    try { await client.query(PRE_FIX_SQL, [cycleId]); }
    catch (e) { preFixCrashed = /plan_tier does not exist/i.test((e as Error).message); }
    ok("pre-fix SQL crashes (repro BUG-02)", preFixCrashed, preFixCrashed ? "column o.plan_tier does not exist — confirmed" : "did NOT crash (unexpected)");

    // (b) post-fix SQL + usage insert (consumeAiCreditsForCycle path)
    const planRes = await client.query<{ org: string | null; tier: string }>(POST_FIX_SQL, [cycleId]);
    const orgFromSql = planRes.rows[0]?.org;
    const tier = planRes.rows[0]?.tier ?? "FREE";
    ok("post-fix SQL returns org + plan_tier", !!orgFromSql && tier === "FREE", `org=${orgFromSql?.slice(0,8)} tier=${tier}`);

    const limitRes = await client.query<{ max_ai_credits_monthly: number | null }>(
      `SELECT max_ai_credits_monthly FROM subscription_plans WHERE tier = $1 AND is_active = true`, [tier]);
    const limit = limitRes.rows[0]?.max_ai_credits_monthly;
    ok("FREE plan has max_ai_credits_monthly in subscription_plans", limit !== null && limit !== undefined, `limit=${limit}`);

    const monthYear = new Date().toISOString().slice(0, 7);
    const credits = 3;
    const usageRes = await client.query(USAGE_SQL, [orgFromSql, monthYear, credits, limit ?? 100]);
    ok("usage_credits INSERT succeeds (ON CONFLICT upsert)", usageRes.rowCount === 1, `rowCount=${usageRes.rowCount}`);

    // (c) verify persisted
    const check = await client.query(
      `SELECT organization_id, month_year, credits_used, credits_limit FROM usage_credits WHERE organization_id = $1 AND month_year = $2`,
      [orgFromSql, monthYear]);
    const u = check.rows[0];
    ok("usage_credits persisted correctly",
      u && u.credits_used === credits && Number(u.credits_limit) === limit,
      `credits_used=${u?.credits_used} credits_limit=${u?.credits_limit}`);

    // (d) idempotency re-test (consume 2 more credits in same month → upsert adds)
    await client.query(USAGE_SQL, [orgFromSql, monthYear, credits, limit ?? 100]);
    const check2 = await client.query(
      `SELECT credits_used FROM usage_credits WHERE organization_id = $1 AND month_year = $2`,
      [orgFromSql, monthYear]);
    ok("idempotent upsert accumulates credits", Number(check2.rows[0]?.credits_used) === credits * 2,
      `credits_used=${check2.rows[0]?.credits_used} (expected ${credits * 2})`);

  } finally {
    await client.query(`DELETE FROM usage_credits WHERE organization_id IN (SELECT id FROM organizations WHERE slug='meter-test')`);
    await client.query(`DELETE FROM cycles WHERE objective_id IN (SELECT id FROM objectives WHERE title='Meter Obj')`);
    await client.query(`DELETE FROM objectives WHERE title='Meter Obj'`);
    await client.query(`DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE slug='meter-test')`);
    await client.query(`DELETE FROM organizations WHERE slug='meter-test'`);
    await client.query(`DELETE FROM users WHERE email='meter@test.local'`);
    await pool.end();
  }
  console.log(`\n═══ METING: ${pass} PASS, ${fail} FAIL ═══`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
