/**
 * Cleanup identitas uji produksi (§44 master prompt) — akar masalah polusi:
 * smoke/E2E membuat user+org baru per-run dan hanya logout (identitas tetap).
 *
 * Kebijakan aman (TIDAK menyentuh data ekonomi nyata):
 *  1. Hanya user dengan email domain @test.local / @example.com (marker fixture).
 *  2. Hanya user TANPA objectives sama sekali (tidak ada riwayat ekonomi/audit
 *     yang bermakna). User ber-objective = senggol saja → dilewati, dilaporkan.
 *  3. Dry-run default: --yes diperlukan untuk benar-benar menghapus.
 *  4. Order penghapusan hormat FK: sessions → memberships → org kosong → users.
 *
 * Jalankan: DATABASE_URL=<admin> npx tsx scripts/cleanup-test-identity.ts [--yes]
 */
import { Pool } from "pg";

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error("DATABASE_URL tidak di-set");
const APPLY = process.argv.includes("--yes");

const pool = new Pool({ connectionString: url, max: 2 });

// Marker domain fixture — dipakai smoke-prod.ts & e2e-canonical-cookie.ts.
const MARKER_DOMAINS = ["@test.local", "@example.com"];

async function main(): Promise<void> {
  const candidates = await pool.query<{ id: string; email: string; objectives: string }>(
    `SELECT u.id, u.email,
            (SELECT count(*)::text FROM objectives o WHERE o.user_id = u.id) AS objectives
     FROM users u
     WHERE ${MARKER_DOMAINS.map((_, i) => `u.email LIKE $${i + 1}`).join(" OR ")}
     ORDER BY u.created_at ASC`,
    MARKER_DOMAINS.map((d) => `%${d}`),
  );

  let deletable = 0, skipped = 0;
  const deletableIds: string[] = [];
  for (const r of candidates.rows) {
    if (r.objectives !== "0") {
      skipped++;
      console.log(`  SKIP (punya ${r.objectives} objective — jangan sentuh): ${r.email}`);
      continue;
    }
    deletable++;
    deletableIds.push(r.id);
    console.log(`${APPLY ? "DELETE" : "DRY-RUN"} user tanpa objective: ${r.email}`);
  }

  if (!APPLY) {
    console.log(`\nDry-run selesai: ${deletable} dapat dihapus, ${skipped} dilewati. Jalankan ulang dengan --yes untuk menerapkan.`);
    return;
  }

  for (const uid of deletableIds) {
    // Sessions & memberships cascade by FK; org yang tertinggal kosong ikut dibersihkan.
    await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [uid]);
    const orgs = await pool.query<{ organization_id: string }>(
      `SELECT organization_id FROM memberships WHERE user_id = $1`, [uid]);
    await pool.query(`DELETE FROM memberships WHERE user_id = $1`, [uid]);
    for (const o of orgs.rows) {
      const left = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM memberships WHERE organization_id = $1`, [o.organization_id]);
      if (left.rows[0]?.n === "0") {
        await pool.query(`DELETE FROM organizations WHERE id = $1 AND plan_tier <> 'ENTERPRISE'`, [o.organization_id]);
      }
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [uid]);
  }
  console.log(`\nSelesai: ${deletable} identitas uji dihapus, ${skipped} dilewati.`);
}

main()
  .catch((e) => { console.error("FATAL", e); process.exit(1); })
  .finally(() => pool.end());
