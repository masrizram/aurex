/**
 * CLI migrasi — `npm run migrate`.
 * Koneksi OWNER dari DATABASE_URL (lihat .env.example); runtime app pakai DATABASE_APP_URL.
 */
import "dotenv/config";
import { ownerPool, migrate, migrationsDir } from "./index.js";

async function main(): Promise<void> {
  const statusOnly = process.argv.includes("--status");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tidak di-set (lihat .env.example)");
  const dir = migrationsDir();
  const pool = ownerPool(url);
  try {
    if (statusOnly) {
      const { rows } = await pool.query("SELECT name, sha256, applied_at FROM schema_migrations ORDER BY name");
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    const report = await migrate(pool, dir);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
