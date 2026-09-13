#!/usr/bin/env bash

set -euo pipefail

database_name="docket_oauth_task2_${PPID}_${RANDOM}_$(date +%s)"
created_database=false

connects() {
  psql "$1" --no-psqlrc --tuples-only --no-align --command 'select 1' >/dev/null 2>&1
}

resolve_control_url() {
  if [[ -n "${POSTGRES_CONTROL_URL:-}" ]]; then
    if ! connects "${POSTGRES_CONTROL_URL}"; then
      echo "POSTGRES_CONTROL_URL does not reach PostgreSQL." >&2
      return 1
    fi
    printf '%s\n' "${POSTGRES_CONTROL_URL}"
    return
  fi

  local candidate
  for candidate in \
    "postgres://$(id -un)@127.0.0.1:5432/postgres" \
    'postgres://127.0.0.1:5432/postgres'; do
    if connects "${candidate}"; then
      printf '%s\n' "${candidate}"
      return
    fi
  done

  echo 'No local PostgreSQL control database is reachable. Set POSTGRES_CONTROL_URL.' >&2
  return 1
}

control_url="$(resolve_control_url)"

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "${created_database}" == true ]]; then
    psql "${control_url}" --no-psqlrc --set ON_ERROR_STOP=1 \
      --command "drop database if exists \"${database_name}\" with (force)" >/dev/null 2>&1 || true
  fi
  exit "${status}"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

psql "${control_url}" --no-psqlrc --set ON_ERROR_STOP=1 \
  --command "create database \"${database_name}\"" >/dev/null
created_database=true

database_url="$(node -e '
  const url = new URL(process.argv[1]);
  url.pathname = `/${process.argv[2]}`;
  process.stdout.write(url.toString());
' "${control_url}" "${database_name}")"

export DATABASE_URL="${database_url}"
export DATABASE_URL_UNPOOLED="${database_url}"

pnpm --filter @docket/db exec vitest run --config vite.postgres.config.ts --maxWorkers=1
pnpm --filter @docket/api exec vitest run --config vite.postgres.config.ts \
  tests/auth/oauth-legacy-cutoff.postgres.acceptance.ts --maxWorkers=1
pnpm --filter @docket/api exec vitest run --config vite.postgres.config.ts \
  tests/auth/oauth-ceremony.postgres.acceptance.ts --maxWorkers=1
