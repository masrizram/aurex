# Berkontribusi pada AUREX

Terima kasih sudah mau berkontribusi. Dokumen ini menjelaskan cara bekerja di
repo ini agar perubahan tetap aman terhadap perilaku produksi yang terverifikasi.

## Setup cepat

```bash
npm install                          # root workspaces (packages/*)
npm install --prefix apps/dashboard  # SPA
npm install --prefix apps/landing    # landing
cp .env.example .env      # isi DATABASE_URL, DATABASE_APP_URL, AEE_DEV_DB_PASSWORD
npm run migrate           # butuh Postgres 16 lokal/Docker
npx tsx scripts/serve.ts  # dev server :3000
```

Detail environment: [README.md](README.md#konfigurasi-environment) · arsitektur:
[docs/architecture.md](docs/architecture.md).

## Strategi branch

- `main` selalu deployable — setiap commit harus lolos gate.
- Branch fitur: `feat/<topik>`, perbaikan: `fix/<topik>`, repo hygiene:
  `chore/<topik>` dari `main` terbaru.
- Satu PR = satu concern. Jangan campur refactor struktural dengan perubahan
  perilaku.

## Konvensi commit

Conventional Commits:

```
fix(api): validasi capital gate pada POST /objectives
refactor(economics): ekstrak scoring snapshot
chore(cleanup): hapus script one-off
```

Scope = area utama (`api`, `economics`, `orchestrator`, `dashboard`, `landing`,
`worker`, `db`, `docs`, `cleanup`).

## Sebelum membuka PR — gate wajib

```bash
npm run typecheck        # tsc strict backend+scripts
npm run typecheck:ui     # tsc dashboard+landing
npm test                 # vitest node
npm run test:ui          # vitest jsdom dashboard
npm run build            # landing + dashboard
```

Perubahan alur produk wajib melampirkan hasil E2E canonical:
`BASE=<url> npx tsx scripts/e2e-canonical-cookie.ts`.

## Aturan arsitektur (diperiksa saat review)

1. API tetap tipis: validasi Zod → authorization → delegasi. Business logic
   hidup di `packages/*`.
2. Satu transisi FSM = satu transaksi via orchestrator — jangan menulis state
   engine langsung dari rute/worker lain.
3. Uang hanya lewat `@aee/money`; ledger append-only tidak boleh dilemahkan.
4. Kontrak baru dideklarasikan di `packages/contracts` (Zod strict).
5. Terminologi internal engine (`RESULT_READY`, nama model, token count)
   tidak tampil di UX pelanggan `/app/*` — hanya `/admin/*`.
6. Migrasi DB immutable: tambah file baru bernomor lanjut, jangan edit yang
   lama.
7. Tidak ada kredensial literal di source; variabel env baru harus masuk
   `.env.example`.
8. Hapus kode mati dengan bukti zero-importer (git history adalah arsip).

## Gaya kode

- TypeScript strict; hindari `any`, unsafe cast, `ts-ignore` tanpa komentar
  alas.
- Nama file kebab-case, komponen React PascalCase, konstanta UPPER_SNAKE_CASE.
- Test colocated di `<pkg>/test/*.test.ts`; nama deskriptif perilaku.
- Komentar menjelaskan WHY, bukan apa yang sudah jelas dari kodenya.

## Melaporkan kerentanan

Jangan buka issue publik untuk masalah keamanan — ikuti
[SECURITY.md](SECURITY.md).
