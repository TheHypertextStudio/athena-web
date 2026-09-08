import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { reconcileDocketLocal } from '../../scripts/bootstrap/local';
import { parseEnvFile } from '../../scripts/env-file';

const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'docket-bootstrap-hook-'));
  roots.push(root);
  copyFileSync(resolve(import.meta.dirname, '../../.env.example'), resolve(root, '.env.example'));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Docket bootstrap hooks', () => {
  it('keeps explicit project-hook aliases while the root launcher is release-gated', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts['bootstrap:project']).toBe('tsx scripts/bootstrap.ts');
    expect(pkg.scripts['bootstrap:local']).toBe('scripts/bootstrap-local');
    expect(pkg.scripts['bootstrap:verify']).toBe('scripts/bootstrap-verify');
  });

  it.each(['bootstrap-local', 'bootstrap-production', 'bootstrap-verify'])(
    'ships executable scripts/%s',
    (name) => {
      const path = resolve(import.meta.dirname, '../../scripts', name);
      expect(statSync(path).mode & 0o111).not.toBe(0);
      expect(readFileSync(path, 'utf8')).toMatch(/^#!\/bin\/sh/);
    },
  );

  it('converges local configuration through the same project entry function', () => {
    const root = fixture();
    const first = reconcileDocketLocal(root, {
      platform: 'linux',
      generateSecret: (name) => `${name}-${'x'.repeat(40)}`,
    });
    const second = reconcileDocketLocal(root, {
      platform: 'linux',
      generateSecret: (name) => `${name}-${'y'.repeat(40)}`,
    });

    expect(first).toEqual({ changed: true, diagnostics: [] });
    expect(second).toEqual({ changed: false, diagnostics: [] });
    expect(parseEnvFile(resolve(root, '.env.local'))['NEXT_PUBLIC_PASSKEY_RP_ID']).toBe(
      'docket.localhost',
    );
  });

  it('honors no-install and offline before asking pnpm to install the workspace', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../scripts/bootstrap-local'),
      'utf8',
    );
    expect(source).toContain('BOOTSTRAP_NO_INSTALL');
    expect(source).toContain('BOOTSTRAP_OFFLINE');
    expect(source).toContain('pnpm install --frozen-lockfile');
  });

  it('always reconciles repository Git guardrails', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../scripts/bootstrap-local'),
      'utf8',
    );

    expect(source).toContain('scripts/install-git-guardrails.sh');
  });

  it('installs secret, commit-message, merge, and pre-push policy', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../scripts/install-git-guardrails.sh'),
      'utf8',
    );

    expect(source).toContain('pnpm secret-scan');
    expect(source).toContain('write_hook "$hooks_dir/commit-msg"');
    expect(source).toContain('write_hook "$hooks_dir/pre-merge-commit"');
    expect(source).toContain('write_hook "$hooks_dir/pre-push"');
    expect(source).toContain('pnpm typecheck');
    expect(source).toContain('pnpm test');
  });

  it('does not rewrite converged Git guardrails', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'docket-bootstrap-git-'));
    roots.push(root);
    execFileSync('git', ['init', '--quiet', root]);
    const installer = resolve(import.meta.dirname, '../../scripts/install-git-guardrails.sh');

    execFileSync(installer, { cwd: root });
    const hook = resolve(root, '.git/docket-hooks/commit-msg');
    const config = resolve(root, '.git/config');
    const before = {
      hookBytes: readFileSync(hook),
      hookMtime: statSync(hook).mtimeMs,
      configBytes: readFileSync(config),
      configMtime: statSync(config).mtimeMs,
    };
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));

    execFileSync(installer, { cwd: root });

    expect(readFileSync(hook)).toEqual(before.hookBytes);
    expect(statSync(hook).mtimeMs).toBe(before.hookMtime);
    expect(readFileSync(config)).toEqual(before.configBytes);
    expect(statSync(config).mtimeMs).toBe(before.configMtime);
  });
});
