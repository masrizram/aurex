# Keamanan

> Model ancaman ringkas dan kontrol yang aktif di AUREX. Kebijakan
> pelaporan kerentanan: [SECURITY.md](../SECURITY.md).

## Autentikasi & sesi

- Password di-hash (scrypt) — tidak ada penyimpanan kredensial plaintext.
- Sesi = cookie HttpOnly SameSite=Lax; rotasi & expiry dikelola API.
- `X-User-Id` fallback hanya hidup saat `AEE_DEV_MODE=1` dan otomatis mati
  saat `NODE_ENV=production` — tidak bisa menyamar sebagai jalur authz prod.

## Otorisasi & isolasi tenant

- Setiap request produk melewati resolusi sesi → keanggotaan organization
  (`role`: owner / auditor / service) sebelum handler; admin terpisah dari
  surface pelanggan.
- Isolasi data per-organization di level query (setiap statement menscope
  `org_id`) — diuji di unit suite dan verify pipeline (BOLA/IDOR).

## Integritas finansial

- Ledger double-entry **append-only** dengan idempotency key dan tier
  verifikasi bukti; rekonsiliasi tidak boleh dilewati.
- Uang = `@aee/money` (Decimal.js, NUMERIC(20,2)) — tanpa aritmetika float.
- Webhook pembayaran divalidasi HMAC-SHA256 + idempotency (unit test).

## Secret

- Tidak ada kredensial literal di source (aturan §24) — semua lewat env,
  template resmi `.env.example`. Tooling dev membaca `AEE_DEV_DB_PASSWORD`.
- Koneksi DB dipisah: `DATABASE_URL` (owner, migrasi saja) vs
  `DATABASE_APP_URL` (runtime SELECT+INSERT; UPDATE kolom terbatas).
- Token deploy dibaca dari env atau file lokal git-ignored (`.fly-token`);
  tidak pernah dicetak/log.

## Supply chain & operasi

- Dependensi runtime minimal (fastify, pg, pg-boss, zod, decimal.js);
  audit manual tiap penambahan paket.
- Build produksi berjalan remote di Fly (Dockerfile deterministik); artefak
  UI single-file di-commit tapi selalu di-rebuild oleh pipeline sebelum
  deploy.
- Error response memakai envelope terstruktur (kode §8) tanpa membocorkan
  stack trace atau data internal.
