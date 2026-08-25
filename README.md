# AUREX — Autonomous Economic Engine

> **Economic Intelligence & Execution platform**: dari tujuan bisnis menjadi
> siklus *objective → opportunity → experiment → mission → approval → execution
> → verification → result → economic impact* yang berjalan otonom dengan dua
> peran model AI (strategis & eksekusi), lengkap dengan ledger double-entry,
> verifikasi bukti berjenjang, dan Economic Control Center.

Status produksi: API + worker berjalan di [aurex-api.fly.dev](https://aurex-api.fly.dev)
(PostgreSQL 16, Fly.io region `sin`). UI baseline: shadcn-admin
(lihat [`apps/dashboard/UPSTREAM_LICENSE.txt`](apps/dashboard/UPSTREAM_LICENSE.txt)).

## Arsitektur singkat

```
apps/
  landing/    Landing page (Vite single-file → packages/api/assets/landing.html)
  dashboard/  React 19 + shadcn-admin SPA (→ packages/api/assets/dashboard.html)
  worker/     Proses worker pg-boss: konsumsi job agent & mission
packages/
  contracts/   Zod strict — kontrak lintas batas (DecisionRecord, GlmResult, API)
  domain/      FSM 25 state / transisi T01–T39 + tenancy
  money/       Money (Decimal.js, NUMERIC(20,2)) — determinisme finansial
  economics/   Ledger double-entry, snapshot ekonomi, capital gates, scoring
  agents/      Provider strategis (Kimi) & eksekusi (GLM) + mock, retry, metering
  orchestrator/ advance() transaksional, guard FSM, mission manager, result processor
  db/          Pool owner/runtime + migrasi checksum + kredensial dev terpusat
  api/         Fastify gateway — rute per domain di packages/api/src/routes/
migrations/    001–009 (immutable, checksum sha256 terkunci)
scripts/       Dev/prod entrypoint, verify pipeline, QA/E2E vs produksi
docs/          Dokumentasi kanonik (arsitektur, alur produk, deployment, testing)
```

Aturan arsitektur inti: **API tanpa business logic** (validasi Zod + authZ +
delegasi); aturan bisnis hidup di `packages/*`; satu transisi FSM = satu
transaksi (`FOR UPDATE` + advisory lock + `row_version` optimistik + event).

## Mulai cepat (lokal)

Kebutuhan: Node 20+, PostgreSQL 16 (lokal atau Docker), npm.

```bash
git clone <repo-url> && cd econos
cp .env.example .env        # isi DATABASE_URL, DATABASE_APP_URL, AEE_DEV_DB_PASSWORD
npm install                 # root workspaces (packages/*) — runner test & tooling backend
npm install --prefix apps/dashboard   # SPA (lockfile sendiri)
npm install --prefix apps/landing     # landing (lockfile sendiri)
npm run migrate             # terapkan migrations/ (owner)
npx tsx scripts/serve.ts    # dev: API + worker + dashboard di :3000
```

Produksi-setara lokal: `npx tsx scripts/serve-prod.ts` (wajib `DATABASE_URL` +
`DATABASE_APP_URL`; menjalankan migrasi otomatis saat start).

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run typecheck` | tsc strict (backend + scripts) |
| `npm run typecheck:ui` | tsc dashboard + landing |
| `npm test` | vitest backend/node (144 test) |
| `npm run test:ui` | vitest jsdom dashboard (9 test provider/route) |
| `npm run build` | build landing + dashboard → `packages/api/assets/*.html` |
| `npm run migrate` | migrasi DB (idempoten, checksum) |
| `bash scripts/verify_pipeline.sh` | integrasi penuh vs container scratch |
| `BASE=<url> npx tsx scripts/e2e-canonical-cookie.ts` | E2E canonical journey |

## Konfigurasi environment

Semua lewat `.env` (lihat `.env.example`) — **tidak ada kredensial literal di
source**:

- `DATABASE_URL` — owner (migrasi DDL saja)
- `DATABASE_APP_URL` — role runtime terbatas (SELECT+INSERT; UPDATE kolom terbatas)
- `AEE_DEV_DB_PASSWORD` — password Postgres kontainer dev untuk tooling lokal
- `KIMI_API_KEY` / `GLM_API_KEY` (+ `*_BASE_URL`, `*_MODEL`) — provider AI;
  tanpa key → mode MOCK
- `WEBHOOK_SECRET` — HMAC webhook pembayaran
- `AEE_DEV_MODE=1` — mengaktifkan fallback header `X-User-Id` (dev saja;
  otomatis mati saat `NODE_ENV=production`)

## Testing

Unit/integrasi: `npm test` · UI: `npm run test:ui` · Pipeline integrasi penuh:
`bash scripts/verify_pipeline.sh` (butuh Docker via WSL pada setup ini) ·
E2E produksi: `scripts/e2e-canonical-cookie.ts`. Detail:
[docs/testing.md](docs/testing.md).

## Deployment

Jalur tunggal: push ke `main` → hook `pre-push` menjadwalkan
`scripts/auto-deploy-fly.sh` → build + typecheck + test gate →
`flyctl deploy --remote-only` → health + smoke check. Detail:
[docs/deployment.md](docs/deployment.md).

## Dokumentasi

- [docs/architecture.md](docs/architecture.md) — lapisan, boundary, desain engine
- [docs/product-flow.md](docs/product-flow.md) — alur kanonik pelanggan
- [docs/deployment.md](docs/deployment.md) — build, deploy, operasi
- [docs/testing.md](docs/testing.md) — strategi & gate pengujian
- [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [LICENSE](LICENSE)

## Lisensi

MIT — lihat [LICENSE](LICENSE). Baseline UI shadcn-admin mempertahankan
pemberitahuan lisensinya di
[`apps/dashboard/UPSTREAM_LICENSE.txt`](apps/dashboard/UPSTREAM_LICENSE.txt).
