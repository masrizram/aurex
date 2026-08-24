#!/usr/bin/env bash
# AEE Database Backup Script
# Usage: bash scripts/backup-db.sh [backup_name]
# Restores: docker exec -i aee-orch-pg psql -U postgres -d aee < backup.sql

set -euo pipefail

BACKUP_NAME="${1:-aee-backup-$(date +%Y%m%d-%H%M%S)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

BACKUP_FILE="$BACKUP_DIR/${BACKUP_NAME}.sql"

echo "[backup] Starting AEE database backup → $BACKUP_FILE"

# pg_dump via Docker exec (container already running)
docker exec aee-orch-pg pg_dump -U postgres -d aee --no-privileges --no-owner > "$BACKUP_FILE"

FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[backup] Complete: $BACKUP_FILE ($FILE_SIZE)"
echo "[backup] To restore: docker exec -i aee-orch-pg psql -U postgres -d aee < $BACKUP_FILE"

# Retention: keep last 7 backups
ls -t "$BACKUP_DIR"/aee-backup-*.sql 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null || true
echo "[backup] Retention: last 7 backups kept"
