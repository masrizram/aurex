-- ============================================================
-- 013_polar_billing.sql — Billing migration: Duitku → Polar
--
-- Rationale: Duitku is being replaced by Polar (polar.sh) for recurring
-- SaaS billing — Polar's REST API, webhook model, and customer/subscription
-- objects map cleanly to our existing billing_invoices + subscriptions tables.
--
-- Strategy: provider-agnostic schema with explicit provider columns.
--   • billing_invoices gains  polar_checkout_id, polar_customer_id, polar_url
--     and keeps the original duitku_reference + payment_url columns (Duitku
--     is retained as fallback / for migration of in-flight invoices).
--   • subscriptions loses the zombie stripe_customer_id / stripe_subscription_id
--     columns (legacy from a prior Stripe attempt — no code path reads or
--     writes them, verified by grep). The new polar_customer_id and
--     polar_subscription_id columns carry the live billing relationship.
--   • New table polar_webhook_events records every webhook delivery for
--     idempotent re-processing (Polar may retry up to 24h).
--
-- All new columns are NULLABLE — in-flight Duitku invoices continue to work
-- unchanged. Migration 014 below will (offline) backfill Polar customer ids
-- for orgs that already have a Duitku invoice.
-- ============================================================

-- ── 1. billing_invoices: add Polar fields (NULL while Duitku is still live) ─
ALTER TABLE billing_invoices
  ADD COLUMN IF NOT EXISTS polar_checkout_id    text,
  ADD COLUMN IF NOT EXISTS polar_customer_id    text,
  ADD COLUMN IF NOT EXISTS polar_url            text,
  ADD COLUMN IF NOT EXISTS provider             text NOT NULL DEFAULT 'duitku'
    CHECK (provider IN ('duitku','polar'));

-- Index for webhook lookup by Polar checkout id (webhook delivery path).
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_invoices_polar_checkout
  ON billing_invoices(polar_checkout_id)
  WHERE polar_checkout_id IS NOT NULL;

-- Index for webhook lookup by Polar customer id (subscription sync path).
CREATE INDEX IF NOT EXISTS idx_billing_invoices_polar_customer
  ON billing_invoices(polar_customer_id)
  WHERE polar_customer_id IS NOT NULL;

-- ── 2. subscriptions: replace zombie Stripe columns with Polar ─────────────
-- The stripe_* columns have NO readers or writers (verified grep 2026-08-27).
-- Drop them so the table model is honest. Polar customer/subscription ids
-- are what the live billing flow needs.
ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id,
  ADD COLUMN IF NOT EXISTS polar_customer_id       text,
  ADD COLUMN IF NOT EXISTS polar_subscription_id   text,
  ADD COLUMN IF NOT EXISTS provider                text NOT NULL DEFAULT 'duitku'
    CHECK (provider IN ('duitku','polar'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_polar_customer
  ON subscriptions(polar_customer_id)
  WHERE polar_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_polar_subscription
  ON subscriptions(polar_subscription_id)
  WHERE polar_subscription_id IS NOT NULL;

-- ── 3. polar_webhook_events — idempotent webhook ingestion ─────────────────
-- Polar documents webhook retries for up to 24 hours on any non-2xx response.
-- We dedupe by (event_id) primary key; signature is stored for forensic audit
-- when a signature mismatch is investigated.
CREATE TABLE IF NOT EXISTS polar_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        text NOT NULL UNIQUE,           -- evt_xxx from Polar
  event_type      text NOT NULL,                  -- checkout.created, etc.
  payload         jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,                    -- NULL = pending
  processing_error text
);
CREATE INDEX IF NOT EXISTS idx_polar_webhook_events_received
  ON polar_webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_polar_webhook_events_unprocessed
  ON polar_webhook_events(received_at) WHERE processed_at IS NULL;

-- ── 4. Grants: aee_app needs SELECT/INSERT on the new table ────────────────
GRANT SELECT, INSERT, UPDATE ON polar_webhook_events TO aee_app;
GRANT UPDATE (polar_checkout_id, polar_customer_id, polar_url, provider)
  ON billing_invoices TO aee_app;
GRANT UPDATE (polar_customer_id, polar_subscription_id, provider)
  ON subscriptions TO aee_app;

-- Note: UPDATE on billing_invoices.status is intentionally NOT granted to
-- aee_app. Only the webhook handler (via the pool owner connection in
-- /billing/polar/webhook) can transition PENDING → PAID — same posture as
-- the existing Duitku callback. This is defence in depth: even if aee_app
-- were compromised, invoice status cannot be flipped without going through
-- the signed-webhook path.
