<!-- Satu concern per PR. Refactor struktural TANPA perubahan perilaku. -->

## Apa & mengapa

<!-- Ringkas: masalah/kebutuhan + pendekatan. -->

## Gate yang dijalankan

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run typecheck:ui`
- [ ] `npm run test:ui`
- [ ] `npm run build`
- [ ] E2E canonical (`BASE=<url> npx tsx scripts/e2e-canonical-cookie.ts`) — wajib bila alur produk berubah
- [ ] Migrasi DB immutable — wajib bila skema berubah

## Catatan review

Aturan arsitektur ada di [CONTRIBUTING.md](../CONTRIBUTING.md#aturan-arsitektur-diperiksa-saat-review).
Kerentanan → [SECURITY.md](../SECURITY.md), jangan issue publik.
