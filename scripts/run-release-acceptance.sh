#!/usr/bin/env bash

set -euo pipefail

API_PID=''
WEB_PID=''
CONTAINER_STARTED=false
CONTAINER_NAME=''
TEMP_DIR=''

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    kill "${WEB_PID}" 2>/dev/null || true
    wait "${WEB_PID}" 2>/dev/null || true
  fi
  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
    wait "${API_PID}" 2>/dev/null || true
  fi
  if [[ "${CONTAINER_STARTED}" == true ]] && [[ -n "${CONTAINER_NAME}" ]]; then
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${TEMP_DIR}" ]] && [[ -d "${TEMP_DIR}" ]]; then
    rm -rf -- "${TEMP_DIR}"
  fi

  exit "${status}"
}

unused_loopback_port() {
  node -e 'const net = require("node:net"); const server = net.createServer(); server.unref(); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") process.exit(1); console.log(address.port); server.close(); });'
}

run_migrations() {
  local database_url=$1
  local env_file=$2

  pnpm exec dotenv -e "${env_file}" -- \
    env DATABASE_URL="${database_url}" DATABASE_URL_UNPOOLED="${database_url}" \
    pnpm --filter @docket/db db:migrate
}

run_release_env() {
  pnpm exec dotenv -e "${ENV_FILE}" -- env \
    AGENT_MAX_TURNS=8 \
    ADMIN_GOOGLE_SSO_ENABLED=false \
    API_URL="${API_URL}" \
    APP_MODE=test \
    APP_URL="${APP_URL}" \
    ATHENA_ASYNC_RUNNER_ENABLED=false \
    BETTER_AUTH_ALLOWED_HOSTS=docket.localhost,api.docket.localhost \
    BETTER_AUTH_PASSKEY_RP_ID=docket.localhost \
    BETTER_AUTH_PASSKEY_RP_NAME=Docket \
    BETTER_AUTH_SECRET=release-acceptance-secret-release-acceptance-secret \
    BETTER_AUTH_TRUSTED_ORIGINS="${APP_URL}" \
    BETTER_AUTH_URL="${API_URL}" \
    BILLING_ENABLED=false \
    BILLING_RECONCILIATION_MODE=off \
    CI=1 \
    CRON_SECRET=release-acceptance-cron-secret \
    DATABASE_URL="${DATABASE_URL}" \
    DATABASE_URL_UNPOOLED="${DATABASE_URL}" \
    GOOGLE_OAUTH_PUBLIC=false \
    MCP_TASKS_ENABLED=false \
    NEXT_PUBLIC_API_URL="${API_URL}" \
    NEXT_PUBLIC_APP_URL="${APP_URL}" \
    NEXT_PUBLIC_PASSKEY_RP_ID=docket.localhost \
    NODE_ENV=production \
    PASSKEY_RP_ID=docket.localhost \
    SKIP_ENV_VALIDATION=1 \
    WEB_URL="${APP_URL}" \
    WORK_LOCATION_PROJECTION_ENABLED=false \
    "$@"
}

run_browser_checks() {
  if [[ "${RELEASE_EVIDENCE:-0}" == 1 ]]; then
    run_release_env env E2E_EVIDENCE=1 pnpm --filter @docket/web exec playwright test \
      e2e/work/initiative-roster-shots.spec.ts --workers=1
    return
  fi
  run_release_env pnpm --filter @docket/web test:e2e:release
}

wait_for_health() {
  local name=$1
  local url=$2
  local log_file=$3

  for _ in $(seq 1 60); do
    if curl --fail --silent --show-error --output /dev/null "${url}"; then
      return 0
    fi
    sleep 2
  done

  echo "${name} did not become healthy at ${url}." >&2
  tail -n 100 -- "${log_file}" >&2 || true
  return 1
}

main() {
  local repo_root
  local database_port
  local api_port
  local web_port
  local api_log
  local web_log
  local standalone_root

  repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  cd "${repo_root}"

  RUN_ID="$$-${RANDOM}"
  CONTAINER_NAME="docket-release-${RUN_ID}"
  DATABASE_NAME="docket_release_${RUN_ID//-/_}"
  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/docket-release-${RUN_ID}.XXXXXX")
  ENV_FILE="${repo_root}/.env.local"
  api_log="${TEMP_DIR}/api.log"
  web_log="${TEMP_DIR}/web.log"

  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  # Keep a failed startup around long enough to print its logs. The cleanup trap still owns
  # removal, so successful and failed runs leave no container behind.
  docker run --detach \
    --name "${CONTAINER_NAME}" \
    --env POSTGRES_DB="${DATABASE_NAME}" \
    --env POSTGRES_PASSWORD=docket \
    --env POSTGRES_USER=docket \
    --publish "127.0.0.1::5432" \
    postgres:17-alpine >/dev/null
  CONTAINER_STARTED=true

  for _ in $(seq 1 60); do
    if docker exec "${CONTAINER_NAME}" pg_isready -U docket -d "${DATABASE_NAME}" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! docker exec "${CONTAINER_NAME}" pg_isready -U docket -d "${DATABASE_NAME}" >/dev/null 2>&1; then
    docker logs "${CONTAINER_NAME}" >&2 || true
    return 1
  fi

  database_port=$(docker port "${CONTAINER_NAME}" 5432/tcp | sed -n 's/^127\.0\.0\.1://p' | head -n 1)
  if [[ -z "${database_port}" ]]; then
    echo 'Docker did not publish the PostgreSQL loopback port.' >&2
    return 1
  fi

  api_port=$(unused_loopback_port)
  web_port=$(unused_loopback_port)
  while [[ "${web_port}" == "${api_port}" ]]; do
    web_port=$(unused_loopback_port)
  done

  DATABASE_URL="postgres://docket:docket@127.0.0.1:${database_port}/${DATABASE_NAME}"
  APP_URL="http://docket.localhost:${web_port}"
  API_URL="http://api.docket.localhost:${api_port}"

  run_migrations "${DATABASE_URL}" "${ENV_FILE}"
  run_release_env env NODE_OPTIONS=--max-old-space-size=4096 \
    pnpm turbo run build --filter=@docket/api --filter=@docket/web --concurrency=1

  standalone_root="${repo_root}/apps/web/.next/standalone/apps/web"
  mkdir -p "${standalone_root}/.next"
  cp -R "${repo_root}/apps/web/.next/static" "${standalone_root}/.next/static"
  cp -R "${repo_root}/apps/web/public" "${standalone_root}/public"

  (
    cd "${repo_root}"
    run_release_env env PORT="${api_port}" pnpm --filter @docket/api exec tsx src/server.ts
  ) >"${api_log}" 2>&1 &
  API_PID=$!

  (
    cd "${standalone_root}"
    run_release_env env HOSTNAME=127.0.0.1 PORT="${web_port}" node server.js
  ) >"${web_log}" 2>&1 &
  WEB_PID=$!

  wait_for_health 'API' "${API_URL}/v1/health" "${api_log}"
  wait_for_health 'Web app' "${APP_URL}/sign-in" "${web_log}"
  run_browser_checks
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
