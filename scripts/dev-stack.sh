#!/usr/bin/env bash
# Start Docket's deterministic local verification stack on explicit HTTP ports.
#
# This path deliberately bypasses Portless. Portless remains available for interactive `pnpm dev`,
# but it is not a safe acceptance boundary: concurrent Next client-chunk requests can wedge its
# proxy and unregister every route after a successful passkey ceremony. Bootstrap verification
# needs origins that are stable, inspectable, and identical on macOS and Linux.
#
# Usage:
#   scripts/dev-stack.sh start
#   scripts/dev-stack.sh stop
#   scripts/dev-stack.sh status
#   scripts/dev-stack.sh env
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${TMPDIR:-/tmp}/docket-dev.log"
WEB_PORT="${DOCKET_DEV_PORT:-1355}"
API_PORT=$((WEB_PORT + 1))
ADMIN_PORT=$((WEB_PORT + 2))
RUNNER_PORT=$((WEB_PORT + 3))

PREFIX="$(basename "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)")"
STACK_PID_FILE="${TMPDIR:-/tmp}/docket-dev-${UID}-${PREFIX}-${WEB_PORT}.pid"
GIT_DIR="$(git -C "$ROOT" rev-parse --absolute-git-dir 2>/dev/null || true)"
GIT_COMMON_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
HOST_PREFIX=""
if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ] && [ "$PREFIX" != main ] && [ "$PREFIX" != master ]; then
  HOST_PREFIX="$PREFIX."
fi

export APP_URL="http://${HOST_PREFIX}docket.localhost:$WEB_PORT"
export WEB_URL="$APP_URL"
export API_URL="http://${HOST_PREFIX}api.docket.localhost:$API_PORT"
export ADMIN_URL="http://${HOST_PREFIX}admin.docket.localhost:$ADMIN_PORT"
export NEXT_PUBLIC_API_URL="$API_URL"
export NEXT_PUBLIC_APP_URL="$APP_URL"
export BETTER_AUTH_URL="$API_URL"
export BETTER_AUTH_PASSKEY_RP_ID=docket.localhost
export NEXT_PUBLIC_PASSKEY_RP_ID=docket.localhost
export BETTER_AUTH_TRUSTED_ORIGINS="$APP_URL,$ADMIN_URL"
export BETTER_AUTH_ALLOWED_HOSTS="${HOST_PREFIX}docket.localhost:$WEB_PORT,${HOST_PREFIX}admin.docket.localhost:$ADMIN_PORT,${HOST_PREFIX}api.docket.localhost:$API_PORT"
export MCP_ISSUER_URL="$API_URL"
export MCP_RESOURCE_URL="$API_URL/mcp"
export MCP_ALLOWED_ORIGINS="$APP_URL"
export OIDC_LOGIN_PAGE_URL="$APP_URL/sign-in"
export CLOUDFLARE_ATHENA_RUNNER_URL="http://127.0.0.1:$RUNNER_PORT"
export GOOGLE_OAUTH_PUBLIC=false
# The API is the only process whose validated runtime contract consumes PORT.
export PORT="$API_PORT"
export DOCKET_WEB_PORT="$WEB_PORT"
export DOCKET_API_PORT="$API_PORT"
export DOCKET_ADMIN_PORT="$ADMIN_PORT"
export DOCKET_RUNNER_PORT="$RUNNER_PORT"

print_env() {
  cat <<EOF
export APP_URL="$APP_URL"
export API_URL="$API_URL"
export PASSKEY_RP_ID="$BETTER_AUTH_PASSKEY_RP_ID"
EOF
}

probe() {
  local web sign_in sign_up onboarding admin api oidc runner
  web=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$APP_URL" 2>/dev/null || echo 000)
  sign_in=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$APP_URL/sign-in" 2>/dev/null || echo 000)
  sign_up=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$APP_URL/sign-up" 2>/dev/null || echo 000)
  onboarding=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$APP_URL/onboarding" 2>/dev/null || echo 000)
  admin=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$ADMIN_URL" 2>/dev/null || echo 000)
  api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API_URL/v1/health" 2>/dev/null || echo 000)
  oidc=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API_URL/api/auth/.well-known/oauth-authorization-server" 2>/dev/null || echo 000)
  runner=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$RUNNER_PORT/healthz" 2>/dev/null || echo 000)
  echo "web=$web sign-in=$sign_in sign-up=$sign_up onboarding=$onboarding admin=$admin api=$api oidc=$oidc runner=$runner"
  [ "$web" = 200 ] && [ "$sign_in" = 200 ] && [ "$sign_up" = 200 ] && \
    [ "$onboarding" = 200 ] && [ "$admin" = 200 ] && [ "$api" = 200 ] && \
    [ "$oidc" = 200 ] && [ "$runner" = 200 ]
}

terminate_tree() {
  local tree_pid=$1 signal=${2:-TERM} child
  for child in $(pgrep -P "$tree_pid" 2>/dev/null || true); do
    terminate_tree "$child" "$signal"
  done
  kill -"$signal" "$tree_pid" 2>/dev/null || true
}

stop_stack() {
  local stack_pid=""
  if [ -f "$STACK_PID_FILE" ]; then
    IFS= read -r stack_pid <"$STACK_PID_FILE" || true
    case "$stack_pid" in
      ''|*[!0-9]*) stack_pid="" ;;
      *) terminate_tree "$stack_pid" TERM ;;
    esac
  fi
  # Remove processes left by the retired proxy-backed stack as well as this supervisor. Every
  # fallback includes this checkout's absolute root; no sibling worktree is touched.
  pkill -f "$ROOT/scripts/dev-stack-supervisor.sh" 2>/dev/null || true
  pkill -f "$ROOT/node_modules/portless/dist/cli.js proxy start.*--port $WEB_PORT" 2>/dev/null || true
  sleep 2
  if [ -n "$stack_pid" ] && kill -0 "$stack_pid" 2>/dev/null; then
    terminate_tree "$stack_pid" KILL
  fi
  rm -f "$STACK_PID_FILE"
}

case "${1:-start}" in
  env) print_env ;;
  stop) stop_stack; echo "stopped" ;;
  status) probe ;;
  start)
    stop_stack
    : >"$LOG"
    cd "$ROOT" || exit 1
    # dotenv fills the rest of the contract without replacing the explicit topology above.
    if ! pnpm exec dotenv -e .env.local -- pnpm turbo run db:migrate --filter=@docket/db >>"$LOG" 2>&1; then
      echo "database migration failed" >&2
      tail -40 "$LOG" >&2
      exit 1
    fi
    if ! pnpm --filter @docket/api build >>"$LOG" 2>&1; then
      echo "API contract build failed" >&2
      tail -40 "$LOG" >&2
      exit 1
    fi
    ulimit -n 8192
    nohup "$ROOT/scripts/dev-stack-supervisor.sh" >>"$LOG" 2>&1 < /dev/null &
    stack_pid=$!
    echo "$stack_pid" >"$STACK_PID_FILE"
    disown 2>/dev/null || true
    for _ in $(seq 1 90); do
      out=$(probe) && { echo "READY $out"; print_env; exit 0; }
      sleep 5
    done
    echo "NOT READY after ~7.5min: $(probe)" >&2
    tail -60 "$LOG" >&2
    stop_stack
    exit 1
    ;;
  *) echo "usage: dev-stack.sh {start|stop|status|env}" >&2; exit 2 ;;
esac
