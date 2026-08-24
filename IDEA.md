# AUTONOMOUS ECONOMIC ENGINE — MASTER ENGINEERING SPECIFICATION

**Dokumen ini adalah blueprint implementasi lengkap.** Ditulis dalam Bahasa Inggris karena konsumen utamanya adalah GLM (implementer) dan toolchain engineering. Semua angka konfigurasi konsisten satu sama lain (contoh: modal Rp10.000.000 → cadangan 20% = Rp2.000.000 → deployable Rp8.000.000 → batas eksperimen Rp1.000.000 = 10% modal = 12,5% deployable). Setiap keputusan arsitektur dibandingkan, diskor, dan dikomitkan.

---

# 1. EXECUTIVE ARCHITECTURE

**Autonomous Economic Engine (AEE)** adalah aplikasi yang mengubah dua LLM (Kimi K3 = strategi, GLM = eksekusi) menjadi satu sistem ekonomi otonom yang dikendalikan oleh **orkestrator deterministik**. Prinsip tertinggi:

1. **Database adalah satu-satunya sumber kebenaran.** LLM tidak pernah "mengingat" state. Setiap siklus dibangun ulang dari DB.
2. **LLM mengusulkan, sistem memutuskan.** Semua angka finansial dihitung oleh Economic Engine deterministik (decimal arithmetic, bukan float, bukan LLM).
3. **Orkestrator adalah mesin transisi, bukan chat loop.** Setiap langkah adalah transaksi DB: baca state → evaluasi guard → eksekusi efek idempoten → tulis event → transisi.
4. **Otonomi bertingkat dengan capital gates yang tidak bisa di-override LLM.**
5. **Kedua agen berada di balik interface provider** (`StrategicAgentProvider`, `ExecutionAgentProvider`) — Kimi/GLM dapat diganti tanpa mengubah business logic.

**Bentuk sistem:** Monorepo TypeScript — `apps/api` (Fastify REST), `apps/worker` (orchestrator + agent runners, antrean pg-boss di atas Postgres), `apps/web` (dashboard React/Vite), `packages/*` (domain, orchestrator, agents, economics, risk, prompts, contracts, db). PostgreSQL 16 sebagai database + event store + job queue. Docker Compose untuk deploy.

---

# 2. CORE DESIGN DECISIONS

| # | Keputusan | Pilihan | Alternatif (skor /25) | Alasan komitmen |
|---|-----------|---------|----------------------|-----------------|
| D1 | Bahasa | **TypeScript strict end-to-end** | Python (20), Go (17), TS (**23**) | Satu bahasa full-stack; Zod schema dipakai bersama oleh API, validator output LLM, dan kontrak GLM; Vercel AI SDK mature; owner sudah mengelola codebase TS |
| D2 | Sumber kebenaran state | **Postgres, transisi ACID** | In-memory FSM (14), Event-sourcing murni (19), **DB-state + append-only event log (23)** | Event sourcing penuh menambah kompleksitas replay tanpa payoff di fase awal; kita pakai hibrida: kolom state eksplisit + event log append-only untuk audit/replay |
| D3 | Job queue | **pg-boss (di atas Postgres)** | BullMQ+Redis (20), Temporal (18), **pg-boss (22)** | Nol infrastruktur tambahan; retry/backoff/DLQ bawaan; exactly-once dikendalikan transaksi DB. Temporal dievaluasi ulang di Phase 15 |
| D4 | FSM | **Tabel transisi data-driven + guard functions** | XState (19), **tabel transisi (23)** | Transisi sebagai data → dapat diaudit, diuji properti, divisualisasikan; XState menyembunyikan state di memori, bertentangan dengan D2 |
| D5 | Uang | **NUMERIC(20,2) di DB + Decimal.js di app** | Float (5), bigint cents (20), **NUMERIC+Decimal (23)** | IDR praktis tanpa sen, tapi NUMERIC menjaga presisi rasio; float dilarang oleh lint rule |
| D6 | Kontrak LLM | **Zod schemas → JSON Schema → structured output** | Free-text + regex (8), **Zod end-to-end (24)** | Satu schema untuk: validasi output agen, OpenAPI, tipe TS, fixture test |
| D7 | Ledger ekonomi | **Append-only double-entry `capital_transactions` + snapshot turunan** | Kolom mutable (9), **ledger (24)** | Mencegah metrik halusinasi menjadi fakta; invariant dapat direkonsiliasi |
| D8 | Hasil GLM | **Tiered verification: SELF_REPORTED → EVIDENCED → RECONCILED → VERIFIED** | Langsung percaya (3), **tiered (24)** | Jawaban langsung atas "eksperimen tidak boleh sukses hanya karena LLM bilang sukses" |
| D9 | Akses aksi eksternal | **Tool gateway berpermission, bukan shell bebas** | Function calling bebas (6), **gateway (24)** | LLM tidak pernah mengeksekusi aksi sistem tanpa izin eksplisit |

---

# 3. SYSTEM ARCHITECTURE

## 3.1 Komponen & tanggung jawab

| Komponen | Tanggung jawab | Dependensi | Failure mode | Recovery |
|---|---|---|---|---|
| **Frontend (apps/web)** | Economic Control Center; tidak punya business logic | API | Render error | Error boundary; data refetch |
| **Backend API (apps/api)** | REST, authN/authZ, validasi request, idempotency key, rate limit | DB, Zod contracts | 5xx | Retry aman karena idempotensi |
| **Orchestrator (apps/worker)** | Mesin transisi FSM; dispatch efek per state | DB, queue, providers, engines | Crash mid-transition | Transaksi rollback; job requeue; state konsisten |
| **State Machine (packages/orchestrator)** | Tabel transisi + guard; satu-satunya penulis kolom `state` | DB | Transisi ilegal | Ditolak + event `SYSTEM_ERROR` |
| **Kimi Adapter (packages/agents/kimi)** | Implement `StrategicAgentProvider`; prompt assembly; parse+validasi output; retry | Prompt Engine, Moonshot API | Timeout/JSON invalid | Backoff 30s/2m/8m, max 3 → BLOCKED |
| **GLM Adapter (packages/agents/glm)** | Implement `ExecutionAgentProvider`; kirim Mission Package; terima GLM Result | Zhipu API | Timeout/parsial | Sama; partial result diterima bertanda PARTIAL |
| **Prompt Engine (packages/prompts)** | Assembly blok modular; versioning; context budgeting; hash | DB, Memory | Budget overflow | Kompresi terjadwal (ringkas BELIEF, arsip penuh tetap di DB) |
| **Structured Output Validator (packages/contracts)** | Validasi semua output agen vs Zod; reject + repair-loop maks 1× | Zod | Schema violation | Retry dengan pesan error; gagal → RESULT_REJECTED |
| **Economic Engine (packages/economics)** | Semua kalkulasi finansial deterministik | DB ledger | Input tidak lengkap | Tolak + minta field; tidak pernah menebak |
| **Risk Engine (packages/risk)** | Skor risiko 13 dimensi; gate CRITICAL | DB | Skor di luar rentang | Clamp + flag |
| **Experiment Engine (packages/experiments)** | Lifecycle eksperimen; threshold check deterministik | DB, Economic | Metrik belum matang | Status MEASURING, tidak boleh disimpulkan |
| **Mission Manager (packages/missions)** | Versioning misi; immutable version rows | DB | Duplikasi | Unique (mission_id, version) |
| **Result Processor (apps/worker)** | Terima GLM Result → validasi → tier verification → update ledger | DB, Economic | Metrik halusinasi | Tier SELF_REPORTED tidak mengubah ledger |
| **Memory Layer (packages/memory)** | FACT/BELIEF/ASSUMPTION/OBSERVATION/DECISION; retrieval per konteks | DB, pgvector opsional | Promosi diam-diam belief→fact | Dilarang di kode; promosi butuh evidence_id |
| **Event Bus (packages/events)** | Append-only `events` + outbox → notifikasi | DB | Listener gagal | Outbox retry |
| **Scheduler (apps/worker)** | Cron cycle harian/mingguan; measurement windows; approval TTL | pg-boss | Job ganda | Unique job key per (objective, window) |
| **Notification Layer** | Telegram/email; severity routing | Event outbox | Provider down | Retry; CRITICAL juga tampil di dashboard |
| **Observability** | OTel traces, pino logs, Prometheus metrics | Semua | Exporter down | Buffer lokal; sistem tetap jalan |
| **AuthN/AuthZ** | better-auth session; RBAC owner/operator/auditor/service | DB | Sesi kedaluwarsa | Refresh token |
| **Cache** | In-process LRU untuk config/prompt blocks; Redis opsional Phase 15 | — | Stale | TTL 60s + invalidasi event |
| **Secrets** | `.env` lokal dev; SOPS/Doppler di produksi; tidak pernah masuk prompt | — | Kebocoran | Scanner pola rahasia sebelum persist output agen |

## 3.2 Aturan scaling
- Fase awal: 1 API + 1 worker (cukup; satu objective aktif per owner).
- Skala horizontal: worker dapat direplika — pg-boss mendukung multi-consumer; kunci kesamaan siklus adalah **advisory lock per objective** (§32/Concurrency), bukan jumlah worker.
- LLM adalah bottleneck biaya, bukan throughput → scaling utama adalah **context budgeting + caching research** (§22).

---

# 4. DATA FLOW

Siklus lengkap (satu `cycle_id` mengalir ke semua tabel sebagai correlation id):

```
POST /objectives (Idempotency-Key)
 → objectives(state=OBJECTIVE_CREATED)
 → orchestrator.advance()                                    [worker job]
 → NORMALIZE_OBJECTIVE: validasi field, hitung horizon tanggal (Asia/Jakarta)
 → state=OBJECTIVE_VALIDATED, event OBJECTIVE_VALIDATED
 → RESEARCH: Kimi.research(context) → opportunities[] (schema-valid)
 → state=RESEARCH_COMPLETE → ANALYZING
 → Economic Engine: hitung EV, margin, skor utk tiap opportunity (BUKAN Kimi)
 → Risk Engine: skor 13 dimensi utk top-5
 → OPPORTUNITIES_RANKED → Kimi.decide(SELECT) → OPPORTUNITY_SELECTED
 → EXPERIMENT: Kimi.designExperiment() → capital gate check → VALIDATING
 → Experiment selesai → MEASURING (window waktu) → RESULT_READY
 → Kimi.interpretResults() → DECISION_READY (decision row immutable)
 → Keputusan ITERATE/SCALE → Mission Engine membuat MISSION (version 1)
 → state=MISSION_CREATED → [autonomy gate] → MISSION_APPROVED
 → GLM.executeMission(mission_package) → EXECUTING
 → GLM Result kembali → Result Processor:
     schema valid? → tier verification → ledger entries (hanya RECONCILED+)
     → economic_snapshots turunan diperbarui
 → EXECUTION_COMPLETED → MEASURING → RESULT_READY → RESULT_ANALYZING
 → Kimi menganalisis → DECISION_READY → SCALE/ITERATE/PIVOT/KILL/WAIT/ESCALATE
 → event CYCLE_COMPLETED → siklus berikutnya dibuat otomatis (kecuali stop condition)
 → ACHIEVED bila current_profit ≥ target_profit (dari ledger, bukan dari Kimi)
```

---

# 5. STATE MACHINE

## 5.1 States (24 + 1 terminal tambahan `STOPPED` = 25 total — dikoreksi 2026-08-22 dari klaim "26+1": union From/To T01–T39 = 25; CHECK constraint §7 kini memuat tepat 25 state ini)

Terminal: `ACHIEVED`, `STOPPED`. Human-intervention: `HUMAN_APPROVAL_REQUIRED`, `BLOCKED`.

## 5.2 Tabel transisi (data-driven; disimpan sebagai kode + dicerminkan ke CHECK constraint)

| # | From | To | Trigger | Guard |
|---|------|----|---------|-------|
| T01 | IDLE | OBJECTIVE_CREATED | create_objective | — |
| T02 | OBJECTIVE_CREATED | OBJECTIVE_VALIDATED | normalize | schema valid ∧ horizon > now ∧ capital > 0 |
| T03 | OBJECTIVE_VALIDATED | RESEARCHING | start_research | tidak ada cycle aktif (lock) |
| T04 | RESEARCHING | RESEARCH_COMPLETE | kimi_research_ok | ≥1 opportunity schema-valid |
| T05 | RESEARCHING | BLOCKED | kimi_fail | retry ≥ 3 |
| T06 | RESEARCH_COMPLETE | ANALYZING | analyze | — |
| T07 | ANALYZING | OPPORTUNITIES_RANKED | ranked | semua skor dihitung engine |
| T08 | OPPORTUNITIES_RANKED | OPPORTUNITY_SELECTED | kimi_select | pilihan ∈ ranked list ∧ capital gate pass |
| T09 | OPPORTUNITY_SELECTED | VALIDATING | experiment_created | budget ≤ MAX_SINGLE_EXPERIMENT_LOSS |
| T10 | VALIDATING | RESULT_READY | experiment_done | window pengukuran lewat |
| T11 | OPPORTUNITY_SELECTED | MISSION_CREATED | skip_experiment | autonomy ≥ 3 ∧ risk < HIGH |
| T12 | RESULT_READY | MISSION_CREATED | kimi_mission | mission schema valid |
| T13 | MISSION_CREATED | MISSION_APPROVED | approve | autonomy ≥ 3 (auto) ATAU human approve |
| T14 | MISSION_CREATED | HUMAN_APPROVAL_REQUIRED | gate | capital > threshold ATAU irreversible ATAU autonomy ≤ 2 |
| T15 | MISSION_APPROVED | EXECUTING | dispatch_glm | tidak ada execution aktif (unique index) |
| T16 | EXECUTING | EXECUTION_COMPLETED | glm_result | result schema valid |
| T17 | EXECUTING | BLOCKED | glm_fail | retry ≥ 3 |
| T18 | EXECUTION_COMPLETED | MEASURING | measure_start | — |
| T19 | MEASURING | RESULT_READY | measured | metric window lengkap |
| T20 | RESULT_READY | RESULT_ANALYZING | kimi_analyze | — |
| T21 | RESULT_ANALYZING | DECISION_READY | kimi_decide | decision schema valid ∧ evidence wajib |
| T22 | DECISION_READY | SCALING | decision=SCALE | ledger support ∧ gates pass |
| T23 | DECISION_READY | ITERATING | decision=ITERATE | mission_version+1 dibuat |
| T24 | DECISION_READY | PIVOTING | decision=PIVOT | pivot_count < 3 |
| T25 | DECISION_READY | KILLING | decision=KILL | — |
| T26 | DECISION_READY | RESEARCHING | decision=WAIT_FOR_INFORMATION | — |
| T27 | DECISION_READY | HUMAN_APPROVAL_REQUIRED | decision=ESCALATE | — |
| T28 | SCALING | MISSION_CREATED | mission_v_next | budget gate |
| T29 | ITERATING | MISSION_CREATED | mission_v_next | — |
| T30 | PIVOTING | RESEARCHING | research_new | learnings terarsip |
| T31 | KILLING | OPPORTUNITIES_RANKED | reselect | ada alternatif ∧ kill_count < 3 |
| T32 | KILLING | RESEARCHING | research_fresh | ranked kosong |
| T33 | KILLING | BLOCKED | kill_budget_exhausted | kill_count ≥ 3 |
| T34 | HUMAN_APPROVAL_REQUIRED | (state sebelumnya) | approve | disimpan di `approvals.resume_state` |
| T35 | HUMAN_APPROVAL_REQUIRED | BLOCKED | reject/timeout | TTL default 72 jam |
| T36 | BLOCKED | RESEARCHING | resume | human action |
| T37 | DECISION_READY | ACHIEVED | profit ≥ target | **dari ledger** (Economic Engine), bukan klaim LLM |
| T38 | (apa pun) | STOPPED | stop_objective | human only; semua job dibatalkan |
| T39 | DECISION_READY | BLOCKED | ev_negative | expected_value < 0 dua siklus berturut |

**Invalid transition** = apa pun yang tidak ada di tabel → ditolak, `SYSTEM_ERROR` dicatat, state tidak berubah. **Retry transitions**: T05, T17 (dengan penghitung retry di `model_runs`/`executions`). Semua transisi dicatat ke `events` dengan `cycle_id`.

---

# 6. DOMAIN MODEL

Relasi inti (kardinalitas):

```
users 1─n objectives 1─n objective_versions
objectives 1─n cycles 1─n (opportunities, experiments, missions, decisions, events, economic_snapshots)
opportunities 1─n opportunity_evidence, 1─n experiments, 1─n missions
missions 1─n mission_versions 1─n executions 1─1 execution_results
objectives 1─n economic_snapshots; objectives 1─n capital_transactions (ledger)
objectives 1─n moat_snapshots; objectives 1─n approvals
memory: facts / beliefs(assumptions) / observations / decisions ── semua polymorphic ke (objective, opportunity, mission, experiment)
prompt_versions 1─n model_runs; model_runs n─1 cycles
```

Status enumerasi:
- Opportunity: `DISCOVERED, ANALYZED, RANKED, SELECTED, VALIDATING, ACTIVE, PAUSED, KILLED, REJECTED`
- Experiment: `DESIGNED, APPROVED, RUNNING, MEASURING, COMPLETED, FAILED, KILLED`
- Mission: `DRAFT, CREATED, APPROVED, EXECUTING, COMPLETED, FAILED, CANCELLED`
- Execution: `QUEUED, RUNNING, SUCCEEDED, PARTIAL, FAILED, TIMED_OUT`
- Verification tier: `SELF_REPORTED, EVIDENCED, RECONCILED, VERIFIED`
- Decision: `SELECT, ITERATE, PIVOT, KILL, WAIT_FOR_INFORMATION, SCALE, BLOCKED, ESCALATE_TO_HUMAN`

---

# 7. DATABASE SCHEMA

PostgreSQL 16. Semua tabel punya `created_at timestamptz NOT NULL DEFAULT now()`; tabel mutable punya `updated_at` + `row_version int NOT NULL DEFAULT 1` (optimistic concurrency). Uang: `NUMERIC(20,2)`. ID: `uuid DEFAULT gen_random_uuid()`. DDL ringkas tapi lengkap:

```sql
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
```

**Retention:** `events`, `capital_transactions`, `decisions`, `audit_logs` → append-only, retensi tak terbatas (arsip dingin setelah 24 bulan). `model_runs` 12 bulan. Observability metrics 13 bulan. Trigger `FORBID_MUTATION` menolak UPDATE/DELETE (dan TRUNCATE pada `events`) di 5 tabel append-only: `capital_transactions`, `events`, `decisions`, `mission_versions`, `audit_logs` — defense in depth di samping `REVOKE`; role aplikasi `aee_app` (NOLOGIN) hanya memegang SELECT+INSERT pada tabel-tabel itu.

---

# 8. API CONTRACT

Konvensi: semua endpoint butuh session (`auth` = role minimal). Semua `POST` menerima header `Idempotency-Key` (wajib untuk mutasi finansial/eksekusi). Error standar: `{error:{code,message,details?}}` dengan kode `VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, STATE_VIOLATION, GATE_VIOLATION, BUDGET_EXCEEDED, RATE_LIMITED, IDEMPOTENCY_CONFLICT, INTERNAL`. Rate limit default: 120 req/menit/user; `POST /objectives/:id/start` 10/menit. Mutasi mengembalikan `row_version` baru.

| Endpoint | Auth | Request (wajib) | Response 200/201 | Validasi & catatan |
|---|---|---|---|---|
| `POST /objectives` | owner | `{title,target_profit,capital_approved,horizon_months,market,risk_tolerance,autonomy_level?,environment?}` + Idempotency-Key | objective (state OBJECTIVE_CREATED) | Zod; idempotensi: key sama+hash beda → `IDEMPOTENCY_CONFLICT` |
| `GET /objectives/:id` | auditor+ | — | objective + snapshot ekonomi terbaru | — |
| `POST /objectives/:id/start` | owner | `{}` | `{cycle_id}` | Guard T03; CONFLICT bila cycle aktif |
| `POST /objectives/:id/pause` | operator+ | `{}` | objective | Membatalkan job antre; execution RUNNING dibiarkan selesai |
| `POST /objectives/:id/resume` | operator+ | `{}` | objective | Requeue advance job |
| `POST /objectives/:id/stop` | owner | `{reason}` | objective (STOPPED) | T38; irreversible → tercatat audit |
| `GET /cycles?objective_id=` | auditor+ | — | cycles[] | paginasi cursor |
| `GET /cycles/:id` | auditor+ | — | cycle + model_runs + events ringkas | — |
| `GET /opportunities?objective_id=&status=` | auditor+ | — | opportunities[] | sort risk_adjusted_score |
| `GET /opportunities/:id` | auditor+ | — | opportunity + evidence[] | — |
| `GET /experiments?objective_id=` | auditor+ | — | experiments[] | — |
| `GET /experiments/:id` | auditor+ | — | experiment + hasil ukur | — |
| `GET /missions?objective_id=&status=` | auditor+ | — | missions[] | — |
| `GET /missions/:id` | auditor+ | — | mission + versions[] + executions[] | — |
| `POST /missions/:id/approve` | owner | `{version}` | mission | T13/T14; version harus == current_version+1 terbaru; CONFLICT bila basi |
| `GET /executions?mission_id=` | auditor+ | — | executions[] | — |
| `GET /executions/:id` | auditor+ | — | execution + result (tier) | — |
| `POST /executions/:id/result` (callback GLM) | service | GLMResult (§10 kontrak) | `{accepted,verification_tier}` | Zod ketat; schema invalid → 422 + RESULT_REJECTED; duplikat execution → 200 idempoten |
| `GET /economics?objective_id=` | auditor+ | — | snapshot terbaru + deret waktu | Dihitung ulang dari ledger saat diminta `?recompute=1` (owner) |
| `GET /decisions?objective_id=` | auditor+ | — | decisions[] (immutable) | — |
| `GET /moat?objective_id=` | auditor+ | — | moat_snapshots[] + tren | — |
| `GET /events?objective_id=&type=&cursor=` | auditor+ | — | events[] | — |
| `POST /approvals/:id/approve` | owner | `{note?}` | approval + state resume | T34; EXPIRED → 409 |
| `POST /approvals/:id/reject` | owner | `{reason}` | approval (REJECTED) → BLOCKED | T35 |
| `GET /config/gates` · `PUT /config/gates` | owner | gate values | config | PUT butuh konfirmasi; perubahan diaudit |
| `POST /webhooks/payments/:provider` | signature | payload provider | `{received:true}` | Verifikasi HMAC Xendit/Midtrans; menaikkan tier RECONCILED |
| `GET /health` · `GET /metrics` | internal | — | status / Prometheus | — |

---

# 9. KIMI AGENT CONTRACT

Interface (TypeScript):

```ts
interface StrategicAgentProvider {
  research(input: ResearchInput): Promise<ResearchOutput>;
  rank_select(input: RankInput): Promise<SelectDecision>;
  designExperiment(input: ExperimentInput): Promise<ExperimentSpec>;
  designMission(input: MissionInput): Promise<MissionPackage>;   // kontrak §16
  interpretResults(input: ResultInput): Promise<DecisionRecord>; // SCALE/ITERATE/PIVOT/KILL/...
}
```

**Input** (dirakit Prompt Engine dari DB): `current_objective`, `economic_snapshot`, `opportunity_context`, `experiment_history`, `previous_decisions` (ringkas), `recent_glm_results` (tier-berlabel), `facts/assumptions/observations` terpilih, `moat_state`, `policies` (capital/risk/experiment), `output_schema` (JSON Schema).

**Output wajib schema-valid.** Contoh `DecisionRecord` (Zod):

```json
{
  "decision": "ITERATE",
  "subject_id": "uuid-mission",
  "reason": "string ≥ 50 chars",
  "evidence_ids": ["uuid", "..."],
  "metrics": {"revenue": 0, "cac": 0, "conversion": 0},
  "assumptions": ["..."],
  "confidence": 0.62,
  "expected_value_next": 1800000
}
```

Aturan keras: `evidence_ids` harus merujuk baris nyata di DB (validator memeriksa); `confidence ∈ [0,1]`; angka finansial dari Kimi diperlakukan sebagai **proposal**, direkam sebagai `assumptions`, tidak pernah ditulis ke ledger. Model default: `kimi-k3` via endpoint OpenAI-compatible Moonshot; `temperature 0.2` untuk decide, `0.4` untuk research.

---

# 10. GLM AGENT CONTRACT

Interface:

```ts
interface ExecutionAgentProvider {
  executeMission(pkg: MissionPackage, idem: string): Promise<ExecutionHandle>;
  getStatus(ref: string): Promise<ExecutionStatus>;
  cancel(ref: string): Promise<void>;
}
```

**GLM Result (schema ketat — semua field §11 dikelompokkan):**

```json
{
  "mission_id": "uuid", "mission_version": 1, "execution_id": "uuid",
  "status": "SUCCEEDED|PARTIAL|FAILED",
  "objective_status": "ON_TRACK|AT_RISK|FAILED|UNKNOWN",
  "summary": "string",
  "work": {"completed": ["task_id"], "files_created": [], "files_modified": [], "files_deleted": [], "systems_changed": []},
  "verification": {
    "tests_run": 0, "test_results": {"passed": 0, "failed": 0},
    "build_result": "PASS|FAIL|NOT_RUN", "deployment_result": "...", "runtime_result": "..."
  },
  "business_metrics": {
    "traffic": 0, "leads": 0, "customers": 0, "conversions": 0,
    "revenue": 0, "cost": 0, "profit": 0, "cac": 0, "retention": 0
  },
  "signals": {"observed_market_signal": "...", "customer_signal": "..."},
  "errors": [], "blockers": [], "assumptions": [], "unverified_items": [],
  "recommendation": "CONTINUE|STOP|ESCALATE",
  "evidence": [{"kind": "url|file|metric", "uri": "...", "sha256": "..."}]
}
```

**Validasi & gate integritas:**
1. Zod strict — field tak dikenal ditolak (`RESULT_REJECTED`, execution FAILED).
2. `mission_id+mission_version+execution_id` harus cocok execution RUNNING; selain itu → ditolak (anti duplikat/halusinasi referensi).
3. `business_metrics.revenue > 0` tanpa `evidence` → tier tetap `SELF_REPORTED` → **tidak menyentuh ledger**; naik ke `RECONCILED` hanya via webhook pembayaran atau bukti terverifikasi owner.
4. Hasil PARTIAL → tetap diproses dengan flag; eksperimen tidak boleh dinyatakan sukses dari PARTIAL.
5. Semua teks GLM diperlakukan sebagai **data tak tepercaya** saat kembali ke konteks Kimi (lihat G1).

GLM boleh memutuskan *how* (arsitektur teknis, kode), dilarang mengubah `objective, target_customer, business_model, pricing, success_criteria` — pelanggaran = hasil invalid otomatis. Model default: `glm-4.6` via endpoint OpenAI-compatible Zhipu; `temperature 0.1`.

---

# 11. ORCHESTRATOR

Implementasi (apps/worker):

```
advance(objective_id):
  db.transaction(tx):
    SELECT ... FOR UPDATE  + pg_advisory_xact_lock(hashtext(objective_id))
    s = loadState()
    t = transitionTable.find(s.state, guards(tx))
    if !t → emit SYSTEM_ERROR; return
    effect = effects[t.trigger]               // pure dispatcher
    effect.run(tx, s)                         // panggil engine/adapter; idempoten via key
    UPDATE objectives SET state=t.to, row_version=row_version+1
      WHERE id=? AND row_version=?            // optimistic concurrency
    INSERT events(...)
  queue.enqueue('advance', objective_id)      // rantai sampai state menunggu kerja async
```

- **Efek async** (panggil Kimi/GLM) dieksekusi sebagai job pg-boss terpisah dengan `retry: {limit:3, backoff:[30s,120s,480s]}`, lalu hasilnya memicu `advance` berikutnya. Orchestrator tidak pernah memblok menunggu LLM.
- **Determinisme:** untuk (state, data DB) yang sama, guard yang sama selalu lolos; semua keacakan LLM dibatasi di dalam adapter dan dicatat di `model_runs`.
- **Replay:** karena setiap transisi punya event + input/output hash, siklus dapat direkonstruksi penuh (`replay(cycle_id)` di CLI untuk debugging).
- **Stop conditions (§41) diperiksa sebagai guard global sebelum setiap transisi efek**: drawdown ≥ 4.000.000; EV < 0 dua siklus; gagal misi 3× berturut; provider error rate > 50% dalam 1 jam; anomali keamanan; approval pending. Salah satu aktif → paksa `BLOCKED`/`HUMAN_APPROVAL_REQUIRED`.

---

# 12. PROMPT ENGINE

Blok modular, masing-masing berversi (`prompt_blocks(name, version, template, policy_hash)` — bagian dari `prompt_versions.blocks`):

```
SYSTEM_POLICY        — aturan tak boleh dilanggar agen (jangan klaim fakta tanpa evidence, dll)
AGENT_ROLE           — KIMI: strategi; GLM: eksekusi; batas kewenangan eksplisit
ECONOMIC_POLICY      — target, batas modal, definisi metrik (read-only bagi LLM)
RISK_POLICY          — bobot & level risiko, gate CRITICAL
CAPITAL_POLICY       — MAX_* gates (§17) — dirender sebagai angka, bukan instruksi longgar
EXPERIMENT_POLICY    — aturan desain eksperimen
MOAT_POLICY          — preferensi strategi membangun moat
OUTPUT_SCHEMA        — JSON Schema + 1 contoh valid + 1 contoh invalid
CURRENT_OBJECTIVE / CURRENT_STATE / CURRENT_MISSION / CURRENT_RESULT
RELEVANT_MEMORY      — facts/assumptions/observations terpilih (berlabel jenisnya)
```

- **Assembly:** urutan tetap; setiap blok di-tokenize; **CONTEXT_BUDGET = 100.000 token input** — jika lewat, `RELEVANT_MEMORY` dikurangi dulu (skor relevansi = recency×0.3 + referenced×0.4 + kind-priority×0.3), lalu ringkasan (ringkasan disimpan sebagai `assumptions` kind=summary, arsip penuh tetap di DB — tidak ada kehilangan fakta).
- **Versioning:** perubahan blok mana pun → `version+1`; `model_runs` mencatat `prompt_version_id, model, model_version, temperature, token_limit, input_context_hash (SHA-256 JSON kanonik), output_hash` → keputusan dapat direproduksi/diaudit persis.
- **Anti injeksi:** konten dari GLM/web/evidence dibungkus penanda `<
