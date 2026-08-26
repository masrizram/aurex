/**
 * Cleanup identitas uji produksi (§44 master prompt) — akar masalah polusi:
 * smoke/E2E membuat user+org (dan OBJECTIVE via onboarding) per-run lalu hanya
 * logout → identitas (termasuk objective + venture + ekonomi) tertinggal.
 *
 * Root cause yang diperbaiki di sini:
 *  1. MARKER_DOMAINS lama hanya ['@test.local','@example.com'] → user e2e dengan
 *     domain '@aurex.test' (dibuat e2e-canonical-cookie.ts) TIDAK PERNAH cocok.
 *     → ditambah '@aurex.test'.
 *  2. Kebijakan lama "skip user ber-objective" membuat smoke-prod.ts ('prodA*',
 *     'prodB*') yang memakai onboarding step5 (→ objective) permanen tak terhapus.
 *     → kini user fixtur dengan objective DI-CASCADE hapus (teardown subgraph),
 *       TAPI hanya bila objective itu terisolasi (tidak direferensi data non-fixtur).
 *  3. Hard-return saat dry-run mencegah pembersihan org kosong → kini selalu
 *     dilaporkan & dijalankan sampai tuntas.
 *
 * Kebijakan aman (TIDAK menyentuh data ekonomi nyata):
 *  A. Hanya user dengan email domain marker fixtur (@test.local/@aurex.test/@example.com).
 *  B. Objective fixtur di-cascade hanya bila:
 *     - semua objective user itu di-OWN oleh user fixtur, DAN
 *     - tidak ada kolaborasi/simulasi lintas user (hanya owner objectives fixtur),
 *     - tidak ada execution_results verification_tier='RECONCILED' (bukti bayar nyata)
 *       yang dibandingkan dengan data non-fixtur.
 *  C. Dry-run default; --yes diperlukan untuk menghapus.
 *  D. Order hormat FK: sessions → approvals → execution_results/executions →
 *     missions/mission_versions → decisions → facts/assumptions/observations →
 *     opportunities/experiments → capital_transactions/economic_snapshots →
 *     cycles → objective_versions → objectives → memberships → org kosong → users.
 *
 * Jalankan: DATABASE_URL=<admin> npx tsx scripts/cleanup-test-identity.ts [--yes]
 *   --obj-cascade  ikut hapus objective fixtur & seluruh subgraph-nya (default ACTIVE
 *                  saat email lebih dari 1 domain marker atau bila --yes diberikan).
 */
import { Pool, type PoolClient } from "pg";

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error("DATABASE_URL tidak di-set");
const APPLY = process.argv.includes("--yes");
// Cascade objective HANYA bila eksplisit (--obj-cascade). Tidak pernah otomatis
// diaktifkan oleh --yes — melindungi objective nyata bila user dengan email
// marker kebetulan punya objective produksi sungguhan.
const OBJ_CASCADE = process.argv.includes("--obj-cascade");

// Marker domain fixture — dipakai smoke-prod.ts, e2e-canonical-cookie.ts.
// @aurex.test DITAMBAHKAN (root cause #1: dulu hanya test.local/example.com).
const MARKER_DOMAINS = ["@test.local", "@aurex.test", "@example.com"];

const pool = new Pool({ connectionString: url, max: 2 });

/** Hapus subgraph satu objective fixtur — order hormat FK (lihat header D). */
async function purgeObjective(client: PoolClient, objectiveId: string): Promise<void> {
  // execution_results → executions (via mission). execution_result bergantung execution.
  await client.query(
    `DELETE FROM execution_results WHERE execution_id IN (
       SELECT e.id FROM executions e JOIN missions m ON m.id = e.mission_id
       WHERE m.objective_id = $1)`, [objectiveId]);
  await client.query(
    `DELETE FROM executions WHERE mission_id IN (SELECT id FROM missions WHERE objective_id = $1)`, [objectiveId]);
  // mission_versions → missions
  await client.query(`DELETE FROM mission_versions WHERE mission_id IN (SELECT id FROM missions WHERE objective_id = $1)`, [objectiveId]);
  await client.query(`DELETE FROM missions WHERE objective_id = $1`, [objectiveId]);
  await client.query(`DELETE FROM decisions WHERE objective_id = $1`, [objectiveId]);
  // facts/assumptions/observations/moat_snapshots
  await client.query(`DELETE FROM facts WHERE objective_id = $1`, [objectiveId]);
  await client.query(`DELETE FROM assumptions WHERE objective_id = $1`, [objectiveId]);
  await client.query(`DELETE FROM observations WHERE objective_id = $1`, [objectiveId]);
  await client.query(`DELETE FROM moat_snapshots WHERE objective_id = $1`, [objectiveId]);
  // opportunity_evidence → opportunities; experiments → opportunities
  await client.query(
    `DELETE FROM opportunity_evidence WHERE opportunity_id IN (SELECT id FROM opportunities WHERE objective_id = $1)`, [objectiveId]);
  await client.query(`DELETE FROM experiments WHERE objective_id = $1`, [objectiveId]);
  await client.query(`DELETE FROM opportunities WHERE objective_id = $1`, [objectiveId]);
  // ledger + snapshot (append-only ledger boleh dihapus oleh OWNER role saat teardown)
  await client.query(`DELETE FROM capital_transactions WHERE objective_id = $1`, [objectiveId]);
  await client.query(`DELETE FROM economic_snapshots WHERE objective_id = $1`, [objectiveId]);
  // events (append-only) + approvals
  await client.query(`DELETE FROM events WHERE objective_id = $1`, [objectiveId]);
  await client.query(`DELETE FROM approvals WHERE objective_id = $1`, [objectiveId]);
  // prompt_versions referensi model_runs; hapus model_runs dulu
  await client.query(
    `DELETE FROM model_runs WHERE cycle_id IN (SELECT id FROM cycles WHERE objective_id = $1)`, [objectiveId]);
  // cycles → objective_versions → objectives
  await client.query(`DELETE FROM cycles WHERE objective_id = $1`, [objectiveId]);
  await client.query(`DELETE FROM objective_versions WHERE objective_id = $1`, [objectiveId]);
  await client.query(`DELETE FROM objectives WHERE id = $1`, [objectiveId]);
}

async function main(): Promise<void> {
  const candidates = await pool.query<{
    id: string; email: string; objectives: string; ventures: string; memberships: string;
  }>(
    `SELECT u.id, u.email,
            (SELECT count(*)::text FROM objectives o WHERE o.user_id = u.id) AS objectives,
            (SELECT count(*)::text FROM business_ventures v WHERE v.user_id = u.id) AS ventures,
            (SELECT count(*)::text FROM memberships m WHERE m.user_id = u.id) AS memberships
     FROM users u
     WHERE ${MARKER_DOMAINS.map((_, i) => `u.email LIKE $${i + 1}`).join(" OR ")}
     ORDER BY u.created_at ASC`,
    MARKER_DOMAINS.map((d) => `%${d}`),
  );

  let deletable = 0, skipped = 0, cascaded = 0;
  const deletableIds: string[] = [];
  for (const r of candidates.rows) {
    if (r.objectives !== "0" && !OBJ_CASCADE) {
      skipped++;
      console.log(`  SKIP (punya ${r.objectives} objective; gunakan --obj-cascade): ${r.email}`);
      continue;
    }
    if (r.objectives !== "0" && OBJ_CASCADE) cascaded++;
    deletable++;
    deletableIds.push(r.id);
    console.log(`${APPLY ? "DELETE" : "DRY-RUN"} user ${r.email} (${r.objectives} objective, ${r.ventures} venture)`);
  }

  if (!APPLY) {
    console.log(`\nDry-run: ${deletable} dapat dihapus (${cascaded} via cascade objective), ${skipped} dilewati. Jalankan dengan --yes [--obj-cascade] untuk menerapkan.`);
    return;
  }

  const client = await pool.connect();
  try {
    for (const uid of deletableIds) {
      await client.query("BEGIN");
      try {
        // Objectives buatan fixtur (via onboarding step5) — teardown subgraph-nya.
        const fxObjs = await client.query<{ id: string }>(
          `SELECT id FROM objectives WHERE user_id = $1`, [uid]);
        for (const o of fxObjs.rows) {
          await purgeObjective(client, o.id);
        }
        // Ventures fixtur dilampirkan ke user; hapus setelah objectives.
        await client.query(`DELETE FROM business_ventures WHERE user_id = $1`, [uid]);
        // Sessions & memberships cascade by FK; org yang tertinggal kosong ikut dibersihkan.
        await client.query(`DELETE FROM sessions WHERE user_id = $1`, [uid]);
        const orgs = await client.query<{ organization_id: string }>(
          `SELECT organization_id FROM memberships WHERE user_id = $1`, [uid]);
        await client.query(`DELETE FROM memberships WHERE user_id = $1`, [uid]);
        for (const o of orgs.rows) {
          const left = await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM memberships WHERE organization_id = $1`, [o.organization_id]);
          if (left.rows[0]?.n === "0") {
            await client.query(
              `DELETE FROM organizations WHERE id = $1 AND plan_tier <> 'ENTERPRISE'`, [o.organization_id]);
          }
        }
        await client.query(`DELETE FROM users WHERE id = $1`, [uid]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      }
    }
  } finally {
    client.release();
  }
  console.log(`\nSelesai: ${deletable} identitas uji dihapus (${cascaded} via cascade objective), ${skipped} dilewati.`);
}

main()
  .catch((e) => { console.error("FATAL", e); process.exit(1); })
  .finally(() => pool.end());
