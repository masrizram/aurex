-- 012_admin_audit_detail.sql — audit log admin (append-only).
-- audit_logs sudah ada (001). Migration ini menambah kolom untuk konteks
-- actor+target yang lebih kaya pada aksi admin, TANPA menyentuh baris existing.
-- Append-only dijaga trigger FORBID_MUTATION (001) — tidak diubah di sini.

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_type text DEFAULT 'ADMIN'
  CHECK (actor_type IN ('ADMIN','SERVICE','SYSTEM'));
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id text;
