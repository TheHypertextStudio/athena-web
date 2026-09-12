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
LOG="${TMPDIR:-/tmp}/docket-dev-${UID}-$(basename "$ROOT").log"

PREFIX="$(basename "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)")"
GIT_DIR="$(git -C "$ROOT" rev-parse --absolute-git-dir 2>/dev/null || true)"
GIT_COMMON_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
IS_WORKTREE=false
HOST_PREFIX=""
if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ] && [ "$PREFIX" != main ] && [ "$PREFIX" != master ]; then
  IS_WORKTREE=true
  HOST_PREFIX="$PREFIX."
fi

# Every host in this stack is a `*.docket.localhost` name, and the whole `.localhost` TLD resolves
# to 127.0.0.1. The branch prefix therefore decorates the *name* and does nothing to the *address*:
# two worktrees that pick the same port both answer on 127.0.0.1:<port>, and whichever bound it
# first serves both. Requests to `b.docket.localhost:1355` reach worktree A's server, which then
# rejects them against its own allowlist — the failure reads as an auth or config bug and is
# neither. Give each worktree its own port block so the address distinguishes them too.
#
# The primary checkout keeps 1355 so the documented URLs and anything holding that number stay
# right. Worktrees hash their git dir — stable across branch renames, unlike the branch name — into
# a stride-4 block above the primary range.
derive_web_port() {
  if [ "$IS_WORKTREE" != true ]; then
    echo 1355
    return
  fi
  local digest slot
  digest=$(printf '%s' "$GIT_DIR" | cksum | cut -d' ' -f1)
  slot=$((digest % 150))
  echo $((1400 + slot * 4))
}

# A free block is one where every port is either unbound or already bound by *this* stack. Probing
# forward keeps two worktrees that hash to the same slot from fighting over it.
port_owner_pid() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1
}

block_is_available() {
  local base=$1 offset owner
  for offset in 0 1 2 3; do
    owner=$(port_owner_pid $((base + offset)))
    [ -z "$owner" ] && continue
    # Ours if the listener's working directory is inside this checkout.
    lsof -a -p "$owner" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | grep -q "^$ROOT" || return 1
  done
  return 0
}

resolve_ports() {
  local candidate attempts
  if [ -n "${DOCKET_DEV_PORT:-}" ]; then
    WEB_PORT="$DOCKET_DEV_PORT"
  else
    candidate=$(derive_web_port)
    attempts=0
    while [ "$attempts" -lt 40 ] && ! block_is_available "$candidate"; do
      candidate=$((candidate + 4))
      attempts=$((attempts + 1))
    done
    WEB_PORT="$candidate"
  fi
  API_PORT=$((WEB_PORT + 1))
  ADMIN_PORT=$((WEB_PORT + 2))
  RUNNER_PORT=$((WEB_PORT + 3))
}

resolve_ports
STACK_PID_FILE="${TMPDIR:-/tmp}/docket-dev-${UID}-${PREFIX}-${WEB_PORT}.pid"

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

# Confirm the process answering our web port is this checkout's.
#
# Without this the stack reports healthy while a sibling worktree serves every request: each host
# is a `.localhost` name on 127.0.0.1, so a foreign listener responds to ours indistinguishably.
# What the caller then sees is the foreign app's behaviour — an origin allowlist that excludes this
# branch, a schema from another migration state — attributed to their own code.
verify_ownership() {
  local owner cwd
  owner=$(port_owner_pid "$WEB_PORT")
  if [ -z "$owner" ]; then
    echo "dev-stack: nothing is listening on $WEB_PORT." >&2
    return 1
  fi
  cwd=$(lsof -a -p "$owner" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  case "$cwd" in
    "$ROOT"*) return 0 ;;
  esac
  cat >&2 <<EOF
dev-stack: port $WEB_PORT is served by another checkout, not this one.

  this checkout : $ROOT
  listener pid  : $owner
  listener cwd  : ${cwd:-unknown}

Every *.docket.localhost host resolves to 127.0.0.1, so that process is answering this stack's
URLs. Anything you verify against them is that checkout's behaviour, not yours. Stop its stack, or
set DOCKET_DEV_PORT to a free block, then start again.
EOF
  return 1
}

probe() {
  local web sign_in sign_up onboarding admin api oidc runner
  verify_ownership || return 1
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
