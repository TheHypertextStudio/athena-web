#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${repo_root}"

# Reuse the PostgreSQL 17 container lifecycle and two-query readiness gate used by release checks.
source "${repo_root}/scripts/run-release-acceptance.sh"

main_http_storage() {
  local database_port
  local run_id="$$-${RANDOM}"

  CONTAINER_NAME="docket-http-storage-${run_id}"
  DATABASE_NAME="docket_http_storage_${run_id//-/_}"
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  docker run --detach \
    --name "${CONTAINER_NAME}" \
    --env POSTGRES_DB="${DATABASE_NAME}" \
    --env POSTGRES_PASSWORD=docket \
    --env POSTGRES_USER=docket \
    --publish "127.0.0.1::5432" \
    postgres:17-alpine >/dev/null
  CONTAINER_STARTED=true
  wait_for_postgres

  database_port=$(docker port "${CONTAINER_NAME}" 5432/tcp | sed -n 's/^127\.0\.0\.1://p' | head -n 1)
  if [[ -z "${database_port}" ]]; then
    echo 'Docker did not publish the PostgreSQL loopback port.' >&2
    return 1
  fi

  export DATABASE_URL="postgres://docket:docket@127.0.0.1:${database_port}/${DATABASE_NAME}"
  export DATABASE_URL_UNPOOLED="${DATABASE_URL}"

  pnpm --filter @docket/db exec vitest run --config vite.postgres.config.ts \
    tests/migrations/http-contract-storage-migration.postgres.acceptance.ts --maxWorkers=1
  pnpm --filter @docket/api exec vitest run --config vite.postgres.config.ts \
    tests/http/work-schedule-concurrency.postgres.acceptance.ts --maxWorkers=1
}

main_http_storage "$@"
