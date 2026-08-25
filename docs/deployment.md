# Deployment

> Jalur deploy TUNGGAL: `git push` ke `main` → hook post-push lokal
> menjadwalkan [`scripts/auto-deploy-fly.sh`](../scripts/auto-deploy-fly.sh) →
> gate build + typecheck + test → `flyctl deploy --remote-only` → health +
> smoke check.

## Alur lengkap (source → produksi)

```
SOURCE (main)
  ↓ git push origin main            # push tetap sukses walau deploy gagal
POST-PUSH HOOK (lokal)
  ↓ menjadwalkan auto-deploy-fly.sh (background, log di $LOCALAPPDATA/Temp/fly-auto-deploy.log)
AUTO-DEPLOY SCRIPT
  1. npm run build                  # landing + dashboard → packages/api/assets/*.html
  2. Gate: typecheck · typecheck:ui · test:ui
  3. flyctl deploy --app aurex-api --remote-only   # build image terjadi di Fly
  4. Health check https://aurex-api.fly.dev/health (retry 5×15s)
     + npx tsx scripts/smoke-prod.ts
FLY CONTAINER START
  └ serve-prod.ts menjalankan migrasi otomatis saat start
    (run-migrations.ts — idempotent + checksum sha256)
```

## Prasyarat mesin lokal

- Node 20+, npm.
- `flyctl` terautentikasi, atau file `.fly-token` (git-ignored) / env
  `FLY_API_TOKEN`. Tanpa token → script keluar dengan aman (skip).
- Konfigurasi app: [`fly.toml`](../fly.toml), region `sin`, Postgres 16
  (`aurex-db`).

## Migrasi database

Migrasi **immutable** (001–009): sudah diterapkan = tidak boleh diedit;
checksum sha256 divalidasi saat eksekusi (`packages/db/src/migrate-cli.ts`).
Migrasi baru = file baru bernomor lanjut. Status: `npm run migrate:status`.

## Rollback & insiden

- Deploy gagal pada gate (build/typecheck/test) → tidak ada perubahan di Fly;
  push sudah masuk origin, perbaiki lalu push lagi.
- Health check gagal pasca-deploy → log transkrip ada di
  `$LOCALAPPDATA/Temp/fly-auto-deploy.log`; perbaiki forward-only (jangan
  rollback DB) dan deploy revisi berikutnya.
- Ledger bersifat append-only — jangan pernah "memperbaiki" data finansial
  lewat UPDATE manual; gunakan koreksi sebagai entri baru sesuai tier
  verifikasi.

## Verifikasi pasca-deploy

```bash
curl -s https://aurex-api.fly.dev/health
BASE=https://aurex-api.fly.dev npx tsx scripts/e2e-canonical-cookie.ts   # 20 langkah kanonikal
```

E2E memakai cookie session asli (node fetch tidak auto-cookie) — lihat
[testing.md](testing.md).
