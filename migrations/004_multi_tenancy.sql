-- ============================================================
-- 004_multi_tenancy.sql — Multi-tenancy SaaS layer
--
-- Adds organizations, memberships, subscription plans, subscriptions,
-- usage credits/quotas, and API keys. Adds organization_id FK columns
-- to objectives and business_ventures (NULL = legacy/owned-by-user).
--
-- All new tenant tables get SELECT, INSERT, UPDATE grants to aee_app
-- (non-append-only). Seeds 4 default subscription plans.
-- ============================================================

-- ── 1. organizations ───────────────────────────────────────────────────────
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  plan_tier text NOT NULL DEFAULT 'FREE'
    CHECK (plan_tier IN ('FREE','STARTER','GROWTH','ENTERPRISE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 2. memberships ──────────────────────────────────────────────────────────
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'MEMBER'
    CHECK (role IN ('OWNER','ADMIN','MEMBER','VIEWER')),
  invited_by uuid REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_org ON memberships(organization_id);

-- ── 3. subscription_plans ──────────────────────────────────────────────────
CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL
    CHECK (tier IN ('FREE','STARTER','GROWTH','ENTERPRISE')),
  name text NOT NULL,
  price_monthly NUMERIC(20,2) NOT NULL DEFAULT 0,
  price_yearly NUMERIC(20,2) NOT NULL DEFAULT 0,
  max_objectives int,          -- NULL = unlimited
  max_businesses int,          -- NULL = unlimited
  max_ai_credits_monthly int,  -- NULL = unlimited
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tier)
);

-- ── 4. subscriptions ───────────────────────────────────────────────────────
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','TRIALING','PAST_DUE','CANCELLED')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_org ON subscriptions(organization_id);

-- ── 5. usage_credits ───────────────────────────────────────────────────────
CREATE TABLE usage_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month_year text NOT NULL,              -- 'YYYY-MM'
  credits_used int NOT NULL DEFAULT 0,
  credits_limit int NOT NULL,
  credits_purchased int NOT NULL DEFAULT 0,
  reset_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, month_year)
);
CREATE INDEX idx_usage_org ON usage_credits(organization_id);

-- ── 6. api_keys ────────────────────────────────────────────────────────────
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL,
  last_used_at timestamptz,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_keys_org ON api_keys(organization_id);

-- ── 7. ALTER objectives: add organization_id ───────────────────────────────
ALTER TABLE objectives
  ADD COLUMN organization_id uuid REFERENCES organizations(id);

-- ── 8. ALTER business_ventures: add organization_id ────────────────────────
ALTER TABLE business_ventures
  ADD COLUMN organization_id uuid REFERENCES organizations(id);

-- ── 9. Grants: aee_app gets SELECT, INSERT, UPDATE on all new tables ──────
GRANT SELECT, INSERT, UPDATE ON organizations TO aee_app;
GRANT SELECT, INSERT, UPDATE ON memberships TO aee_app;
GRANT SELECT, INSERT, UPDATE ON subscription_plans TO aee_app;
GRANT SELECT, INSERT, UPDATE ON subscriptions TO aee_app;
GRANT SELECT, INSERT, UPDATE ON usage_credits TO aee_app;
GRANT SELECT, INSERT, UPDATE ON api_keys TO aee_app;

-- Allow aee_app to update the new organization_id columns on existing tables
GRANT UPDATE (organization_id) ON objectives TO aee_app;
GRANT UPDATE (organization_id) ON business_ventures TO aee_app;

-- ── 10. Seed default subscription plans ────────────────────────────────────
INSERT INTO subscription_plans (tier, name, price_monthly, price_yearly, max_objectives, max_businesses, max_ai_credits_monthly, features)
VALUES
  ('FREE', 'Free', 0, 0, 1, 1, 100,
    '{"ai_credits": 100, "support": "community"}'::jsonb),
  ('STARTER', 'Starter', 499000, 4990000, 5, 3, 1000,
    '{"ai_credits": 1000, "support": "email"}'::jsonb),
  ('GROWTH', 'Growth', 2500000, 25000000, NULL, 10, 10000,
    '{"ai_credits": 10000, "support": "priority"}'::jsonb),
  ('ENTERPRISE', 'Enterprise', 100000000, 1000000000, NULL, NULL, NULL,
    '{"ai_credits": "unlimited", "support": "dedicated"}'::jsonb)
ON CONFLICT (tier) DO NOTHING;
