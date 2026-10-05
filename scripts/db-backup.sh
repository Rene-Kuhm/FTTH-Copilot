#!/usr/bin/env bash
# =============================================================================
# FTTH-Copilot — PostgreSQL backup script
# =============================================================================
# Performs a pg_dump of the FTTH-Copilot database, compresses it, and manages
# retention (daily + weekly backups).
#
# Usage:
#   ./db-backup.sh                          # local backup
#   ./db-backup.sh s3://bucket/backups       # upload to S3-compatible storage
#
# Environment variables (set in .env or CI secrets):
#   DATABASE_URL         — full connection string
#   BACKUP_RETENTION_DAYS  — days to keep daily backups (default: 30)
#   BACKUP_RETENTION_WEEKS — weeks to keep weekly backups (default: 12)
#   BACKUP_DIR            — local backup directory (default: ./backups)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

DATABASE_URL="${DATABASE_URL:-postgresql://ftth:demo123@localhost:5432/ftth_copilot}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_RETENTION_WEEKS="${BACKUP_RETENTION_WEEKS:-12}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
REMOTE_DEST="${1:-}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)   # 1=Monday … 7=Sunday
IS_WEEKLY=$([ "$DAY_OF_WEEK" = "7" ] && echo "true" || echo "false")  # Sunday = weekly

BACKUP_NAME="ftth_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# ── Bootstrap ────────────────────────────────────────────────────────────────

mkdir -p "${BACKUP_DIR}"

# ── Dump ────────────────────────────────────────────────────────────────────

echo "[backup] Dumping database: ${DATABASE_URL##*@}"
pg_dump "${DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  | gzip \
  > "${BACKUP_PATH}"

BACKUP_SIZE=$(du -h "${BACKUP_PATH}" | cut -f1)
echo "[backup] Created: ${BACKUP_PATH} (${BACKUP_SIZE})"

# ── Symlink to latest ────────────────────────────────────────────────────────

ln -sf "${BACKUP_PATH}" "${BACKUP_DIR}/latest.sql.gz"
echo "[backup] Updated: ${BACKUP_DIR}/latest.sql.gz → ${BACKUP_NAME}"

# ── Retention: daily ─────────────────────────────────────────────────────────

if [ "${IS_WEEKLY}" = "true" ]; then
  echo "[backup] Weekly backup — skipping daily purge"
else
  DELETED=0
  while IFS= read -r old_backup; do
    [ -z "$old_backup" ] && continue
    [ "$old_backup" = "${BACKUP_PATH}" ] && continue
    echo "[backup] Removing old daily backup: ${old_backup}"
    rm -f "$old_backup"
    DELETED=$((DELETED + 1))
  done < <(
    find "${BACKUP_DIR}" \
      -maxdepth 1 \
      -name "ftth_????????_??????.sql.gz" \
      -type f \
      -mtime "+${BACKUP_RETENTION_DAYS}" \
      ! -name "weekly_*" \
      2>/dev/null
  )
  echo "[backup] Removed ${DELETED} daily backup(s)"
fi

# ── Retention: weekly ────────────────────────────────────────────────────────

if [ "${IS_WEEKLY}" = "true" ]; then
  WEEKLY_NAME="ftth_weekly_${TIMESTAMP}.sql.gz"
  WEEKLY_PATH="${BACKUP_DIR}/${WEEKLY_NAME}"
  cp "${BACKUP_PATH}" "${WEEKLY_PATH}"
  ln -sf "${WEEKLY_PATH}" "${BACKUP_DIR}/latest_weekly.sql.gz"
  echo "[backup] Created weekly backup: ${WEEKLY_PATH}"

  DELETED=0
  while IFS= read -r old_backup; do
    [ -z "$old_backup" ] && continue
    [ "$old_backup" = "${WEEKLY_PATH}" ] && continue
    echo "[backup] Removing old weekly backup: ${old_backup}"
    rm -f "$old_backup"
    DELETED=$((DELETED + 1))
  done < <(
    find "${BACKUP_DIR}" \
      -maxdepth 1 \
      -name "ftth_weekly_????????_??????.sql.gz" \
      -type f \
      -mtime "+$((BACKUP_RETENTION_WEEKS * 7))" \
      2>/dev/null
  )
  echo "[backup] Removed ${DELETED} weekly backup(s)"
fi

# ── Remote upload (optional) ─────────────────────────────────────────────────

if [ -n "${REMOTE_DEST}" ]; then
  echo "[backup] Uploading to: ${REMOTE_DEST}"
  if command -v aws &>/dev/null; then
    aws s3 cp "${BACKUP_PATH}" "${REMOTE_DEST}/${BACKUP_NAME}" --storage-class STANDARD_IA
    aws s3 cp "${BACKUP_DIR}/latest.sql.gz" "${REMOTE_DEST}/latest.sql.gz" --storage-class STANDARD_IA
    echo "[backup] Uploaded to S3: ${REMOTE_DEST}/${BACKUP_NAME}"
  elif command -v rclone &>/dev/null; then
    rclone copy "${BACKUP_PATH}" "${REMOTE_DEST}" --no-traverse
    echo "[backup] Uploaded via rclone: ${REMOTE_DEST}/${BACKUP_NAME}"
  else
    echo "[backup] WARNING: Neither aws nor rclone found. Skipping remote upload."
  fi
fi

echo "[backup] Done — ${BACKUP_NAME}"
