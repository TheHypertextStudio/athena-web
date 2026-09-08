import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = readFileSync(resolve(import.meta.dirname, '../../scripts/dev-stack.sh'), 'utf8');
const supervisor = readFileSync(
  resolve(import.meta.dirname, '../../scripts/dev-stack-supervisor.sh'),
  'utf8',
);
const bootstrapVerifier = readFileSync(
  resolve(import.meta.dirname, '../../scripts/bootstrap-verify'),
  'utf8',
);
const adminManifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../apps/admin/package.json'), 'utf8'),
) as { readonly devDependencies?: Readonly<Record<string, string>> };

describe('documented development stack', () => {
  it('uses explicit adjacent ports instead of a shared reverse proxy', () => {
    expect(script).toContain('WEB_PORT="${DOCKET_DEV_PORT:-1355}"');
    expect(script).toContain('API_PORT=$((WEB_PORT + 1))');
    expect(script).toContain('ADMIN_PORT=$((WEB_PORT + 2))');
    expect(script).toContain('RUNNER_PORT=$((WEB_PORT + 3))');
    expect(supervisor).not.toContain('portless');
  });

  it('scopes process cleanup to the current worktree', () => {
    const processKills = script.split('\n').filter((line) => line.trim().startsWith('pkill -f'));
    expect(processKills).not.toHaveLength(0);
    expect(processKills.every((line) => line.includes('$ROOT'))).toBe(true);
    expect(script).not.toContain('portless proxy stop');
  });

  it('records the stack supervisor and terminates its complete process tree', () => {
    expect(script).toContain('STACK_PID_FILE=');
    expect(script).toContain('terminate_tree()');
    expect(script).toContain('pgrep -P');
    expect(script).toContain('echo "$stack_pid" >"$STACK_PID_FILE"');
    expect(script).toContain('rm -f "$STACK_PID_FILE"');
    expect(supervisor).toContain('trap cleanup EXIT INT TERM');
  });

  it('warms every authentication hand-off route before reporting ready', () => {
    expect(script).toContain('$APP_URL/sign-in');
    expect(script).toContain('$APP_URL/sign-up');
    expect(script).toContain('$APP_URL/onboarding');
    expect(script).toContain('[ "$sign_in" = 200 ]');
    expect(script).toContain('[ "$sign_up" = 200 ]');
    expect(script).toContain('[ "$onboarding" = 200 ]');
  });

  it('checks all four application processes', () => {
    expect(script).toContain('$ADMIN_URL');
    expect(script).toContain('$API_URL/v1/health');
    expect(script).toContain('$RUNNER_PORT/healthz');
    expect(supervisor).toContain('apps/web');
    expect(supervisor).toContain('apps/admin');
    expect(supervisor).toContain('apps/api');
    expect(supervisor).toContain('apps/runner');
  });

  it('uses branch-prefixed hosts in linked worktrees', () => {
    expect(script).toContain('HOST_PREFIX=""');
    expect(script).toContain('if [ "$GIT_DIR" != "$GIT_COMMON_DIR" ]');
    expect(script).toContain('HOST_PREFIX="$PREFIX."');
    expect(script).toContain('http://${HOST_PREFIX}docket.localhost:$WEB_PORT');
    expect(script).toContain('http://${HOST_PREFIX}api.docket.localhost:$API_PORT');
  });

  it('builds the API contract and migrates before starting services', () => {
    expect(script).toContain('turbo run db:migrate --filter=@docket/db');
    expect(script).toContain('pnpm --filter @docket/api build');
    expect(script).toContain('ulimit -n 8192');
  });

  it('declares the CLI used to bootstrap the admin app', () => {
    expect(adminManifest.devDependencies?.['tsx']).toBeDefined();
  });

  it('proves passkey sign-in against an isolated temporary database', () => {
    expect(bootstrapVerifier).toContain('mktemp -d');
    expect(bootstrapVerifier).toContain('DATABASE_URL="pglite://$verification_database"');
    expect(bootstrapVerifier).toContain('e2e/auth/sign-in.spec.ts');
    expect(bootstrapVerifier).toContain('"$repo_root/scripts/dev-stack.sh" stop');
    expect(bootstrapVerifier).toContain('trap cleanup');
  });
});
