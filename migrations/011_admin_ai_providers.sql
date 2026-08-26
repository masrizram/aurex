-- 011_admin_ai_providers.sql — Admin Control Plane (fase 2)
-- Tabel ai_providers + grants UPDATE users (root cause PATCH /admin/users gagal
-- di produksi karena 001/002 tidak memberi aee_app UPDATE pada users).
--
-- Prinsip CRUD-admin (spesifikasi "@admin management console"):
--   * CRUD ≠ semua tabel editable. AI provider boleh CRUD; users/orgs/objectives
--     dibatasi pada kolom mutable + lifecycle legal.
--   * API key AI provider disimpan ENCRYPTED (AES-256-GCM via packages/api/src/crypto.ts).
--   * Routing Strategic/Execution/Fallback via kolom `role` + `is_primary`.

-- ── 1. users: beri UPDATE kolom profile/lifecycle yang diizinkan admin ────────
-- Root cause lama: 001 GRANT base SELECT+INSERT saja; 002 hanya workflow tables.
-- Tanpa grant ini, PATCH /admin/users/:id (role/status/is_admin) gagal 42501.
GRANT UPDATE (name, role, status, is_admin) ON users TO aee_app;

-- ── 2. ai_providers ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,                       -- label human "Kimi", "GLM"
  provider text NOT NULL DEFAULT 'openai_compatible',  -- transport: openai_compatible
  base_url text NOT NULL,
  api_key_cipher bytea,                            -- AES-256-GCM iv|tag|cipher; NULL = belum diisi
  api_key_hash text,                               -- SHA-256 untuk deteksi "sudah ada?" tanpa bocor isi
  model text NOT NULL,
  role text NOT NULL DEFAULT 'EXECUTION'
    CHECK (role IN ('STRATEGIC','EXECUTION','FALLBACK')),
  is_primary boolean NOT NULL DEFAULT false,       -- primary untuk role tsb
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  last_health_check_at timestamptz,
  last_health_ok boolean,
  last_health_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_role ON ai_providers(role);

-- Primary per role (cek saat INSERT/UPDATE via aplikasi; indeks parsial membantu).
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_per_role
  ON ai_providers(role) WHERE is_primary;

-- ── 3. Grants ai_providers (bukan append-only) ───────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_providers TO aee_app;

-- ── 4. organizations: tambah status (suspend/activate org) ───────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('ACTIVE','SUSPENDED'));
GRANT UPDATE (name, plan_tier, status, autonomy_level) ON organizations TO aee_app;
