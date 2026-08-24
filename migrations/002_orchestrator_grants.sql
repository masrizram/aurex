-- ============================================================
-- 002_orchestrator_grants.sql — Phase 6 (§11 advance())
-- TEMUAN: DDL 001 memberi aee_app hanya SELECT+INSERT, tetapi
-- advance() wajib UPDATE kolom workflow (state, row_version, dst).
-- 001 terkunci checksum (migrate runner menolak file berubah)
-- → grant diberikan di sini, COLUMN-SCOPED (least privilege):
--   * tabel workflow mutable: hanya kolom yang ditulis orchestrator
--   * 5 tabel append-only (ledger/events/decisions/mission_versions/
--     audit_logs) TETAP tanpa UPDATE — trigger FORBID_MUTATION + REVOKE
-- Nilai ekonomi TIDAK ada di daftar grant: revenue/cost hanya masuk
-- via INSERT capital_transactions (jalur tier RECONCILED, Phase 8+).
-- ============================================================

GRANT USAGE ON SCHEMA public TO aee_app;

-- objectives: transisi state + normalisasi deadline + penomoran cycle
GRANT UPDATE (state, row_version, updated_at, deadline, current_cycle)
  ON objectives TO aee_app;

-- cycles: siklus hidup (mulai/selesai/abort) + akumulasi biaya LLM
GRANT UPDATE (started_at, completed_at, status, llm_cost)
  ON cycles TO aee_app;

-- opportunities: skor engine (T07 all_scores_by_engine) + status pipeline
GRANT UPDATE (margin, demand_score, willingness_to_pay_score, profitability_score,
              scalability_score, defensibility_score, execution_feasibility_score,
              evidence_strength_score, time_to_revenue_score, risk_score,
              probability_of_success, expected_value, opportunity_score,
              risk_adjusted_score, status, updated_at)
  ON opportunities TO aee_app;

-- experiments: lifecycle pengukuran
GRANT UPDATE (status, result, measured_value, spent, decision_id, updated_at)
  ON experiments TO aee_app;

-- missions: versioning pointer + status
GRANT UPDATE (current_version, status, updated_at)
  ON missions TO aee_app;

-- executions: dispatch + hasil + timestamp
GRANT UPDATE (status, provider_job_ref, started_at, finished_at)
  ON executions TO aee_app;

-- prompt_versions: registrasi versi prompt (upsert ON CONFLICT DO UPDATE §12)
GRANT UPDATE (template_hash) ON prompt_versions TO aee_app;

-- model_runs: baris audit run LLM — append-only (INSERT sudah dari 001; tanpa UPDATE)

-- approvals (T34/T35 API §8): owner memutus PENDING → APPROVED/REJECTED + payload note.
GRANT UPDATE (status, decided_by, decided_at, payload) ON approvals TO aee_app;

-- execution_results: naikkan tier hasil SELF_REPORTED/EVIDENCED -> RECONCILED
-- saat webhook pembayaran terekonsiliasi (Result Processor §3.1/§10; bukti pembayaran).
GRANT UPDATE (verification_tier) ON execution_results TO aee_app;
