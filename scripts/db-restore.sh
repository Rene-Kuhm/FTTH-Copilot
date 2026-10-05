#!/usr/bin/env bash
# =============================================================================
# FTTH-Copilot — PostgreSQL restore script
# =============================================================================
# Restores the database from a pg_dump backup file.
#
# Usage:
#   ./db-restore.sh ./backups/ftth_20241005_120000.sql.gz
#
# ⚠️  WARNING: This script REPLACES all data in the target database.
#     Make sure you have a recent backup before running.
# =============================================================================

set -euo pipefail

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  echo ""
  echo "Available backups:"
  ls -lh ./backups/ftth_*.sql.gz 2>/dev/null | tail -10
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[restore] ERROR: File not found: ${BACKUP_FILE}"
  exit 1
fi

# Confirmation prompt
echo ""
echo "⚠️  This will RESTORE the database from: ${BACKUP_FILE}"
echo "⚠️  ALL CURRENT DATA will be replaced."
echo ""
read -rp "Type 'yes' to continue: " confirm
if [ "$confirm" != "yes" ]; then
  echo "[restore] Aborted."
  exit 1
fi

DATABASE_URL="${DATABASE_URL:-postgresql://ftth:demo123@localhost:5432/ftth_copilot}"

echo "[restore] Restoring from: ${BACKUP_FILE}"
echo "[restore] Target: ${DATABASE_URL##*@}"

gunzip -c "$BACKUP_FILE" \
  | pg_restore \
    --dbname="${DATABASE_URL}" \
    --format=custom \
    --clean \
    --if-exists \
    --no-owner \
    --no-acl \
    --single-transaction \
  || {
    echo "[restore] WARNING: pg_restore failed. Trying psql fallback..."
    gunzip -c "$BACKUP_FILE" \
      | psql "${DATABASE_URL}"
  }

echo "[restore] Done."
echo "[restore] Tip: Run 'pnpm --filter @ftth-copilot/db db:push --accept-data-loss' to sync Prisma schema."
