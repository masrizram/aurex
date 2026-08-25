# Kebijakan Keamanan

## Versi yang didukung

Hanya rilis terbaru di `main` (yang dideploy ke produksi) yang menerima
perbaikan keamanan. Proyek ini belum memiliki channel rilis LTS.

## Melaporkan kerentanan

- **Jangan** buka issue publik untuk kerentanan.
- Laporkan privat melalui fitur **Private vulnerability reporting** GitHub
  (tab Security → Report a vulnerability) di repositori ini.
- Sertakan: deskripsi, langkah reproduksi, dampak yang diperkirakan, dan
  (bila ada) PoC minimal.
- Target respons: konfirmasi awal ≤ 3×24 jam, remediasi sesuai severitas.

## Cakupan

Termasuk: authN/authZ, isolasi antar-tenant, integritas ledger/finansial,
idempotency webhook, kebocoran secret, injeksi SQL/konten.

Di luar cakupan: serangan yang butuh akses fisik, brute-force rate limit
tanpa bukti dampak, laporan hasil scanner generik tanpa analisis.

## Kebijakan secret

- Kredensial hanya lewat variabel environment; template resmi:
  `.env.example`. Jangan pernah meng-commit nilai nyata.
- Menemukan secret bocor di history? Laporkan lewat kanal di atas — jangan
  publish.
- Rotasi secret dilakukan di sisi provider/hosting (Fly secrets, env var),
  bukan dengan mengedit source.
