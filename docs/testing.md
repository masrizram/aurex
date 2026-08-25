# Testing

> Empat gerbang pengujian. Semua wajib hijau sebelum merge/deploy.

## Peta gerbang

| Gerbang | Perintah | Lingkungan | Kebutuhan |
|---|---|---|---|
| Typecheck backend+scripts | `npm run typecheck` | tsc strict (root tsconfig) | — |
| Unit/integrasi node | `npm test` | vitest node (144 test) | — (Pool di-stub) |
| Typecheck UI | `npm run typecheck:ui` | tsc dashboard + landing | — |
| Regression UI | `npm run test:ui` | vitest jsdom (9 test provider/route) | — |
| Build UI | `npm run build` | Vite single-file ×2 | — |
| Pipeline integrasi penuh | `bash scripts/verify_pipeline.sh` | API+worker nyata vs PG scratch | Docker (WSL di setup ini) |
| E2E canonical journey | `BASE=<url> npx tsx scripts/e2e-canonical-cookie.ts` | vs deployment (lokal/prod) | server hidup |

Semua gerbang kecuali E2E juga berjalan otomatis di pipeline deploy
([auto-deploy-fly.sh](../scripts/auto-deploy-fly.sh)); CI GitHub
([ci.yml](../.github/workflows/ci.yml)) menjalankan subset tanpa-Docker pada
setiap push/PR.

## Strategi

- **Test colocated** di `<pkg>/test/*.test.ts` — satu strategi konsisten,
  tidak ada test liar di sisi production source.
- Unit API memakai `fastify.inject` tanpa jaringan; Pool di-stub per-test
  sehingga cepat dan deterministik. Integrasi penuh (PG nyata, queue nyata)
  ada di verify pipeline (S30+) — bukan di unit suite.
- Test UI (jsdom) melindungi hierarki provider dashboard: pemuatan rute
  langsung maupun lazy tidak boleh melewati provider tree (regresi
  `useSearch`).
- Fixtures/mock didefinisikan inline per-test dan diberi label jelas
  (Mock*, stub) — test economics tidak pernah bocor ke data produksi.

## E2E canonical (20 langkah)

`scripts/e2e-canonical-cookie.ts` menelusuri alur produk utuh:
landing → signup → verify → login → onboarding (bisnis, baseline, goal,
preferensi eksekusi) → analisis pertama → `/app` → objective → opportunity →
experiment → mission → approval → execution → verification → result →
economics → decision. Wajib PASS setelah refactor struktural apa pun.

Catatan teknis: script mengelola cookie session secara eksplisit (node fetch
tidak auto-cookie); `X-User-Id` hanya dev-mode dan tidak dipakai di skrip ini.

## Menambah test baru

1. Taruh di `packages/<pkg>/test/` atau `apps/<app>/test/`.
2. Backend/node → root vitest otomatis mengambilnya; UI (jsdom) → pastikan
   match pattern `apps/dashboard/vitest.config.ts`.
3. Nama deskriptif perilaku (bukan nama fungsi); deterministik, tanpa
   ketergantungan urutan/waktu nyata.
