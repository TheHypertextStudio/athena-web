import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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

const fixtures: string[] = [];
afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Run cleanup against disposable checkouts with every process signal replaced by a recorder. */
function stackFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'docket-stack-test-'));
  fixtures.push(directory);
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const mocks = {
    lsof: `owner="$MOCK_CWD"
if [ -n "\${MOCK_ESCALATED_CWD:-}" ] && [ -f "$CALL_LOG" ]; then
  case "$(cat "$CALL_LOG")" in *'signal -TERM'*) owner="$MOCK_ESCALATED_CWD" ;; esac
fi
printf "n%s\\n" "$owner"`,
    pgrep: 'exit 1',
    pkill: 'printf "fallback %s\\n" "$*" >> "$CALL_LOG"',
    sleep: 'exit 0',
    pnpm: 'exit 97',
    node: 'exit 97',
  };
  for (const [name, body] of Object.entries(mocks)) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  }
  return { directory, bin, calls: join(directory, 'calls') };
}

/** Copy only the launcher, without Node, pnpm dependencies, or a real supervisor. */
function checkoutFixture(directory: string, name: string): string {
  const root = join(directory, name, 'athena-web');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts/dev-stack.sh'), script);
  return root;
}

/** Process ownership and lifetime simulated by the fixture's command recorders. */
interface StopOptions {
  readonly owner?: string;
  readonly escalatedOwner?: string;
  readonly alive?: boolean;
  readonly expectedStatus?: number;
}

/** Source the real stop command so its computed state paths can also be inspected. */
function stopFixture(
  fixture: ReturnType<typeof stackFixture>,
  root: string,
  options: StopOptions = {},
) {
  const result = spawnSync(
    'bash',
    [
      '-c',
      'kill() { printf "signal %s\\n" "$*" >> "$CALL_LOG"; [ "$1" != "-0" ] || [ "${MOCK_ALIVE:-}" = 1 ]; }; export -f kill; source "$1" stop; printf "%s\\n" "$LOG" "$STACK_PID_FILE"',
      'dev-stack-test',
      join(root, 'scripts/dev-stack.sh'),
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixture.bin}:${process.env['PATH']}`,
        TMPDIR: fixture.directory,
        CALL_LOG: fixture.calls,
        MOCK_CWD: options.owner ?? root,
        MOCK_ESCALATED_CWD: options.escalatedOwner ?? '',
        MOCK_ALIVE: options.alive ? '1' : '',
      },
    },
  );
  expect(result.status, result.stderr).toBe(options.expectedStatus ?? 0);
  if (result.status !== 0) return { log: '', pid: '', stderr: result.stderr };
  const [log, pid] = result.stdout.trim().split('\n').slice(-2);
  if (!log || !pid) throw new Error('Launcher did not report its state files.');
  return { log, pid, stderr: result.stderr };
}

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

describe('checkout-scoped development stack state', () => {
  it('gives same-basename checkouts distinct stable PID and log files without pnpm', () => {
    const fixture = stackFixture();
    const alpha = checkoutFixture(fixture.directory, 'alpha');
    const beta = checkoutFixture(fixture.directory, 'beta');
    const first = stopFixture(fixture, alpha);
    const second = stopFixture(fixture, beta);
    expect(first.pid).not.toBe(second.pid);
    expect(first.log).not.toBe(second.log);
    expect(stopFixture(fixture, alpha)).toEqual(first);
  });

  it('ignores the other checkout PID and the old shared basename PID', () => {
    const fixture = stackFixture();
    const alpha = checkoutFixture(fixture.directory, 'alpha');
    const beta = checkoutFixture(fixture.directory, 'beta');
    const own = stopFixture(fixture, alpha);
    const foreign = stopFixture(fixture, beta);
    const legacy = join(fixture.directory, `docket-dev-${process.getuid?.()}-athena-web.pid`);
    writeFileSync(foreign.pid, '12345\n');
    writeFileSync(legacy, '67890\n');
    writeFileSync(fixture.calls, '');
    stopFixture(fixture, alpha, { owner: beta });
    expect(readFileSync(fixture.calls, 'utf8')).not.toContain('signal');
    expect(readFileSync(foreign.pid, 'utf8')).toBe('12345\n');
    expect(readFileSync(legacy, 'utf8')).toBe('67890\n');
    expect(own.pid).not.toBe(foreign.pid);
  });

  it.each(['exit 1', 'printf invalid'])('fails closed when hashing fails: %s', (body) => {
    const fixture = stackFixture();
    const root = checkoutFixture(fixture.directory, 'alpha');
    writeFileSync(fixture.calls, '');
    writeFileSync(join(fixture.bin, 'sha256sum'), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    const result = stopFixture(fixture, root, { expectedStatus: 1 });
    expect(result.stderr).toContain('checkout identity');
    expect(readFileSync(fixture.calls, 'utf8')).toBe('');
  });

  it('does not escalate when a terminated supervisor PID is reused by another checkout', () => {
    const fixture = stackFixture();
    const alpha = checkoutFixture(fixture.directory, 'alpha');
    const beta = checkoutFixture(fixture.directory, 'beta');
    const own = stopFixture(fixture, alpha);
    writeFileSync(own.pid, '12345\n');
    writeFileSync(fixture.calls, '');
    stopFixture(fixture, alpha, { alive: true, escalatedOwner: beta });
    const calls = readFileSync(fixture.calls, 'utf8');
    expect(calls).toContain('signal -TERM 12345');
    expect(calls).not.toContain('signal -KILL');
  });

  it('rejects a reused foreign PID even in its own state file and still stops its supervisor', () => {
    const fixture = stackFixture();
    const alpha = checkoutFixture(fixture.directory, 'alpha');
    const beta = checkoutFixture(fixture.directory, 'beta');
    const own = stopFixture(fixture, alpha);
    writeFileSync(own.pid, '12345\n');
    writeFileSync(fixture.calls, '');
    stopFixture(fixture, alpha, { owner: beta });
    expect(readFileSync(fixture.calls, 'utf8')).not.toContain('signal');
    writeFileSync(own.pid, '12345\n');
    writeFileSync(fixture.calls, '');
    stopFixture(fixture, alpha, { alive: true });
    expect(readFileSync(fixture.calls, 'utf8')).toContain('signal -TERM 12345');
    expect(readFileSync(fixture.calls, 'utf8')).toContain('signal -KILL 12345');
  });
});
