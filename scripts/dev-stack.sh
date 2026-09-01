#!/usr/bin/env bash
# Bring up the local dev stack in the *CI topology* — explicit :1355 ports, no TLS.
#
# Why this exists: `pnpm dev` alone relies on portless's privileged :443 proxy. When that daemon
# isn't responding, portless silently falls back to :1355 while the committed `.env.local` URLs
# (https://api.docket.localhost, no port) keep pointing at the :443 aliases — which may still be
# registered against *dead* upstreams from a previous run. The web app then proxies `/api/auth/*`
# to a stale alias and every auth call dies with an opaque TLS `EPROTO` alert, so sign-up hangs
# with no useful error. That failure mode cost a full debugging cycle; this script removes it.
#
# The override set below is byte-for-byte the topology `.github/workflows/ci.yml`'s `e2e` job uses,
# which is the one configuration proven to work headlessly without a privileged proxy.
#
# Usage:
#   scripts/dev-stack.sh start   # (re)start clean and block until every surface answers
#   scripts/dev-stack.sh stop
#   scripts/dev-stack.sh status
#   scripts/dev-stack.sh env     # print the env agents/tools should export
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG=/tmp/docket-dev.log
PORT=1355

# Portless namespaces each worktree's routes under a prefix derived from the git branch, and ALSO
# registers bare `docket.localhost` aliases. Those aliases are first-come and are NOT re-pointed when
# an older stack dies, so in a multi-worktree setup they routinely resolve to a dead upstream — the
# exact cause of a run of opaque 502s and TLS `EPROTO` auth failures here. Addressing this worktree
# by its own prefixed hostnames is the only mapping guaranteed to reach the processes we just spawned.
PREFIX="$(basename "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)")"

export PORTLESS_PORT="$PORT"
export PORTLESS_HTTPS=0
export PORTLESS_SYNC_HOSTS=0
export APP_URL="http://$PREFIX.docket.localhost:$PORT"
export WEB_URL="$APP_URL"
export API_URL="http://$PREFIX.api.docket.localhost:$PORT"
# The console's own origin, so the service probes can check it the way production does. Without
# this the admin app reports `disabled` in dev and its health route is never exercised.
export ADMIN_URL="http://$PREFIX.admin.docket.localhost:$PORT"
export NEXT_PUBLIC_API_URL="$API_URL"
export NEXT_PUBLIC_APP_URL="$APP_URL"
export BETTER_AUTH_URL="$API_URL"
export BETTER_AUTH_PASSKEY_RP_ID=docket.localhost
export NEXT_PUBLIC_PASSKEY_RP_ID=docket.localhost
export BETTER_AUTH_TRUSTED_ORIGINS="$APP_URL,$ADMIN_URL"
export MCP_ISSUER_URL="$API_URL"
export MCP_RESOURCE_URL="$API_URL/mcp"
export OIDC_LOGIN_PAGE_URL="$APP_URL/sign-in"
export GOOGLE_OAUTH_PUBLIC=false

print_env() {
  cat <<EOF
export APP_URL="$APP_URL"
export API_URL="$API_URL"
export PASSKEY_RP_ID="$BETTER_AUTH_PASSKEY_RP_ID"
EOF
}

probe() {
  local web api oidc
  web=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$APP_URL" 2>/dev/null || echo 000)
  api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API_URL/v1/health" 2>/dev/null || echo 000)
  oidc=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    "$API_URL/api/auth/.well-known/oauth-authorization-server" 2>/dev/null || echo 000)
  echo "web=$web api=$api oidc=$oidc"
  [ "$web" = 200 ] && [ "$api" = 200 ] && [ "$oidc" = 200 ]
}

stop_stack() {
  pkill -f "$ROOT/apps/(web|admin)/.*next.*dev" 2>/dev/null
  pkill -f "$ROOT/apps/api/.*tsx.*watch" 2>/dev/null
  pkill -f "$ROOT/.*portless.*run" 2>/dev/null
  pkill -f "$ROOT/.*turbo.*run.*dev" 2>/dev/null
  sleep 2
}

case "${1:-start}" in
  env) print_env ;;
  stop) stop_stack; echo "stopped" ;;
  status) probe ;;
  start)
    stop_stack
    rm -f "$LOG"
    cd "$ROOT" || exit 1
    # `proxy start` is idempotent and leaves a proxy already shared by other worktrees running.
    pnpm exec portless proxy start --port "$PORT" --no-tls >>"$LOG" 2>&1
    # Next watches the entire monorepo. macOS's default soft limit produces a partial route
    # manifest without a useful startup error once the other workspace watchers are included.
    ulimit -n 8192
    # Four packages expose persistent dev tasks. Turbo needs one additional slot to run the
    # migration tasks that precede them, regardless of the caller's bounded build concurrency.
    TURBO_CONCURRENCY=5 nohup pnpm dev >>"$LOG" 2>&1 < /dev/null &
    disown 2>/dev/null || true
    for _ in $(seq 1 90); do
      out=$(probe) && { echo "READY $out"; print_env; exit 0; }
      sleep 5
    done
    echo "NOT READY after ~7.5min: $(probe)" >&2
    tail -40 "$LOG" >&2
    exit 1
    ;;
  *) echo "usage: dev-stack.sh {start|stop|status|env}" >&2; exit 2 ;;
esac
