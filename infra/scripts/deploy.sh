#!/usr/bin/env bash
# Deploy one tag to the VPS — PRD §13.5 step 2, run by release.yml over SSH (or by hand).
#
#   deploy.sh v0.1.0
#
# Pull → up → migrate → health check → rollback to the previous tag on failure.
# Expects to run from the directory holding docker-compose.prod.yml and .env (infra/compose on
# the VPS). Records the last good tag in .last_good_tag.
set -euo pipefail

NEW_TAG="${1:?tag, e.g. v0.1.0}"
COMPOSE="docker compose -f docker-compose.prod.yml"
HEALTH_URL="${HEALTH_URL:-https://${DOMAIN:?DOMAIN}/api/v1/health}"
PREV_TAG="$(cat .last_good_tag 2>/dev/null || true)"

set_tag() { sed -i -E "s/^TAG=.*/TAG=$1/" .env; export TAG="$1"; }

health_ok() {
  for i in $(seq 1 30); do
    if curl -fsS --max-time 5 "${HEALTH_URL}" >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  return 1
}

rollback() {
  if [[ -n "${PREV_TAG}" ]]; then
    echo "[deploy] ROLLBACK to ${PREV_TAG}"
    set_tag "${PREV_TAG}"
    ${COMPOSE} pull --quiet api web
    ${COMPOSE} up -d --remove-orphans
    # Migrations are forward-only (Prisma); a rollback keeps the new schema, which every migration
    # is written to tolerate. Note it loudly so a human checks.
    echo "[deploy] rolled back containers; database schema is still at ${NEW_TAG}'s migrations"
  else
    echo "[deploy] no previous tag recorded — nothing to roll back to"
  fi
  exit 1
}

echo "[deploy] ${PREV_TAG:-<none>} -> ${NEW_TAG}"
set_tag "${NEW_TAG}"
${COMPOSE} pull --quiet
${COMPOSE} up -d --remove-orphans --no-deps postgres redis minio gotenberg

echo "[deploy] prisma migrate deploy (one-off api container)"
${COMPOSE} run --rm --no-deps api \
  node packages/db/node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma \
  || rollback

${COMPOSE} up -d --remove-orphans
echo "[deploy] waiting for ${HEALTH_URL}"
health_ok || rollback

echo "${NEW_TAG}" > .last_good_tag
${COMPOSE} ps --format 'table {{.Service}}\t{{.Status}}'
echo "[deploy] OK ${NEW_TAG}"
