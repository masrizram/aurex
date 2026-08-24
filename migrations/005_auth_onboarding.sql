-- 005_auth_onboarding.sql
-- Adds session-based auth, user profile fields, org onboarding tracking,
-- and business_venture onboarding fields for the 5-step customer flow.

-- ── 1. sessions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ── 2. users: profile + status + admin flag ──────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS name     text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status   text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_status_check
    CHECK (status = ANY (ARRAY['ACTIVE','SUSPENDED','DELETED']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. organizations: onboarding tracking ────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_step      int         NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed timestamptz;

-- ── 4. business_ventures: onboarding detail fields ──────────────────────────
ALTER TABLE business_ventures ADD COLUMN IF NOT EXISTS website               text;
ALTER TABLE business_ventures ADD COLUMN IF NOT EXISTS products              text;
ALTER TABLE business_ventures ADD COLUMN IF NOT EXISTS goal_type             text;
ALTER TABLE business_ventures ADD COLUMN IF NOT EXISTS current_revenue       numeric(15,2) DEFAULT 0;
ALTER TABLE business_ventures ADD COLUMN IF NOT EXISTS current_cost          numeric(15,2) DEFAULT 0;
ALTER TABLE business_ventures ADD COLUMN IF NOT EXISTS time_horizon_months   int            DEFAULT 3;
DO $$ BEGIN
  ALTER TABLE business_ventures ADD CONSTRAINT bv_goal_type_check
    CHECK (goal_type IS NULL OR goal_type = ANY (ARRAY[
      'increase_profit','reduce_cost','find_opportunities','launch_new','improve_growth']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. Grant aee_app access to new tables/columns ───────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO aee_app;
