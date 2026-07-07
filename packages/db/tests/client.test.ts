import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the driver-selecting client.
 *
 * Driver selection is unit-tested at the IO boundary so the root test run does not
 * repeatedly start embedded PGlite. Real migration/schema behavior is covered in
 * `db.test.ts`.
 */

type CloseMock = ReturnType<typeof vi.fn>;

interface PgliteClientDouble {
  readonly dataDir: string;
  readonly close: CloseMock;
}

const clientMocks = vi.hoisted(() => ({
  drizzlePglite: vi.fn(),
  drizzlePostgres: vi.fn(),
  pgliteClients: [] as PgliteClientDouble[],
  postgres: vi.fn(),
  postgresClients: [] as { end: CloseMock }[],
  PGlite: vi.fn(),
}));

vi.mock('@electric-sql/pglite', () => ({ PGlite: clientMocks.PGlite }));
vi.mock('drizzle-orm/pglite', () => ({ drizzle: clientMocks.drizzlePglite }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: clientMocks.drizzlePostgres }));
vi.mock('postgres', () => ({ default: clientMocks.postgres }));

/** Read an arbitrary (non-typed) member off the lazy `db` Proxy without `this`-binding lint. */
function touch(db: unknown, prop: string): unknown {
  return (db as Record<string, unknown>)[prop];
}

function makeDrizzleDouble(): Record<string, unknown> {
  return {
    execute: vi.fn(async () => ({ rows: [] })),
    insert: vi.fn(),
    query: {},
    select: vi.fn(),
  };
}

function resetDriverMocks(): void {
  clientMocks.pgliteClients.length = 0;
  clientMocks.postgresClients.length = 0;
  clientMocks.PGlite.mockReset();
  clientMocks.drizzlePglite.mockReset();
  clientMocks.drizzlePostgres.mockReset();
  clientMocks.postgres.mockReset();

  clientMocks.PGlite.mockImplementation(function PGliteDouble(dataDir: string) {
    const client = { close: vi.fn(async () => undefined), dataDir };
    clientMocks.pgliteClients.push(client);
    return client;
  });
  clientMocks.drizzlePglite.mockImplementation(() => makeDrizzleDouble());
  clientMocks.drizzlePostgres.mockImplementation(() => makeDrizzleDouble());
  clientMocks.postgres.mockImplementation(() => {
    const client = { end: vi.fn(async () => undefined) };
    clientMocks.postgresClients.push(client);
    return client;
  });
}

beforeEach(() => {
  vi.resetModules();
  resetDriverMocks();
});

afterEach(async () => {
  const { closeDb } = await import('../src/client');
  await closeDb();
});

describe('db client driver selection', () => {
  it('throws a helpful error when DATABASE_URL is unset', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    const { db } = await import('../src/client');
    // First property access triggers lazy construction -> throws.
    expect(() => touch(db, 'select')).toThrow(/DATABASE_URL is not set/);
    expect(clientMocks.PGlite).not.toHaveBeenCalled();
  });

  it('builds a pglite client for a pglite:// memory URL', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite://memory');
    const { db } = await import('../src/client');
    // A pglite drizzle client exposes the query builder + relational `query`.
    expect(typeof touch(db, 'select')).toBe('function');
    expect(touch(db, 'query')).toBeTypeOf('object');
    expect(clientMocks.PGlite).toHaveBeenCalledWith('memory://');
    expect(clientMocks.drizzlePglite).toHaveBeenCalledWith(
      clientMocks.pgliteClients[0],
      expect.objectContaining({ schema: expect.any(Object) }),
    );
  });

  it('builds a pglite client for a bare pglite: URL (default memory)', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite:');
    const { db } = await import('../src/client');
    expect(typeof touch(db, 'insert')).toBe('function');
    expect(clientMocks.PGlite).toHaveBeenCalledWith('memory://');
  });

  it('builds a pglite client for an on-disk pglite path', async () => {
    // Point at an existing temp dir so the path branch can create its store there.
    const dir = mkdtempSync(join(tmpdir(), 'docket-client-'));
    vi.stubEnv('DATABASE_URL', `pglite://${dir}`);
    try {
      const { db } = await import('../src/client');
      expect(typeof touch(db, 'select')).toBe('function');
      expect(clientMocks.PGlite).toHaveBeenCalledWith(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('binds function members to the real client (Proxy bind branch)', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite://memory');
    const { db } = await import('../src/client');
    const select = touch(db, 'select') as () => unknown;
    expect(typeof select).toBe('function');
    // Calling the detached reference must not throw on `this` (it was bound).
    expect(() => select()).not.toThrow();
  });

  it('closes and clears the cached pglite client', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite://memory');
    const { closeDb, db } = await import('../src/client');
    expect(typeof touch(db, 'select')).toBe('function');
    const firstClient = clientMocks.pgliteClients[0]!;

    await closeDb();

    expect(firstClient.close).toHaveBeenCalledTimes(1);
    expect(clientMocks.PGlite).toHaveBeenCalledTimes(1);
    expect(typeof touch(db, 'select')).toBe('function');
    expect(clientMocks.PGlite).toHaveBeenCalledTimes(2);
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
