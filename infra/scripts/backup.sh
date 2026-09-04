#!/usr/bin/env bash
# Nightly backup — PRD §12.1: pg_dump + MinIO bucket sync to off-site storage.
#
# Runs inside the tc-backup container (infra/docker/Dockerfile.backup) or on a host with pg_dump
# and mc installed. Reads the same .env the stack uses.
#
#   backup.sh                    # dump + mirror
#   BACKUP_DIR=/tmp/b backup.sh  # dump somewhere else (used by the local drill)
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="${BACKUP_DIR}/tc-${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "[backup] ${STAMP} pg_dump -> ${DUMP}"
# Custom format: compressed, restorable table-by-table with pg_restore.
pg_dump --format=custom --no-owner --no-privileges --file="${DUMP}" "${DATABASE_URL}"
SIZE="$(du -h "${DUMP}" | cut -f1)"
echo "[backup] dump complete (${SIZE})"

# Off-site copy of the dump and of the object-storage bucket (PDFs, exports, snapshots).
if [[ -n "${BACKUP_S3_ENDPOINT:-}" && -n "${BACKUP_S3_ACCESS_KEY:-}" ]]; then
  mc alias set offsite "${BACKUP_S3_ENDPOINT}" "${BACKUP_S3_ACCESS_KEY}" "${BACKUP_S3_SECRET_KEY}" >/dev/null
  mc cp "${DUMP}" "offsite/${BACKUP_S3_BUCKET}/pg/" >/dev/null
  echo "[backup] dump mirrored to offsite/${BACKUP_S3_BUCKET}/pg/"

  if [[ -n "${S3_ENDPOINT:-}" ]]; then
    mc alias set local "${S3_ENDPOINT}" "${S3_ACCESS_KEY}" "${S3_SECRET_KEY}" >/dev/null
    mc mirror --overwrite "local/${S3_BUCKET}" "offsite/${BACKUP_S3_BUCKET}/objects/${S3_BUCKET}" >/dev/null
    echo "[backup] bucket ${S3_BUCKET} mirrored"
  fi
else
  echo "[backup] BACKUP_S3_* not set — dump kept locally only (fine for dev, NOT for production)"
fi

# Local retention.
find "${BACKUP_DIR}" -name 'tc-*.dump' -mtime "+${KEEP_DAYS}" -print -delete | sed 's/^/[backup] pruned /' || true
echo "[backup] done"
