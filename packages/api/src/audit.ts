/**
 * @aee/api — helper audit log terpusat untuk SEMUA mutasi admin.
 *
 * audit_logs = append-only (trigger FORBID_MUTATION, 001). Semua aksi
 * privileged admin WAJIB lewat helper ini agar setiap mutasi tercatat.
 * `ip` diambil dari req.ip (trustProxy → Fly-Client-IP), di-cast ke inet.
 */
import type { PoolClient } from "pg";

export interface AuditEntry {
  readonly actorId: string | null;     // user_id (admin yang melakukan aksi)
  readonly action: string;             // mis. "users.update", "org.plan_change"
  readonly target: string;             // mis. "user:<id>", "org:<id>"
  readonly detail?: unknown;           // payload kontekstual (jsonb)
  readonly ip?: string;                // string → di-cast ke inet
  readonly actorType?: "ADMIN" | "SERVICE" | "SYSTEM";
}

export async function writeAuditLog(
  client: PoolClient,
  entry: AuditEntry,
): Promise<void> {
  const ip = entry.ip && entry.ip.length > 0 && entry.ip !== "::1" ? entry.ip : null;
  await client.query(
    `INSERT INTO audit_logs (user_id, action, target, detail, ip, actor_type)
     VALUES ($1, $2, $3, $4::jsonb, $5::inet, $6)`,
    [entry.actorId, entry.action, entry.target,
      entry.detail != null ? JSON.stringify(entry.detail) : null, ip, entry.actorType ?? "ADMIN"],
  );
}
