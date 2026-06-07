import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { sql as sqlTag } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the driver-selecting client. The pglite branch uses a real in-memory PGlite.
 *
 * Each test resets the module registry so the module-level `cached` singleton and the
 * top-level driver imports are re-evaluated against fresh env.
 */

const ORIGINAL_DATABASE_URL = process.env['DATABASE_URL'];

/** Read an arbitrary (non-typed) member off the lazy `db` Proxy without `this`-binding lint. */
function touch(db: unknown, prop: string): unknown {
  return (db as Record<string, unknown>)[prop];
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env['DATABASE_URL'];
  } else {
    process.env['DATABASE_URL'] = ORIGINAL_DATABASE_URL;
  }
});

describe('db client driver selection', () => {
  it('throws a helpful error when DATABASE_URL is unset', async () => {
    delete process.env['DATABASE_URL'];
    const { db } = await import('../src/client');
    // First property access triggers lazy construction → throws.
    expect(() => touch(db, 'select')).toThrow(/DATABASE_URL is not set/);
  });

  it('builds a pglite client for a pglite:// memory URL', async () => {
    process.env['DATABASE_URL'] = 'pglite://memory';
    const { db } = await import('../src/client');
    // A real pglite drizzle client exposes the query builder + relational `query`.
    expect(typeof touch(db, 'select')).toBe('function');
    expect(touch(db, 'query')).toBeTypeOf('object');
  });

  it('builds a pglite client for a bare pglite: URL (default memory)', async () => {
    process.env['DATABASE_URL'] = 'pglite:';
    const { db } = await import('../src/client');
    expect(typeof touch(db, 'insert')).toBe('function');
  });

  it('builds a pglite client for an on-disk pglite path', async () => {
    // Point at an existing temp dir so PGlite's nodefs can create its store there.
    const dir = mkdtempSync(join(tmpdir(), 'docket-client-'));
    process.env['DATABASE_URL'] = `pglite://${dir}`;
    try {
      const { db } = await import('../src/client');
      expect(typeof touch(db, 'select')).toBe('function');
      // Run a real query so PGlite's async on-disk init fully settles before cleanup.
      await db.execute(sqlTag`select 1 as one`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // Generous timeout: on-disk PGlite init does real filesystem + WASM work that can run
    // slow under full-suite parallel CPU contention (it is fast in isolation).
  }, 30_000);

  it('binds function members to the real client (Proxy bind branch)', async () => {
    process.env['DATABASE_URL'] = 'pglite://memory';
    const { db } = await import('../src/client');
    const select = touch(db, 'select') as () => unknown;
    expect(typeof select).toBe('function');
    // Calling the detached reference must not throw on `this` (it was bound).
    expect(() => select()).not.toThrow();
  });

  it('exposes the full schema namespace', async () => {
    const { fullSchema } = await import('../src/client');
    expect(fullSchema).toHaveProperty('organization');
    expect(fullSchema).toHaveProperty('task');
    expect(fullSchema).toHaveProperty('organizationRelations');
  });

  it('anchors a relative pglite data dir to the workspace root, not the cwd', async () => {
    const { pgliteDataDir } = await import('../src/client');
    const result = pgliteDataDir('pglite://.data/docket');
    // A relative on-disk path resolves to an absolute path anchored above this package
    // (the monorepo root) so migrations and the API open the same database file
    // regardless of which directory the process runs from.
    expect(isAbsolute(result)).toBe(true);
    expect(result.endsWith('/.data/docket')).toBe(true);
  });
});
