import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const launcherPath = resolve(repositoryRoot, 'bootstrap');
const fixtureRoots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'docket-bootstrap-entrypoint-'));
  fixtureRoots.push(root);
  mkdirSync(resolve(root, 'scripts'));
  copyFileSync(launcherPath, resolve(root, 'bootstrap'));
  chmodSync(resolve(root, 'bootstrap'), 0o755);
  for (const hook of ['bootstrap-local', 'bootstrap-production', 'bootstrap-verify']) {
    writeFileSync(
      resolve(root, 'scripts', hook),
      `#!/bin/sh\nprintf '%s\\n' '${hook} '$* >> "$BOOTSTRAP_TEST_LOG"\nprintf '%s\\n' "approved=$BOOTSTRAP_APPROVED noninteractive=$BOOTSTRAP_NON_INTERACTIVE offline=$BOOTSTRAP_OFFLINE noinstall=$BOOTSTRAP_NO_INSTALL ci=\${CI:-}" > "$BOOTSTRAP_TEST_ENV_LOG"\n`,
      { mode: 0o755 },
    );
  }
  return root;
}

function run(root: string, args: readonly string[] = []) {
  const logPath = resolve(root, 'calls.log');
  const envLogPath = resolve(root, 'env.log');
  const result = spawnSync(resolve(root, 'bootstrap'), args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      BOOTSTRAP_TEST_LOG: logPath,
      BOOTSTRAP_TEST_ENV_LOG: envLogPath,
    },
  });
  return {
    ...result,
    calls: (() => {
      try {
        return readFileSync(logPath, 'utf8');
      } catch {
        return '';
      }
    })(),
    hookEnvironment: (() => {
      try {
        return readFileSync(envLogPath, 'utf8');
      } catch {
        return '';
      }
    })(),
  };
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('repository bootstrap entrypoint', () => {
  it('ships as an executable root entrypoint used by the package alias', () => {
    const launcher = readFileSync(launcherPath, 'utf8');
    const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(statSync(launcherPath).mode & 0o111).not.toBe(0);
    expect(launcher).toContain('scripts/bootstrap-local');
    expect(launcher).toContain('scripts/bootstrap-production');
    expect(launcher).toContain('scripts/bootstrap-verify');
    expect(launcher).toContain('scripts/dev-stack.sh');
    expect(launcher).toContain('status >/dev/null');
    expect(manifest.scripts['bootstrap']).toBe('./bootstrap');
  });

  it('converges local state and then verifies it by default', () => {
    const root = fixture();
    const result = run(root, ['--non-interactive', '--yes']);

    expect(result.status).toBe(0);
    expect(result.calls).toBe('bootstrap-local \nbootstrap-verify local\n');
    expect(result.stdout).toContain('PASS platform.');
  });

  it('keeps check and plan read-only', () => {
    const root = fixture();

    const check = run(root, ['check']);
    const plan = run(root, ['plan', 'production', '--json']);

    expect(check.status).toBe(0);
    expect(check.calls).toBe('');
    expect(check.stdout).toContain('PASS hook.scripts/bootstrap-local');
    expect(plan.status).toBe(0);
    expect(plan.calls).toBe('');
    expect(plan.stdout).toContain('scripts/bootstrap-production');
    expect(plan.stdout).toContain('"schema":"hypertext.bootstrap/v1"');
  });

  it('forwards the standard execution constraints to hooks', () => {
    const root = fixture();
    const result = run(root, [
      'verify',
      'local',
      '--yes',
      '--non-interactive',
      '--offline',
      '--no-install',
    ]);

    expect(result.status).toBe(0);
    expect(result.calls).toBe('bootstrap-verify local\n');
    expect(result.hookEnvironment).toBe('approved=1 noninteractive=1 offline=1 noinstall=1 ci=1\n');
    expect(result.stderr).toBe('');
  });

  it('rejects unknown commands, targets, and flags', () => {
    const root = fixture();

    expect(run(root, ['repair']).status).toBe(2);
    expect(run(root, ['plan', 'staging']).status).toBe(2);
    expect(run(root, ['--prodution']).status).toBe(2);
  });
});
