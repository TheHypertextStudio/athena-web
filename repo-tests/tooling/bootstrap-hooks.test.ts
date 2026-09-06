import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

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
});
