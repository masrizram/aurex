# AEE — Autonomous Economic Engine

Implementasi berbasis spec `IDEA.md` (§7 = DDL canonical ter-audit) + misi asli 47 seksi
(sesi Kimi `20260822_212730`). Status: **Phase 0–14 HIDUP** — TS strict, tsc 0 error,
102/102 vitest, migration teruji empiris di PostgreSQL 16, orchestrator transaksional
+ pg-boss terverifikasi integrasi 20/20.

## Struktur

```
packages/
  money/         D5  — Money/Decimal.js, NUMERIC(20,2), bukti determinisme vs float
  domain/        D4  — FSM 25 state, 39 transisi T01–T39 verbatim §5.2, stop conditions §41
  contracts/     D6  — Zod strict: DecisionRecord (§9), GlmResult (§10), API (§8), tier D8
  economics/     D7  — ledger double-entry, snapshot §15, capital gates §17, capitalPlan §1,
                      computeOpportunityScores (deterministik, guard T07 all_scores_by_engine)
  agents/        §29 — provider Kimi/GLM + mock, retry backoff 30s/2m/8m → AgentExhaustedError,
                      repair-loop Kimi 1× (GLM tanpa repair §10-1), postValidate, ModelRunRecord
  orchestrator/  §11 — guard evaluator + runtime DB: advance() = 1 transisi
                      (FOR UPDATE + pg_advisory_xact_lock + optimistic row_version +
                       event + re-enqueue), JobQueue InMemory + pg-boss v10, agent job runner,
                       T34 resume, intakeResult wiring
  db/            — Pool owner/runtime + migrate runner (checksum sha256, transaksi per file)
migrations/
  001_core_schema.sql          = ddl_patched.sql BYTE-IDENTIK (sha256 28d572f1…b311c83)
  002_orchestrator_grants.sql  — GRANT UPDATE kolom terbatas utk runtime role (§11)
scripts/
  orch_reset.sh          — reset container scratch aee-orch-pg (WSL docker, port 55433)
  run-migrations.ts     — jalankan 001+002 (owner), laporan checksum JSON
  verify-db.ts          — 8 langkah verifikasi empiris (katalog, role, izin runtime)
  verify-orchestrator.ts — 48 langkah integrasi runtime (happy walk, race, idempoten,
                          stop, terminal, RBAC, pg-boss roundtrip, events; Phase 8–9:
                          interpret→decision→mission v2, webhook RECONCILED, T37 ACHIEVED;
                          Phase 10–11: API HTTP penuh — create/start/approve/webhook/callback)
  verify_pipeline.sh    — orkestrasi lengkap (reset → migrate → verify-db →
                          verify-orchestrator → down)
```

## Perintah

```bash
npm install
npm run typecheck        # tsc --noEmit strict
npm test                 # vitest run (127 test)
npm run migrate          # terapkan migrations/ ke DATABASE_URL (owner)
bash scripts/verify_pipeline.sh   # verify-db 8/8 + orchestrator 48/48
```

Variabel lingkungan pipeline (container scratch port 55433):

- `DATABASE_URL` — owner (migrasi; pg-boss = infrastruktur owner-managed)
- `DATABASE_APP_URL` — role `aee_app` LOGIN (runtime orchestrator; SELECT+INSERT 001 +
  UPDATE kolom terbatas 002)

## Desain penting Phase 6

- **advance() = satu transaksi per transisi** (§11): `BEGIN` →
  `SELECT pg_advisory_xact_lock(hashtext($objectiveId))` →
  `SELECT … FOR UPDATE` → guard dievaluasi dari konteks DB → efek idempoten →
  `row_version` optimistic concurrency → INSERT event → re-enqueue.
- **Race dua koneksi → tepat satu pemenang** (teruji S9: ok=1, rej=1, row_version naik
  tepat 1 dari default).
- **pg-boss v10 wajib `createQueue()` sebelum `send()`** — tanpa itu INSERT gagal
  SENYAP (return null; hanya queue internal `__pgboss__send-it` yang dibuat).
  `PgBossQueue` membuat queue sekali per proses lalu `send` dengan
  `singletonKey = idem` (dedup §21).
- **Identitas paket vs identitas DB** (§10-2 anti-halusinasi): idempotency key &
  echo-mission_id GLM memakai `pkg.mission_id` (identitas paket Kimi), sedangkan FK
  `executions.mission_id` tetap PK DB — keduanya konsisten per jalur.
- **T02 chicken-and-egg deadline (GAP-07)**: guard memakai deadline DB bila terisi,
  else `createdAt + horizonMonths` (deadline diisi EFEK transisi T02 sendiri).
- **Mission siklus pertama**: tanpa decision sebelumnya, runner mencatat decision
  sistem ITERATE (self-consistent dengan §16) sebelum `designMission`.
- **Terminal state STOPPED**: tanpa transisi keluar (S12) — INVALID_TRANSITION.
- **RBAC**: runtime ditolak UPDATE ledger (S13 permission denied, sesuai DDL);
  `prompt_versions` upsert butuh UPDATE `template_hash` (grant 002).

## Kendala lingkungan (terverifikasi)

- `node`/`npm` HANYA di Windows; WSL hanya docker+psql → verifikasi DB dijalankan
  dari sisi Windows (container tetap via `wsl.exe`).
- Env var TIDAK menyeberang batas WSL→proses-Windows tanpa WSLENV → pipeline
  satu sisi (Windows) yang telah terbukti.
- **WSL VM idle-shutdown antar-panggilan `wsl.exe`** membunuh container → semua
  langkah DB dirangkai dalam satu rangkaian; container memakai
  `--restart unless-stopped`.
- Role runtime: `aee_app` (SELECT+INSERT via 001; UPDATE kolom terbatas via 002;
  LOGIN diaktifkan pipeline) + login member `aee_runtime` (verify-db) — pola temurute.

## Fase berikutnya (roadmap §37)

Phase 8–9: mission & result processor (async polling provider, tier reconciliation) →
Phase 11: dashboard → Phase 14: E2E demo §36.

## Desain penting Phase 8–9 (mission manager + result processor)

- **Mission manager** (`packages/orchestrator/src/mission-manager.ts`): menuntaskan
  siklus setelah RESULT_READY — T20 `kimi_analyze` → T21 `kimi_decide`
  (Kimi.interpretResults; evidence = execution id nyata dari DB, GAP-05) →
  cabang T22–T27/T37/T39 → T28/T29 mission v+1 → gerbang otonomi T13/T14.
- **Mission v+1 dibuat SEBELUM advance cabang** — guard `mission_version_next_created`
  dievaluasi SAAT transisi; job `mission_next` tetap ada sebagai jalur re-entry
  idempoten.
- **Result processor** (`result-processor.ts`): `processPaymentWebhook` — verifikasi
  HMAC-SHA256 timing-safe → lookup execution via idempotency_key ↔ external_id →
  tolak duplikat (`webhook:{ext}:{kind}`) → validasi amount ≤ klaim → naikkan tier
  hasil ke RECONCILED → INSERT ledger double-entry (REVENUE: debit CASH credit
  REVENUE) → refresh snapshot turunan §15.
- **T37 ACHIEVED memakai profit LEDGER** (`achievedFromLedger`), bukan klaim GLM —
  teruji S27 (net 500rb < target → belum) dan S28 (2.1jt ≥ 2jt → ACHIEVED).
- **T39 ev_negative**: kondisi global "EV<0 dua siklus" tidak memblok transisi
  `ev_negative` itu sendiri (T39 adalah JALUR menuju BLOCKED) — pengecualian di
  `evaluateStopConditions(ctx, trigger)`.
- **Polling async** (`pollExecution`): provider tanpa hasil sinkron dipoll
  `getStatus(ref)` hingga terminal; hasil diteruskan ke intake yang sama.
- **Grant 002 + `UPDATE (verification_tier) ON execution_results`** — rekonsiliasi
  webhook menaikkan tier (bukti pembayaran = bukti verifikasi).

## Berikutnya (roadmap)

Phase 10–14: API gateway (§8) + dashboard (§36 demo E2E) + hardening.

## Desain penting Phase 10–11 (API gateway)

- **@aee/api** (`packages/api/src/index.ts`): Fastify REST, tanpa business logic —
  validasi Zod contracts, sesi X-User-Id → users.role, rank role owner > operator
  > auditor (+ service khusus callback GLM), error envelope standar §8
  `{error:{code,message,details?}}`.
- **Idempotency POST /objectives** (§7): header Idempotency-Key wajib; key PK
  idempotency_keys, request_hash SHA-256 body kanonik; key sama + hash beda →
  409 IDEMPOTENCY_CONFLICT; key sama + hash sama → 200 replay response tersimpan.
- **Webhook signature-authenticated** (bukan sesi): content-type parser kustom
  menyimpan raw body byte-exact (WeakMap per-request) → HMAC-SHA256 timing-safe;
  SIGNATURE_INVALID → 401 UNAUTHORIZED. Sesuai §8 "signature" role.
- **T34 approve handler**: UPDATE approvals → advance approve (resolve {resume_state}
  → MISSION_CREATED) → advance approve kedua dengan humanApproved=true (T13) →
  enqueue dispatch_glm. resolveTarget fallback: APPROVED terbaru ≤5 menit bila
  tak ada PENDING (API meng-UPDATE status sebelum advance — urutan idempoten).
- **Grant 002 + approvals**: UPDATE (status, decided_by, decided_at, payload).

## Desain penting Phase 12–14 (worker process + dashboard E2E §36)

- **`apps/worker`** — proses worker nyata: boss pg-boss (superuser) + pool aee_app;
  konsumsi antrean `advance` via `fetch()` loop (batchSize 1, poll 500ms default,
  mode `drain` untuk verifikasi); dispatch per kind — kind mission
  (`interpret_results`/`mission_next`) → `dispatchJob` (mission-manager), kind lain →
  `runAgentJob` (runtime) — persis worker produksi. `boss.on('error')` di-swallow-log
  (koneksi WSL diputus 57P01 tidak boleh crash proses); graceful `stop()` idempoten.
- **Dashboard §36** — `packages/api/assets/dashboard.html` (Economic Control Center):
  vanilla JS, konsumsi REST murni (GET /objectives + snapshot, GET /approvals?,
  POST /approvals/:id/decision, POST /objectives + start, seed-user demo); disajikan
  API di `GET /`. Tanpa build chain — antarmuka fungsional, bukan toolchain.
- **Endpoint list/seed** — `GET /objectives` (list + snapshot terakhir via
  `DISTINCT ON (objective_id) ... ORDER BY created_at DESC`; kolom sesuai DDL:
  revenue/gross_profit/operating_profit/roi), `GET /approvals?objective_id=`,
  `POST /dev/seed-user` (idempoten, owner, demo bootstrap).
- **E2E S40–S44b** — app kedua (queue = PgBossQueue) + worker nyata: obj4 autonomy-3
  create→start→**worker memproses sendiri** hingga EXECUTION_COMPLETED (423+ job,
  siklus mission ITERATE berulang); job `research` duplikat → idempoten (event
  OPPORTUNITIES_RANKED tetap 1, tanpa regresi state); dashboard 200; list memuat
  obj4; seed-user idempoten; worker stats tanpa crash.
- **Bug nyata ditemukan**: `pg-boss v10 complete(name, id)` dua argumen; job
  partitioned per-queue (lihat `pgboss.j*`); API queue harus PgBossQueue yang sama
  dengan worker (InMemoryQueue = job tak pernah sampai); `max(uuid)` tidak ada.
- **Lingkungan**: port-forward localhost WSL memutus koneksi aktif (57P01 "administrator
  command") saat loop polling dari Windows — solusi: `AEE_DB_HOST=$(wsl.exe -e bash -c
  "hostname -I | awk '{print $1}'")` → koneksi via IP WSL langsung (container perlu
  `-p 0.0.0.0:55433:5432`); `verify_pipeline.sh` kini menerima `AEE_DB_HOST`.

## Verifikasi kumulatif (pasca Phase 14)

| Layer | Hasil |
|---|---|
| TS strict | `tsc --noEmit` 0 |
| Unit | vitest **136/136** (10 file; +3 worker, +6 API dashboard) |
| Integrasi runtime | verify-orchestrator **55/55** (S1–S29 runtime · S30–S39 API HTTP · S40–S44b worker+dashboard E2E) |
| Integrasi DB | verify-db **8/8** |
| Pipeline penuh | `AEE_DB_HOST=<ip> bash scripts/verify_pipeline.sh` → `SCRIPT_EXIT=0|0` |

## Phase 15 — Business-Identity Domain Redesign

### Masalah
Dashboard menampilkan financial objective (target profit → capital → progress) tanpa business identity.
User melihat "Generate Rp2M operating profit" tapi tidak tahu: bisnis apa? produk apa? pelanggan siapa?
Objective terisolasi dari konteks bisnis — angka melayang tanpa arti.

### Solusi: Business Venture sebagai wajib
Setiap objective **wajib** menempel pada Business Venture (tabel `business_ventures`):
- **Mode A (GIVEN)** — user sudah tahu bisnisnya: definisi bisnis (nama, industri, pelanggan, problem, solusi, model)
  disertakan saat create objective. Venture dibuat otomatis, objective langsung punya identitas.
- **Mode B (DISCOVERY)** — user belum tahu bisnisnya: Kimi melakukan research → rank_select → opportunity terpilih
  menjadi Business Venture otomatis (origin=`KIMI_DISCOVERED`). Event `BUSINESS_SELECTED` tercatat di lineage.

### Domain model (baru)
```
BUSINESS VENTURE → ECONOMIC OBJECTIVE → CYCLE → RESEARCH → OPPORTUNITIES → RANK_SELECT
  ↓ (Mode B: venture diciptakan di sini)                              ↓
  event BUSINESS_SELECTED                                          EXPERIMENT → MISSION →
                                                                  EXECUTION → RESULT → DECISION → NEXT CYCLE
```

### Migration 003
```sql
CREATE TABLE business_ventures (
  id uuid PRIMARY KEY, user_id uuid, name, industry, market, target_customer,
  problem, solution, business_model, price, origin, source_objective_id, ...
);
ALTER TABLE objectives ADD COLUMN business_venture_id, business_mode;
```
- 001 checksum-locked (`28d572f112ad851a`) — TIDAK diubah.
- 25 tabel (24 + business_ventures), 9 CHECK di objectives (+1 business_mode).

### API baru
| Endpoint | Fungsi |
|---|---|
| `POST /ventures` | Buat business venture standalone |
| `GET /ventures` | List ventures + objective_count |
| `GET /agent-mode` | Badge REAL/MOCK — model KIMI + GLM |
| `POST /objectives` | +`business_mode`, +`business` (inline), +`business_venture_id` |
| `GET /objectives/:id` | +business, +strategy, +execution, +last_decision |

### Dashboard rombak total
- Header: badge REAL/MOCK (agent mode)
- Form create: 2 tab (Discovery / I know the business)
- List: kolom Bisnis + Objective + State + Progress
- Detail: 6 panel — 🎯 Business / 💰 Economics / 🧠 Strategic / ⚙️ Execution / 📊 Result / 🧠 Decision
- Event lineage: termasuk event `BUSINESS_SELECTED`

### Industrialisasi: agent REAL via 9router
- `createAgents()` factory: env-driven — `KIMI_API_KEY`+`KIMI_BASE_URL` → adapter nyata; fallback Mock.
- `runValidated()`: JSON Schema (dari Zod via `zod-to-json-schema`) di-inject ke system message — model tahu format output.
- Model: `openrouter/cohere/north-mini-code:free` (KIMI/strategic), `openrouter/nvidia/nemotron-3.5-lightning:free` (GLM/execution).
- Endpoint: `http://localhost:20128/v1` (OpenAI-compatible, `response_format: json_object` dihormati).

### Verifikasi kumulatif (pasca Phase 15)

| Layer | Hasil |
|---|---|
| TS strict | `tsc --noEmit` 0 |
| Unit | vitest **136/136** (10 file) |
| Integrasi runtime | verify-orchestrator **55/55** |
| Integrasi DB | verify-db **8/8** (25 tabel, 3 migrasi) |
| Pipeline penuh | `SCRIPT_EXIT=0|0` |
| Smoke live (REAL) | Mode A 201→200 business=YES · Mode B 201→200 business=NULL→pending · /ventures 200 · /agent-mode REAL |
