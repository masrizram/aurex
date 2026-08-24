-- 003_business_venture.sql — Phase 15 (domain redesign: business-identity)
--
-- Domain baru: BUSINESS VENTURE → BUSINESS THESIS → ECONOMIC OBJECTIVE → OPPORTUNITY
--              → EXPERIMENT → MISSION → EXECUTION → RESULT → DECISION → NEXT CYCLE
--
-- Objective BUKAN lagi record target-profit/capital terisolasi: wajib menempel ke
-- Business Venture (Mode A: business given) ATAU ber-mode DISCOVERY (Mode B: Kimi
-- menemukan bisnis, venture dibuat otomatis saat rank_select → event BUSINESS_SELECTED).
--
-- Tabel baru: business_ventures (thesis). Kolom baru di objectives: business_venture_id,
-- business_mode. Tabel lama TIDAK diubah (001 checksum-locked sha16 28d572f112ad851a).

CREATE TABLE business_ventures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,                                   -- "SaaS B2B Audit Kepatuhan"
  industry text NOT NULL,                               -- "Compliance / B2B SaaS"
  market text NOT NULL,                                 -- "Indonesia"
  target_customer text NOT NULL,                        -- "SME Indonesia"
  problem text NOT NULL,
  solution text NOT NULL,
  business_model text NOT NULL,                         -- "Subscription"
  price text,                                           -- "Rp750K / month" (bebas format)
  origin text NOT NULL DEFAULT 'USER'
    CHECK (origin IN ('USER','KIMI_DISCOVERED')),       -- Mode A vs Mode B
  source_objective_id uuid REFERENCES objectives(id),   -- venture hasil discovery objective mana
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ventures_user ON business_ventures(user_id);

ALTER TABLE objectives
  ADD COLUMN business_venture_id uuid REFERENCES business_ventures(id),
  ADD COLUMN business_mode text NOT NULL DEFAULT 'DISCOVERY'
    CHECK (business_mode IN ('GIVEN','DISCOVERY'));
CREATE INDEX idx_objectives_venture ON objectives(business_venture_id);

-- Grants: runtime (aee_app) boleh insert/update ventures + baca objectives kolom baru.
GRANT SELECT, INSERT, UPDATE ON business_ventures TO aee_app;
GRANT UPDATE (business_venture_id, updated_at) ON objectives TO aee_app;
