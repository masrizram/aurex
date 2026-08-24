/**
 * Runner migration via @aee/db (checksum sha256) — dipakai orch_setup.sh.
 * Output: satu baris JSON {applied, skipped, checksums} ke stdout.
 */
import { ownerPool, migrate } from "@aee/db";
import { join } from "node:path";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL wajib (owner)");
  const dir = join(process.cwd(), "migrations");
  const pool = ownerPool(url);
  try {
    const r = await migrate(pool, dir);
    console.log(JSON.stringify(r));
  } finally {
    await pool.end();
  }
}

void main().catch((e: unknown) => { console.error(e); process.exit(1); });
