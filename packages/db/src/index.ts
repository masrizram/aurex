/**
 * @aee/db — koneksi + migrasi.
 * Dua kredensial (pola temurute): OWNER utk DDL/migrasi; RUNTIME role member aee_app
 * (SELECT+INSERT saja — trigger FORBID_MUTATION + REVOKE menutup UPDATE/DELETE).
 */
import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { poolConfigFor } from "./neon.js";

export { Pool };

export { ResilientPool, isTransientDbError, type ResilientPoolConfig, type DbHealthState } from "./resilient.js";

export { isNeonUrl, neonNormalize, poolConfigFor } from "./neon.js";

// ── Kredensial DB dev/scratch (§24 secret safety) ────────────────────────────
// Password kontainer Postgres dev TIDAK PERNAH ditulis literal di source.
// Sumber: env AEE_DEV_DB_PASSWORD (lihat .env.example). Dipakai hanya oleh
// tooling lokal (orch_reset.sh, verify_pipeline.sh) — produksi selalu env.
export function devDbPassword(): string {
  const pw = process.env.AEE_DEV_DB_PASSWORD;
  if (!pw || !pw.trim()) {
    throw new Error(
      "[aee/db] AEE_DEV_DB_PASSWORD tidak diset — kredensial dev tidak boleh " +
      "di-hardcode di source. Salin .env.example → .env lalu isi nilainya.",
    );
  }
  return pw.trim();
}

/** Bangun URL postgres utk host/port/user dev dengan password dari env. */
export function devDbUrl(user: string, host: string, port: string | number, database = "aee"): string {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(devDbPassword())}@${host}:${port}/${database}`;
}

export function ownerPool(url: string): Pool {
  return new Pool(poolConfigFor(url, { max: 4 }));
}

export function appPool(url: string): Pool {
  return new Pool(poolConfigFor(url, { max: 8 }));
}

// ── Migrasi ──────────────────────────────────────────────────────────────────

export interface MigrationFile { readonly name: string; readonly sql: string; readonly sha256: string; }

export function loadMigrations(dir: string): MigrationFile[] {
  const entries = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  return entries.map((name) => {
    const sql = readFileSync(join(dir, name), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    return { name, sql, sha256 };
  });
}

export interface MigrationReport {
  readonly applied: string[];
  readonly skipped: string[];
  readonly checksums: { readonly name: string; readonly sha256: string }[];
}

/**
 * Skema migrations sederhana (schema_migrations). Setiap file DDL dijalankan dalam
 * SATU transaksi; checksum sha256 direkam → file yang berubah setelah ter-applied DITOLAK.
 */
export async function migrate(pool: Pool, dir: string): Promise<MigrationReport> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const { rows } = await pool.query<{ name: string; sha256: string }>(
    "SELECT name, sha256 FROM schema_migrations ORDER BY name",
  );
  const appliedMap = new Map(rows.map((r) => [r.name, r.sha256]));
  const files = loadMigrations(dir);
  const report: MigrationReport = { applied: [], skipped: [], checksums: [] };

  for (const f of files) {
    const prev = appliedMap.get(f.name);
    if (prev === f.sha256) {
      report.skipped.push(f.name);
      report.checksums.push({ name: f.name, sha256: f.sha256 });
      continue;
    }
    if (prev !== undefined) {
      throw new Error(`checksum mismatch utk ${f.name}: DB=${prev} file=${f.sha256} — file migration tak boleh berubah`);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(f.sql);
      await client.query("INSERT INTO schema_migrations(name, sha256) VALUES ($1, $2)", [f.name, f.sha256]);
      await client.query("COMMIT");
      report.applied.push(f.name);
      report.checksums.push({ name: f.name, sha256: f.sha256 });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  return report;
}

export function migrationsDir(): string {
  return resolve(import.meta.dirname ?? ".", "../../../migrations");
}
