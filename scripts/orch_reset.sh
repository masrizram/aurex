#!/usr/bin/env bash
# Reset total scratch orchestrator DB (container fresh; role dibuat migration 001).
# Dipanggil dari Windows: wsl.exe -e bash /mnt/c/laraenv/www/econos/scripts/orch_reset.sh
set -euo pipefail
# §24 secret safety: password kontainer dev dari env (lihat .env.example).
: "${AEE_DEV_DB_PASSWORD:?Set AEE_DEV_DB_PASSWORD di .env (salin dari .env.example)}"
docker rm -f aee-orch-pg >/dev/null 2>&1 || true
docker run -d --name aee-orch-pg \
  -e POSTGRES_PASSWORD="$AEE_DEV_DB_PASSWORD" -e POSTGRES_DB=aee \
  -p 55433:5432 postgres:16-alpine >/dev/null
for i in $(seq 1 30); do
  docker exec aee-orch-pg pg_isready -U postgres -d aee >/dev/null 2>&1 && break
  sleep 1
done
echo "CONTAINER_READY"
# Catatan: ALTER ROLE aee_app dijalankan SETELAH run-migrations (role baru ada setelah 001).
