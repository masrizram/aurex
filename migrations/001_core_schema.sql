-- ============================================================
-- AEE Master Engineering Specification §7 — Database Schema
-- VERSI TERINTEGRASI (ddl_patched.sql) — hasil audit empiris 2026-08-22
--
-- Lineage: ddl.sql verbatim §7 (baseline audit, 8 GAP ditemukan)
--        + patch.sql remediasi (diverifikasi 15/15 probe, run-3)
--        → digabung utuh, diverifikasi ulang berdiri sendiri (run-4).
-- Perubahan vs verbatim (semua berbasis klaim spec sendiri):
--   GAP-02 citext dideklarasikan (DDL verbatim gagal 27 error tanpa ini)
--   GAP-01 trigger FORBID_MUTATION + REVOKE + role aee_app (klaim "diawasi
--        trigger + REVOKE" kini nyata; idem §7 Retention note)
--   GAP-03 CHECK enumerasi verification_tier (D8/L178) di 2 tabel
--   GAP-04 CHECK 25 state FSM (union From/To T01–T39 §5.2)
--   GAP-05 CHECK cardinality(evidence_ids) >= 1 (komentar "wajib >=1")
--   GAP-06 CHECK debit_account <> credit_account (double-entry no-op)
--   GAP-07 deadline NULL legal HANYA di state OBJECTIVE_CREATED (alur §8
--        POST /objectives tanpa field deadline ↔ normalisasi T02)
--   GAP-08 kolom assumptions.kind ('assumption'|'summary') — §12 kompresi
-- ============================================================

CREATE EXTENSION IF NOT EXISTS citext;               -- GAP-02

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','operator','auditor','service')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  target_profit NUMERIC(20,2) NOT NULL CHECK (target_profit > 0),
  capital_approved NUMERIC(20,2) NOT NULL CHECK (capital_approved > 0),
  horizon_months int NOT NULL CHECK (horizon_months BETWEEN 1 AND 60),
  deadline date,                                -- GAP-07: diisi saat normalisasi T02, tz Asia/Jakarta
  market text NOT NULL,
  risk_tolerance text NOT NULL CHECK (risk_tolerance IN ('low','moderate','high')),
  autonomy_level int NOT NULL DEFAULT 1 CHECK (autonomy_level BETWEEN 0 AND 4),
  state text NOT NULL DEFAULT 'OBJECTIVE_CREATED'
    CHECK (state IN                            -- GAP-04: 25 state = union From/To T01–T39 §5.2
    ('IDLE','OBJECTIVE_CREATED','OBJECTIVE_VALIDATED','RESEARCHING','RESEARCH_COMPLETE',
     'ANALYZING','OPPORTUNITIES_RANKED','OPPORTUNITY_SELECTED','VALIDATING','RESULT_READY',
     'MISSION_CREATED','MISSION_APPROVED','EXECUTING','EXECUTION_COMPLETED','MEASURING',
     'RESULT_ANALYZING','DECISION_READY','SCALING','ITERATING','PIVOTING','KILLING',
     'HUMAN_APPROVAL_REQUIRED','BLOCKED','ACHIEVED','STOPPED')),
  current_cycle int NOT NULL DEFAULT 0,
  environment text NOT NULL DEFAULT 'SIMULATED' CHECK (environment IN ('SIMULATED','TEST','REAL')),
  row_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT objectives_deadline_check          -- GAP-07
    CHECK (deadline IS NOT NULL OR state = 'OBJECTIVE_CREATED')
);
CREATE INDEX idx_objectives_state ON objectives(state) WHERE state NOT IN ('ACHIEVED','STOPPED');

CREATE TABLE objective_versions (           -- setiap perubahan objective = versi baru
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  version int NOT NULL,
  snapshot jsonb NOT NULL,
  UNIQUE (objective_id, version)
);

CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  user_id uuid NOT NULL, endpoint text NOT NULL,
  request_hash text NOT NULL,               -- SHA-256 body kanonik
  response jsonb, status text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','DONE','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  cycle_number int NOT NULL,
  started_at timestamptz, completed_at timestamptz,
  llm_cost NUMERIC(20,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','ABORTED')),
  UNIQUE (objective_id, cycle_number)
);
-- Satu cycle ACTIVE per objective:
CREATE UNIQUE INDEX one_active_cycle ON cycles(objective_id) WHERE status='ACTIVE';

CREATE TABLE opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  name text NOT NULL,
  customer_segment text NOT NULL, problem text NOT NULL, solution text NOT NULL,
  business_model text NOT NULL, price NUMERIC(20,2),
  revenue_potential NUMERIC(20,2), cost_estimate NUMERIC(20,2), margin NUMERIC(8,4),
  capital_required NUMERIC(20,2), time_to_revenue_days int,
  demand_score NUMERIC(4,2), willingness_to_pay_score NUMERIC(4,2),
  profitability_score NUMERIC(4,2), scalability_score NUMERIC(4,2),
  defensibility_score NUMERIC(4,2), execution_feasibility_score NUMERIC(4,2),
  evidence_strength_score NUMERIC(4,2), time_to_revenue_score NUMERIC(4,2),
  risk_score NUMERIC(4,2), probability_of_success NUMERIC(5,4) CHECK (probability_of_success BETWEEN 0 AND 1),
  expected_value NUMERIC(20,2), opportunity_score NUMERIC(5,2), risk_adjusted_score NUMERIC(6,2),
  assumptions jsonb NOT NULL DEFAULT '[]', unknowns jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'DISCOVERED',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_opp_rank ON opportunities(objective_id, risk_adjusted_score DESC);

CREATE TABLE opportunity_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  kind text NOT NULL CHECK (kind IN ('url','document','metric','file','quote')),
  uri text NOT NULL, sha256 text, summary text, weight NUMERIC(4,2) NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  hypothesis text NOT NULL, objective text NOT NULL,
  budget NUMERIC(20,2) NOT NULL, spent NUMERIC(20,2) NOT NULL DEFAULT 0,
  duration_days int NOT NULL,
  success_metric text NOT NULL, success_threshold NUMERIC(20,4) NOT NULL,
  failure_threshold NUMERIC(20,4) NOT NULL,
  kill_criteria jsonb NOT NULL, scale_criteria jsonb NOT NULL,
  information_gain_target text,
  status text NOT NULL DEFAULT 'DESIGNED',
  result jsonb, measured_value NUMERIC(20,4),
  decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (spent <= budget)
);

CREATE TABLE missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- MISSION_ID
  objective_id uuid NOT NULL REFERENCES objectives(id),
  opportunity_id uuid REFERENCES opportunities(id),
  experiment_id uuid REFERENCES experiments(id),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  current_version int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT',
  priority int NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mission_versions (                        -- immutable; modifikasi = versi baru
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES missions(id),
  version int NOT NULL,                                 -- MISSION_VERSION
  package jsonb NOT NULL,                               -- kontrak §10/§16 lengkap
  package_hash text NOT NULL,                           -- SHA-256 kanonik
  created_by text NOT NULL CHECK (created_by IN ('KIMI','SYSTEM','HUMAN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, version)
);

CREATE TABLE executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- EXECUTION_ID
  mission_id uuid NOT NULL REFERENCES missions(id),
  mission_version int NOT NULL,
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  idempotency_key text NOT NULL UNIQUE,               -- mission_id:version:attempt
  attempt int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'QUEUED',
  provider text NOT NULL, provider_job_ref text,
  started_at timestamptz, finished_at timestamptz,
  UNIQUE (mission_id, mission_version, attempt)
);
-- Satu execution aktif per misi:
CREATE UNIQUE INDEX one_active_execution ON executions(mission_id)
  WHERE status IN ('QUEUED','RUNNING');

CREATE TABLE execution_results (                       -- kontrak §11/§10 GLM
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL UNIQUE REFERENCES executions(id),  -- satu hasil per eksekusi
  payload jsonb NOT NULL, payload_hash text NOT NULL,
  schema_valid boolean NOT NULL,
  verification_tier text NOT NULL DEFAULT 'SELF_REPORTED'
    CHECK (verification_tier IN               -- GAP-03: enumerasi D8
    ('SELF_REPORTED','EVIDENCED','RECONCILED','VERIFIED')),
  revenue_claimed NUMERIC(20,2) DEFAULT 0, cost_claimed NUMERIC(20,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- LEDGER: append-only, double-entry. Tidak ada UPDATE/DELETE (diawasi trigger + REVOKE).
CREATE TABLE capital_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  cycle_id uuid REFERENCES cycles(id),
  execution_id uuid REFERENCES executions(id),
  idempotency_key text NOT NULL UNIQUE,
  debit_account text NOT NULL CHECK (debit_account IN
    ('CASH','CAPITAL_DEPLOYED','REVENUE','COGS','OPEX','EXPERIMENT_COST','LLM_COST','DRAWDOWN')),
  credit_account text NOT NULL CHECK (credit_account IN
    ('CASH','CAPITAL_DEPLOYED','REVENUE','COGS','OPEX','EXPERIMENT_COST','LLM_COST','DRAWDOWN')),
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  verification_tier text NOT NULL
    CHECK (verification_tier IN               -- GAP-03: enumerasi D8
    ('SELF_REPORTED','EVIDENCED','RECONCILED','VERIFIED')),
  memo text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capital_transactions_no_self_transfer_check   -- GAP-06
    CHECK (debit_account <> credit_account)
);
CREATE INDEX idx_ledger_obj ON capital_transactions(objective_id, created_at);

CREATE TABLE economic_snapshots (                      -- TURUNAN; dibangun ulang dari ledger
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  cycle_id uuid REFERENCES cycles(id),
  revenue NUMERIC(20,2) NOT NULL, cogs NUMERIC(20,2) NOT NULL,
  gross_profit NUMERIC(20,2) NOT NULL, gross_margin NUMERIC(8,4),
  opex NUMERIC(20,2) NOT NULL, operating_profit NUMERIC(20,2) NOT NULL,
  capital_available NUMERIC(20,2) NOT NULL, capital_deployed NUMERIC(20,2) NOT NULL,
  capital_remaining NUMERIC(20,2) NOT NULL, drawdown NUMERIC(20,2) NOT NULL,
  customers int NOT NULL DEFAULT 0, leads int NOT NULL DEFAULT 0,
  cac NUMERIC(20,2), ltv NUMERIC(20,2), ltv_cac NUMERIC(10,2),
  retention NUMERIC(5,4), roi NUMERIC(10,4), burn NUMERIC(20,2), runway_days int,
  expected_value NUMERIC(20,2), confidence NUMERIC(5,4),
  source_event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decisions (                               -- immutable
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  decision text NOT NULL CHECK (decision IN
    ('SELECT','ITERATE','PIVOT','KILL','WAIT_FOR_INFORMATION','SCALE','BLOCKED','ESCALATE_TO_HUMAN')),
  subject_type text NOT NULL, subject_id uuid NOT NULL,
  reason text NOT NULL, evidence_ids uuid[] NOT NULL,   -- wajib >=1 (GAP-05: kini DITEGAKKAN)
  metrics jsonb NOT NULL, assumptions jsonb NOT NULL,
  confidence NUMERIC(5,4) NOT NULL,
  decided_by text NOT NULL DEFAULT 'KIMI' CHECK (decided_by IN ('KIMI','SYSTEM','HUMAN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decisions_evidence_nonempty_check          -- GAP-05
    CHECK (cardinality(evidence_ids) >= 1)
);

CREATE TABLE facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  statement text NOT NULL, evidence_id uuid NOT NULL,   -- fakta WAJIB punya evidence
  valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assumptions (                             -- = BELIEFS
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  statement text NOT NULL, confidence NUMERIC(5,4) NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONFIRMED','REFUTED')),
  resolution_evidence_id uuid,                          -- promosi ke fact hanya lewat ini
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  kind text NOT NULL DEFAULT 'assumption'               -- GAP-08: §12 kompresi konteks
    CHECK (kind IN ('assumption','summary'))
);
CREATE TABLE observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  kind text NOT NULL CHECK (kind IN ('customer','market','competitor','pricing','supplier','operational','moat')),
  content jsonb NOT NULL, source text NOT NULL,
  observed_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE moat_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  components jsonb NOT NULL,     -- {proprietary_data, customer_relationships, distribution, ...} tiap 0-10
  moat_strength NUMERIC(5,2) NOT NULL, moat_change NUMERIC(5,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id),
  category text NOT NULL,           -- LARGE_CAPITAL, IRREVERSIBLE, HIGH_RISK, DESTRUCTIVE, PIVOT, REGULATORY
  why_required text NOT NULL, what_will_happen text NOT NULL,
  capital_at_risk NUMERIC(20,2) NOT NULL,
  expected_upside NUMERIC(20,2), expected_downside NUMERIC(20,2),
  resume_state text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  decided_by uuid REFERENCES users(id), decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (                                  -- append-only audit
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid REFERENCES objectives(id),
  cycle_id uuid, type text NOT NULL,                   -- 22 tipe dari §18 + SYSTEM_ERROR
  payload jsonb NOT NULL, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_obj ON events(objective_id, created_at);

CREATE TABLE prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, version int NOT NULL,            -- mis. 'kimi.research' v7
  blocks jsonb NOT NULL,                               -- daftar blok + versi tiap blok
  template_hash text NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE model_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid REFERENCES cycles(id),
  agent text NOT NULL CHECK (agent IN ('KIMI','GLM')),
  purpose text NOT NULL,                               -- research|decide|execute|...
  prompt_version_id uuid NOT NULL REFERENCES prompt_versions(id),
  model text NOT NULL, model_version text NOT NULL,
  temperature NUMERIC(3,2) NOT NULL, token_limit int NOT NULL,
  input_context_hash text NOT NULL, output_hash text,
  input_tokens int, output_tokens int, cost NUMERIC(20,6),
  latency_ms int, retries int NOT NULL DEFAULT 0,
  status text NOT NULL, error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (                              -- aksi manusia & admin
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, action text NOT NULL, target text NOT NULL,
  detail jsonb, ip inet, created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- GAP-01: penegakan append-only (klaim §7 Retention + D2/D7)
-- Trigger FORBID_MUTATION + REVOKE; role aplikasi non-owner aee_app
-- ============================================================
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FORBID_MUTATION: % ON % ditolak (tabel append-only)',
    TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER forbid_mutation_capital_transactions
  BEFORE UPDATE OR DELETE ON capital_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER forbid_mutation_events
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER forbid_mutation_events_truncate
  BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER forbid_mutation_decisions
  BEFORE UPDATE OR DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER forbid_mutation_mission_versions
  BEFORE UPDATE OR DELETE ON mission_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER forbid_mutation_audit_logs
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON capital_transactions, events, decisions,
  mission_versions, audit_logs FROM PUBLIC;

DROP ROLE IF EXISTS aee_app;
CREATE ROLE aee_app NOLOGIN;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO aee_app;
REVOKE ALL ON capital_transactions, events, decisions, mission_versions, audit_logs FROM aee_app;
GRANT SELECT, INSERT ON capital_transactions, events, decisions, mission_versions, audit_logs TO aee_app;
