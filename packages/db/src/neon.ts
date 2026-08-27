/**
 * @aee/db — Neon (neon.tech) connection helpers.
 *
 * Neon is serverless Postgres: every connection MUST be over TLS (SSL).
 * The `pg` driver will not enable SSL from a bare password URL unless the URL
 * carries `sslmode=require` / `sslmode=verify-full`, OR the Pool config sets
 * `ssl`. Because our pool constructors (ownerPool / appPool / ResilientPool)
 * take a plain connection string, we centralise Neon detection here so the
 * production Fly deployment can switch to Neon by merely changing the env
 * URLs — no per-file edits.
 *
 * Dual-role contract (preserved from the Duitku/Fly era):
 *   DATABASE_URL        → owner/DDL + pg-boss (migrations)
 *   DATABASE_APP_URL    → least-privilege runtime role (API pool)
 * On Neon both roles exist (e.g. neondb_owner / aee_app); branch + role is
 * embedded in the URL returned by the Neon console "connection string" dialog.
 */

import type { PoolConfig } from "pg";

/** True if the connection string targets a Neon host. */
export function isNeonUrl(url: string): boolean {
  return /(@[^/]*neon\.tech|@[^/]*neon\.run)/i.test(url);
}

/** True if the URL already requests SSL explicitly. */
function hasSslMode(url: string): boolean {
  return /sslmode=require|sslmode=verify-full|sslmode=verify-ca/i.test(url);
}

/** True if the URL is missing the `postgres`/`postgresql` scheme (Neon console
 *  sometimes yields a bare host:port string). */
function hasScheme(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url);
}

/**
 * Normalise a connection string for Neon: ensure a scheme and explicit
 * `sslmode=require`. Idempotent. Returns the original string for non-Neon URLs.
 */
export function neonNormalize(url: string): string {
  if (!isNeonUrl(url)) return url;
  let u = url.trim();
  if (!hasScheme(u)) u = `postgresql://${u}`;
  if (!hasSslMode(u)) {
    const sep = u.includes("?") ? "&" : "?";
    u = `${u}${sep}sslmode=require`;
  }
  return u;
}

/**
 * Build a pg PoolConfig for a connection string, enabling SSL when Neon is
 * detected. `rejectUnauthorized` defaults to true (verify cert against the
 * public CA — safe for Neon's managed TLS). Tests/self-hosted overrides can
 * set `rejectUnauthorized=false` for self-signed local endpoints.
 */
export function poolConfigFor(
  url: string,
  opts: Partial<PoolConfig> & { rejectUnauthorized?: boolean } = {},
): PoolConfig {
  const cfg: PoolConfig = { ...opts, connectionString: neonNormalize(url) };
  if (isNeonUrl(url) && opts.ssl === undefined) {
    const rejectUnauthorized = opts.rejectUnauthorized ?? true;
    cfg.ssl = { rejectUnauthorized };
    delete (cfg as { rejectUnauthorized?: boolean }).rejectUnauthorized;
  }
  return cfg;
}
