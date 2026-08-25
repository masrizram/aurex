# Arsitektur

> Dokumen kanonik arsitektur AUREX. Keputusan historis pembekuan frontend
> ada di [ARCHITECTURE-FREEZE.md](ARCHITECTURE-FREEZE.md); peta migrasi UI di
> [ui-migration-map.md](ui-migration-map.md).

## Tiga lapisan produk

| Lapisan | Isi | Lokasi |
|---|---|---|
| **A — SaaS pelanggan** | Landing, auth, organizasi, onboarding, langganan/entitlement, settings | `apps/landing`, `apps/dashboard` (`/app/*`), rute auth/onboarding/billing di `packages/api` |
| **B — Produk ekonomi** | Businesses, objectives, opportunities, experiments, missions, approvals, results, Economic Control Center | `apps/dashboard` (`/app/*`), rute produk di `packages/api/src/routes/` |
| **C — Engine AEE** | Agent strategis (Kimi) & eksekusi (GLM), orchestrator FSM, queue, economic engine, risk gates, mission manager, result processor, verifikasi bukti, ledger, memory | `packages/agents`, `packages/orchestrator`, `packages/economics`, `apps/worker` |

## Struktur repositori

```
apps/
  landing/     Landing page statis — Vite single-file → packages/api/assets/landing.html
  dashboard/   React 19 + shadcn-admin SPA (/app pelanggan, /admin operator)
               → packages/api/assets/dashboard.html
  worker/      Proses pg-boss: konsumsi job agent & misi
packages/
  contracts/   Zod strict — kontrak lintas batas (DecisionRecord, GlmResult, API)
  domain/      FSM 25 state / transisi T01–T39 + tenancy
  money/       Money (Decimal.js, NUMERIC(20,2)) — determinisme finansial
  economics/   Ledger double-entry, snapshot ekonomi, capital gates, scoring
  agents/      Adapter provider strategis & eksekusi + mock, retry, metering
  orchestrator/ advance() transaksional, guard FSM, mission manager, result processor
  db/          Pool owner/runtime + migrasi checksum + kredensial dev terpusat
  api/         Fastify gateway — entrypoint tipis + routes/ per domain
migrations/    001–009 — IMMUTABLE (checksum sha256 terkunci; jangan diedit)
scripts/       Entrypoint dev/prod, verify pipeline, QA/E2E
docs/          Dokumentasi kanonik
```

Monorepo npm workspaces (`packages/*`) + dua app dengan lockfile sendiri
(`apps/dashboard`, `apps/landing`). Root `tsconfig.json` mencakup backend &
scripts; masing-masing app mengecek dirinya sendiri (`npm run typecheck:ui`).

## Aturan boundary (ditegakkan)

1. **API tanpa business logic** — rute hanya: validasi Zod → authorization →
   delegasi ke service/domain → response envelope §8.
2. **Aturan bisnis hidup di `packages/*`** (capital gates, threshold risiko,
   transisi objective, kalkulasi ekonomi, tier verifikasi) — tidak diduplikasi
   di frontend, API, worker, atau test.
3. **Satu transisi FSM = satu transaksi** — `SELECT … FOR UPDATE` + advisory
   lock + `row_version` optimistik + event; tidak ada penulisan engine di luar
   `advance()`.
4. **Ledger append-only** — idempotency dan tier verifikasi tidak boleh
   dilemahkan oleh refactor akses data.
5. **Uang selalu `@aee/money`** (Decimal.js, skala 2) — tidak ada aritmetika
   float pada nilai finansial.
6. **Arah dependensi**: `api → orchestrator/economics/agents → db`;
   `worker → orchestrator → agents/economics → db`; frontend hanya lewat
   REST (`apps/dashboard/src/lib/api.ts`). Tidak ada siklus antar-paket.
7. **Terminologi engine tidak bocor ke UX pelanggan** — `RESULT_READY`,
   `MISSION_CREATED`, nama model, token count hanya di `/admin/*`
   (lihat ARCHITECTURE-FREEZE.md).
8. **Kontrak lintas batas dideklarasikan sekali** di `packages/contracts`
   (Zod strict) — tidak ada DTO ganda yang tidak kompatibel.

## Frontend

- Baseline UI: **shadcn-admin** (atribusi: `apps/dashboard/UPSTREAM_LICENSE.txt`).
- Provider composition eksplisit dengan test hierarki
  (`apps/dashboard/test/provider-hierarchy.test.tsx`) — pemuatan rute langsung
  maupun lazy tidak boleh melewati provider (regresi `useSearch` sudah ditutup).
- Akses HTTP terpusat di `apps/dashboard/src/lib/api.ts`.

## Konfigurasi environment

Semua env dibaca lewat helper terpusat (`packages/db` untuk koneksi;
`.env.example` sebagai daftar resmi variabel). Tidak ada kredensial literal di
source — lihat [security](security.md) untuk kebijakan.
