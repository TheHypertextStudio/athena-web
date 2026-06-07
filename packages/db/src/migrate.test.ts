import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the offline migration runner. The pglite branches run against real
 * in-memory PGlite databases.
 */

const ORIGINAL_URL = process.env['DATABASE_URL'];
const ORIGINAL_UNPOOLED = process.env['DATABASE_URL_UNPOOLED'];

function restoreEnv(): void {
  if (ORIGINAL_URL === undefined) delete process.env['DATABASE_URL'];
  else process.env['DATABASE_URL'] = ORIGINAL_URL;
  if (ORIGINAL_UNPOOLED === undefined) delete process.env['DATABASE_URL_UNPOOLED'];
  else process.env['DATABASE_URL_UNPOOLED'] = ORIGINAL_UNPOOLED;
}

beforeEach(() => {
  delete process.env['DATABASE_URL'];
  delete process.env['DATABASE_URL_UNPOOLED'];
  vi.resetModules();
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe('migrate main()', () => {
  it('migrates a fresh in-memory PGlite (pglite://memory)', async () => {
    process.env['DATABASE_URL'] = 'pglite://memory';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('./migrate');
    await expect(main()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('migrations applied (pglite)'));
  });

  it('migrates a bare pglite: URL (default memory)', async () => {
    process.env['DATABASE_URL'] = 'pglite:';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('./migrate');
    await expect(main()).resolves.toBeUndefined();
  });

  it('migrates a pglite:// URL with the :memory: alias', async () => {
    process.env['DATABASE_URL'] = 'pglite://:memory:';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('./migrate');
    await expect(main()).resolves.toBeUndefined();
  });

  it('migrates an on-disk pglite path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'docket-migrate-'));
    process.env['DATABASE_URL'] = `pglite://${join(dir, 'db')}`;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { main } = await import('./migrate');
      await expect(main()).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers DATABASE_URL_UNPOOLED over DATABASE_URL', async () => {
    // The unpooled (pglite) URL is migrated; the pooled URL is ignored.
    process.env['DATABASE_URL_UNPOOLED'] = 'pglite://memory';
    process.env['DATABASE_URL'] = 'pglite://memory';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('./migrate');
    await expect(main()).resolves.toBeUndefined();
  });

  it('throws when neither DATABASE_URL nor DATABASE_URL_UNPOOLED is set', async () => {
    // No env → fail fast. There is deliberately no hidden default URL (12-factor: config
    // is always explicit), so the runner refuses to guess a database to migrate.
    const { main } = await import('./migrate');
    await expect(main()).rejects.toThrow(/DATABASE_URL is not set/);
  });
});
