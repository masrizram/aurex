#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/auto-deploy-fly.sh — Auto-deploy ke Fly.io saat push ke origin/main
#
# Pola: hook git post-push (lokal) → jika ada update main → deploy ke Fly.
# Jalur deploy TUNGGAL: flyctl deploy --remote-only (build terjadi di Fly,
# assets/dashboard.html + landing.html harus sudah tersinkron).
# Migrasi DB: serve-prod.ts menjalankan run-migrations.ts saat container start
# (idempotent + checksum) — tidak ada langkah migrasi terpisah di sini.
#
# Keamanan: FLY_API_TOKEN dibaca dari env ATAU .fly-token (file lokal,
# git-ignored). Token tidak pernah dicetak/log.
#
# Exit code: 0 = deploy sukses atau tidak ada perubahan main;
#            1 = deploy gagal (push ke origin tetap sudah sukses).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP="aurex-api"
CONFIG="fly.toml"
if [ -n "${LOCALAPPDATA:-}" ]; then TMPD="$LOCALAPPDATA/Temp"; else TMPD="/tmp"; fi
LOG="$TMPD/fly-auto-deploy.log"
DEBOUNCE_LOCK="/tmp/aurex-fly-deploy.lock"

# Ambil token dari env (preferred) atau file .fly-token (git-ignored)
if [ -n "${FLY_API_TOKEN:-}" ]; then
  :
elif [ -f .fly-token ]; then
  FLY_API_TOKEN="$(cat .fly-token)"
  export FLY_API_TOKEN
else
  echo "[auto-deploy] FLY_API_TOKEN tidak ada (env/.fly-token) — skip deploy."
  exit 0
fi

# Tulis log transkrip lengkap ke file (proses background dapat berjalan mnti)
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
echo ""
echo "════ $(date -u +"%Y-%m-%d %H:%M:%SZ") ═══════════════════════════════════════"

# Debounce: kalau deploy sedang berjalan, jangan mulai deploy baru
if [ -e "$DEBOUNCE_LOCK" ] && kill -0 "$(cat "$DEBOUNCE_LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "[auto-deploy] Deploy lain sedang berjalan (PID $(cat "$DEBOUNCE_LOCK")) — skip."
  exit 0
fi
echo $$ > "$DEBOUNCE_LOCK"
trap 'rm -f "$DEBOUNCE_LOCK"' EXIT

# 1) Sync assets (build deterministik lokal) — DIPERBAHARUI 2026-08-24:
#    postbuild lama jalan 2x (hook parent npm) → ENOENT race; kini copy+delete
#    digabung ke script build dashboard tunggal.
echo "[auto-deploy] 1/4 sync assets (build landing + dashboard)…"
if ! npm run build > "$TMPD/fly-build.log" 2>&1; then
  echo "[auto-deploy] BUILD GAGAL — deploy dibatalkan."
  exit 1
fi

# 2) Gate typecheck (murah, tangkap regresi TS sebelum deploy)
echo "[auto-deploy] 2/4 typecheck…"
npm run typecheck >>"$LOG" 2>&1 || {
  echo "[auto-deploy] TYPECHECK GAGAL — deploy dibatalkan."
  exit 1
}

# 3) Deploy remote-only (build di Fly, jalur yang sama dgn manual)
echo "[auto-deploy] 3/4 flyctl deploy --remote-only…"
flyctl deploy --app "$APP" --config "$CONFIG" --remote-only --yes || {
  echo "[auto-deploy] DEPLOY GAGAL — periksa $LOG."
  exit 1
}

# 4) Verifikasi pasca-deploy: health prod + smoke ringan
echo "[auto-deploy] 4/4 verifikasi pasca-deploy…"
sleep 20
for i in 1 2 3 4 5; do
  H=$(curl -s -m 15 "https://$APP.fly.dev/health" || true)
  if echo "$H" | grep -q '"status":"ok"'; then
    echo "[auto-deploy] ✓ health prod OK"
    npx tsx scripts/smoke-prod.ts >>"$LOG" 2>&1 || {
      echo "[auto-deploy] ⚠ smoke-prod GAGAL pasca-deploy — periksa log."
      exit 1
    }
    echo "[auto-deploy] ✓ smoke-prod PASS — deploy sehat."
    exit 0
  fi
  echo "[auto-deploy] health belum ok (percobaan $i/5) — retry 15s…"
  sleep 15
done
echo "[auto-deploy] ⚠ health prod TIDAK OK setelah 5 percobaan — periksa manual."
exit 1