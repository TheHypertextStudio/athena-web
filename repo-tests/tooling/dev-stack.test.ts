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
  it('takes its hosts and ports from the shared resolver instead of declaring them', () => {
    // The script used to export ~20 host-bearing variables of its own, which made it one of five
    // files with an opinion about what a dev host looks like. Two of those five had already
    // drifted, and a drift here surfaces as broken authentication rather than as a config error.
    expect(script).toContain('packages/dev-topology/bin/print-env.ts');
    expect(script).toContain('--print-base');
    expect(script).toContain('eval "$rendered"');
    expect(script).toContain('DOCKET_DEV_PORT');
    expect(supervisor).not.toContain('portless');
  });

  it('does not hand-write a dev hostname or a port block of its own', () => {
    expect(script).not.toContain('derive_web_port');
    // Re-emitting a resolved value for a caller to eval is fine; writing a literal host is the
    // duplication that drifts. Only literals are forbidden here.
    const literalHost = script
      .split('\n')
      .filter((line) => line.includes('docket.localhost'))
      .filter((line) => !line.trim().startsWith('#'))
      .filter((line) => /[=:]/.test(line));
    expect(literalHost).toEqual([]);
  });

  it('probes for a free block before accepting the derived one', () => {
    // Two checkouts can hash to the same slot, and only the shell can see what is listening.
    expect(script).toContain('block_is_available');
    expect(script).toContain('port_owner_pid');
    expect(script).toMatch(/candidate=\$\(\(candidate \+ 4\)\)/);
  });

  it('refuses to report healthy when another checkout owns the port', () => {
    expect(script).toContain('verify_ownership()');
    // The check is the listener's working directory against this checkout's root; a foreign
    // listener is reported with its pid and cwd instead of being counted as a healthy stack.
    expect(script).toContain('-d cwd');
    expect(script).toMatch(/verify_ownership \|\| return 1/);
  });

  it('offers one command that explains the topology', () => {
    expect(script).toContain('doctor)');
    expect(script).toContain('packages/dev-topology/bin/doctor.ts');
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

  it('gives every service its port from the block the resolver chose', () => {
    for (const name of [
      'DOCKET_WEB_PORT',
      'DOCKET_API_PORT',
      'DOCKET_ADMIN_PORT',
      'DOCKET_RUNNER_PORT',
    ]) {
      expect(supervisor).toContain(name);
    }
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
