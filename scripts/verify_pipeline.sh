#!/usr/bin/env bash
# Pipeline verifikasi sisi WINDOWS (node hanya di sini):
#   1. WSL: naikkan container scratch orchestrator (docker hanya di WSL)
#   2. Windows: migrate 001+002 (owner) + verify-db + verify-orchestrator → :55433
#   3. WSL: turunkan container
# Catatan: WSL VM dapat idle-shutdown antar-panggilan; semua langkah DB
# dirangkai dalam sesi singkat dan container pakai --restart unless-stopped.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=scripts/verify_output.log
: > "$LOG"

AEE_DB_HOST="${AEE_DB_HOST:-localhost}"   # override dgn IP WSL bila port-forward drop koneksi
export DATABASE_URL="postgres://postgres:auditpass@${AEE_DB_HOST}:55433/aee"
export DATABASE_APP_URL="postgres://aee_app:auditpass@${AEE_DB_HOST}:55433/aee"

wsl.exe bash /mnt/c/laraenv/www/econos/scripts/orch_reset.sh >> "$LOG" 2>&1
if ! grep -q CONTAINER_READY "$LOG"; then echo "CONTAINER_FAIL"; exit 1; fi

./node_modules/.bin/tsx scripts/run-migrations.ts >> "$LOG" 2>&1
MIGRATE_EXIT=$?
echo "MIGRATE_EXIT=$MIGRATE_EXIT" >> "$LOG"
if [ "$MIGRATE_EXIT" -ne 0 ]; then
  wsl.exe docker rm -f aee-orch-pg >/dev/null 2>&1
  echo "MIGRATE_FAIL"; exit 1
fi

# aktifkan login aee_app (role dibuat migration 001; password = kredensial scratch)
wsl.exe docker exec aee-orch-pg psql -U postgres -d aee \
  -c "ALTER ROLE aee_app LOGIN PASSWORD 'auditpass'" >> "$LOG" 2>&1

./node_modules/.bin/tsx scripts/verify-db.ts >> "$LOG" 2>&1
DB_EXIT=$?
echo "VERIFY_DB_EXIT=$DB_EXIT" >> "$LOG"

./node_modules/.bin/tsx scripts/verify-orchestrator.ts >> "$LOG" 2>&1
ORCH_EXIT=$?
echo "VERIFY_ORCH_EXIT=$ORCH_EXIT" >> "$LOG"

wsl.exe docker rm -f aee-orch-pg >/dev/null 2>&1
echo "SCRIPT_EXIT=$DB_EXIT|$ORCH_EXIT"
