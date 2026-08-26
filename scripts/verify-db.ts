/**
 * Verifikasi empiris scaffold vs Postgres asli (container scratch WSL, port 55432).
 * Jalankan: npx tsx scripts/verify-db.ts
 * Output: JSON satu baris per tahap → stdout; exit ≠ 0 bila ada tahap gagal.
 */
import "dotenv/config";
import { Pool } from "pg";
import { ownerPool } from "../packages/db/src/index.js";

interface StepResult { step: string; ok: boolean; detail: string }

const results: StepResult[] = [];
function record(step: string, ok: boolean, detail: string): void {
  results.push({ step, ok, detail });
  console.log(JSON.stringify({ step, ok, detail }));
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tidak di-set");
  const owner = ownerPool(url);

  // S1: katalog pasca-migrasi (10 migrasi: core+grants+venture+tenancy+auth
  // +onboarding_fixes+goal_type+auth_lifecycle+capital_zero+billing = 35 tabel)
  const cat = await owner.query<{ n: string }>(`
    SELECT count(*)::text AS n FROM pg_tables
    WHERE schemaname='public' AND tablename NOT IN ('schema_migrations')`);
  record("S1_table_count", cat.rows[0]?.n === "34", `tabel (tanpa schema_migrations) = ${cat.rows[0]?.n}, ekspektasi 34`);

  // S2: migration tercatat (10 file: 001..010)
  const mig = await owner.query<{ name: string; sha256: string }>(
    "SELECT name, sha256 FROM schema_migrations ORDER BY name");
  const EXPECTED_MIGRATIONS = [
    "001_core_schema.sql",
    "002_orchestrator_grants.sql",
    "003_business_venture.sql",
    "004_multi_tenancy.sql",
    "005_auth_onboarding.sql",
    "006_onboarding_fixes.sql",
    "007_objective_goal_type.sql",
    "008_auth_lifecycle.sql",
    "009_objectives_capital_zero.sql",
    "010_billing_duitku.sql",
  ];
  const migOk =
    mig.rowCount === EXPECTED_MIGRATIONS.length &&
    EXPECTED_MIGRATIONS.every((name, i) => mig.rows[i]?.name === name);
  record("S2_migration_recorded", migOk,
    `${mig.rows.map((r) => `${r.name}:${r.sha256.slice(0, 16)}`).join(",")}`);

  // S3: katalog integritas (CHECK & trigger dari audit run-4)
  const checks = await owner.query<{ tbl: string; n: string }>(`
    SELECT c.relname AS tbl, count(*)::text AS n
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    WHERE k.contype='c' AND c.relnamespace='public'::regnamespace
      AND c.relname IN ('capital_transactions','objectives','decisions','execution_results','assumptions')
    GROUP BY c.relname ORDER BY c.relname`);
  const checkMap = new Map(checks.rows.map((r) => [r.tbl, r.n]));
  const expChecks: Record<string, string> = {
    // Terkonfirmasi dari katalog live + file DDL (urut sesuai query):
    // objectives 9 (+1 dari 003 business_mode CHECK), capital_transactions 5, decisions 3, execution_results 1, assumptions 2
    assumptions: "2", capital_transactions: "5", decisions: "3", execution_results: "1", objectives: "9",
  };
  const checkOk = Object.entries(expChecks).every(([t, n]) => checkMap.get(t) === n);
  record("S3_check_catalog", checkOk,
    `CHECK per tabel: ${[...checkMap.entries()].map(([t, n]) => `${t}=${n}`).join(" ")} (ekspektasi ${Object.entries(expChecks).map(([t, n]) => `${t}=${n}`).join(" ")})`);

  const trg = await owner.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM pg_trigger WHERE NOT tgisinternal");
  record("S4_triggers", trg.rows[0]?.n === "6", `trigger user-defined = ${trg.rows[0]?.n}, ekspektasi 6`);

  // S5: role aee_app ada — Phase 6: LOGIN diaktifkan oleh pipeline (runtime orchestrator)
  const role = await owner.query<{ rolcanlogin: boolean }>(
    "SELECT rolcanlogin FROM pg_roles WHERE rolname='aee_app'");
  record("S5_role_aee_app", role.rowCount === 1 && role.rows[0]?.rolcanlogin === true,
    `aee_app ada=${role.rowCount === 1}, LOGIN=${role.rows[0]?.rolcanlogin === true} (Phase 6: runtime login aktif)`);

  // S6: login runtime (member aee_app) — buat ulang idempoten
  await owner.query("DROP ROLE IF EXISTS aee_runtime");
  await owner.query("CREATE ROLE aee_runtime LOGIN PASSWORD 'runtime_pw'");
  await owner.query("GRANT aee_app TO aee_runtime");
  // USAGE pada schema public (Postgres 15+ revoke default)
  await owner.query("GRANT USAGE ON SCHEMA public TO aee_app");

  // S6: runtime INSERT legal — koneksi sebagai aee_runtime (member aee_app)
  const appUrl = (process.env.DATABASE_URL ?? "").replace(/\/\/([^:]+):([^@]+)@/, "//aee_runtime:runtime_pw@");
  const app2 = new Pool({ connectionString: appUrl });

  const user = await owner.query<{ id: string }>(
    "INSERT INTO users (email, password_hash, role) VALUES ('verify@aee.local','x','owner') ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id");
  const userId = user.rows[0]?.id ?? "";

  // runtime harus bisa INSERT event & SELECT, TIDAK bisa UPDATE ledger
  try {
    const ins = await app2.query(
      "INSERT INTO events (objective_id, cycle_id, type, payload, correlation_id) VALUES (NULL,NULL,'VERIFY_SCAFFOLD',$1::jsonb,gen_random_uuid())",
      [JSON.stringify({ hello: "scaffold" })]);
    record("S6_runtime_insert_events", ins.rowCount === 1, "INSERT events sebagai aee_runtime OK");
  } catch (e) {
    record("S6_runtime_insert_events", false, String(e instanceof Error ? e.message : e));
  }
  try {
    const sel = await app2.query("SELECT count(*)::int AS n FROM events");
    record("S7_runtime_select", (sel.rows[0]?.n ?? 0) >= 1, `SELECT events = ${sel.rows[0]?.n} baris`);
  } catch (e) {
    record("S7_runtime_select", false, String(e instanceof Error ? e.message : e));
  }

  // owner menulis satu baris ledger utk uji tolak-UPDATE runtime
  const obj = await owner.query<{ id: string }>(
    `INSERT INTO objectives (user_id,title,target_profit,capital_approved,horizon_months,deadline,market,risk_tolerance)
     VALUES ($1,'verify','100000000.00','10000000.00',12,'2027-08-22','Indonesia','moderate') RETURNING id`, [userId]);
  const objId = obj.rows[0]?.id ?? "";
  await owner.query(
    `INSERT INTO capital_transactions (objective_id,idempotency_key,debit_account,credit_account,amount,verification_tier)
     VALUES ($1,'verify-txn-1','CASH','CAPITAL_DEPLOYED','1000000.00','VERIFIED')
     ON CONFLICT (idempotency_key) DO NOTHING`, [objId]);

  try {
    await app2.query("UPDATE capital_transactions SET amount='999.00'");
    record("S8_runtime_update_ledger_DENIED", false, "UPDATE ledger sebagai runtime TIDAK ditolak — GAGAL");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    record("S8_runtime_update_ledger_DENIED", /permission denied/i.test(msg), `ditolak: ${msg.slice(0, 80)}`);
  }
  await app2.end().catch(() => {});

  // S9: cleanup verify rows (events/ledger tak bisa dihapus — biarkan; ini container scratch)
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ SUMMARY: { total: results.length, passed: results.length - failed.length, failed: failed.length } }));
  await owner.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error("FATAL", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
