#!/usr/bin/env bash
# Restore — PRD §12.1 (weekly restore test) and PHASES task 0.9 (restore drill).
#
#   restore.sh --test [dump]        restore the newest (or given) dump into a scratch database,
#                                   count rows, drop the scratch database. Never touches the live DB.
#   restore.sh --into DBNAME dump   restore a dump into DBNAME (for a real recovery; DBNAME must exist
#                                   and be empty or you must have dropped it first).
#
# Uses ADMIN_DATABASE_URL (a superuser/owner connection to the `postgres` maintenance DB) when set,
# else derives it from DATABASE_URL by swapping the database name for `postgres`.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
MODE="${1:---test}"

admin_url() {
  if [[ -n "${ADMIN_DATABASE_URL:-}" ]]; then echo "${ADMIN_DATABASE_URL}"; return; fi
  echo "${DATABASE_URL}" | sed -E 's#(/[^/?]+)(\?.*)?$#/postgres\2#'
}
db_url_for() {
  echo "${DATABASE_URL}" | sed -E "s#(/[^/?]+)(\?.*)?\$#/$1\2#"
}

case "${MODE}" in
  --test)
    DUMP="${2:-$(ls -1t "${BACKUP_DIR}"/tc-*.dump 2>/dev/null | head -1 || true)}"
    [[ -n "${DUMP}" && -f "${DUMP}" ]] || { echo "[restore] no dump found in ${BACKUP_DIR}"; exit 1; }
    SCRATCH="tc_restore_test_$(date -u +%Y%m%d%H%M%S)"
    ADMIN="$(admin_url)"
    echo "[restore] test-restoring ${DUMP} into scratch database ${SCRATCH}"
    psql -v ON_ERROR_STOP=1 "${ADMIN}" -qc "CREATE DATABASE \"${SCRATCH}\";"
    # The dump references the vector extension and uuid_generate_v7(); pg_restore recreates both
    # because they were dumped from the source database's public schema.
    pg_restore --no-owner --no-privileges --exit-on-error --dbname="$(db_url_for "${SCRATCH}")" "${DUMP}"
    echo "[restore] restored. row counts in the scratch database:"
    psql "$(db_url_for "${SCRATCH}")" -Atc "
      SELECT 'User='||(SELECT count(*) FROM \"User\")
          ||' Document='||(SELECT count(*) FROM \"Document\")
          ||' FeatureFlag='||(SELECT count(*) FROM \"FeatureFlag\")
          ||' InstitutionTemplate='||(SELECT count(*) FROM \"InstitutionTemplate\")
          ||' UsageLedger='||(SELECT count(*) FROM \"UsageLedger\")
          ||' migrations='||(SELECT count(*) FROM \"_prisma_migrations\")
          ||' uuid_v7='||(SELECT substring(uuid_generate_v7()::text,15,1));" | sed 's/^/[restore]   /'
    psql -v ON_ERROR_STOP=1 "${ADMIN}" -qc "DROP DATABASE \"${SCRATCH}\";"
    echo "[restore] scratch database dropped. RESTORE TEST OK"
    ;;
  --into)
    TARGET="${2:?database name}"; DUMP="${3:?dump file}"
    echo "[restore] restoring ${DUMP} into ${TARGET} (this overwrites data in ${TARGET})"
    pg_restore --no-owner --no-privileges --exit-on-error --clean --if-exists --dbname="$(db_url_for "${TARGET}")" "${DUMP}"
    echo "[restore] done"
    ;;
  *)
    echo "usage: restore.sh --test [dump] | --into DBNAME dump"; exit 2 ;;
esac
