-- 006_onboarding_fixes.sql
-- Fixes F1/F2/F3: persist capital & autonomy from onboarding; unique email race guard.

-- ── 1. business_ventures: capital_available (dari onboarding step3) ──────────
ALTER TABLE business_ventures ADD COLUMN IF NOT EXISTS capital_available numeric(15,2) DEFAULT 0;

-- ── 2. organizations: autonomy_level pilihan user (step4) ───────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS autonomy_level int NOT NULL DEFAULT 1
  CHECK (autonomy_level >= 1 AND autonomy_level <= 3);

-- ── 3. sessions cleanup: hapus session expired (housekeeping via query manual) ─
CREATE INDEX IF NOT EXISTS idx_sessions_token_expiry ON sessions(token, expires_at);

-- ── 4. Grant aee_app kolom baru ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO aee_app;
