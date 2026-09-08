#!/usr/bin/env bash
# Supervise the four explicit-port development services for dev-stack.sh.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for required_name in DOCKET_WEB_PORT DOCKET_API_PORT DOCKET_ADMIN_PORT DOCKET_RUNNER_PORT; do
  if [ -z "${!required_name:-}" ]; then
    echo "dev-stack-supervisor: $required_name is required" >&2
    exit 2
  fi
done

pids=""
cleanup() {
  local service_pid
  trap - EXIT INT TERM
  for service_pid in $pids; do kill -TERM "$service_pid" 2>/dev/null || true; done
  for service_pid in $pids; do wait "$service_pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

(
  cd "$ROOT/apps/runner" || exit 1
  exec pnpm exec dotenv -e "$ROOT/.env.local" -- \
    pnpm exec wrangler dev --local --port "$DOCKET_RUNNER_PORT"
) &
pids="$pids $!"

(
  cd "$ROOT/apps/api" || exit 1
  exec pnpm exec dotenv -e "$ROOT/.env.local" -- env PORT="$DOCKET_API_PORT" \
    pnpm exec tsx watch --include .env.local --import ./src/dev-env.ts src/server.ts
) &
pids="$pids $!"

(
  cd "$ROOT/apps/admin" || exit 1
  exec pnpm exec dotenv -e "$ROOT/.env.local" -- \
    pnpm exec next dev --hostname 127.0.0.1 --port "$DOCKET_ADMIN_PORT"
) &
pids="$pids $!"

(
  cd "$ROOT/apps/web" || exit 1
  pnpm exec dotenv -e "$ROOT/.env.local" -- \
    pnpm exec tsx ../../packages/service-worker/bin/build.ts --app-root=. || exit 1
  exec pnpm exec dotenv -e "$ROOT/.env.local" -- \
    pnpm exec next dev --hostname 127.0.0.1 --port "$DOCKET_WEB_PORT"
) &
pids="$pids $!"

while :; do
  for service_pid in $pids; do
    if ! kill -0 "$service_pid" 2>/dev/null; then
      wait "$service_pid" || status=$?
      echo "dev-stack-supervisor: service $service_pid exited (${status:-0})" >&2
      exit "${status:-1}"
    fi
  done
  sleep 2
done
