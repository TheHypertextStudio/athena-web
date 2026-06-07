import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the offline migration runner. The pglite branches run against real
 * in-memory PGlite databases; the postgres/neon branches use mocked `postgres` +
 * `drizzle-orm/postgres-js` (and its migrator) so no real connection is opened.
 */

const ORIGINAL_URL = process.env['DATABASE_URL'];
const ORIGINAL_UNPOOLED = process.env['DATABASE_URL_UNPOOLED'];

interface PostgresCall {
  url: string;
  opts: unknown;
}

const postgresCalls: PostgresCall[] = [];
let endCalled = 0;
let postgresMigrateCalls = 0;

vi.mock('postgres', () => ({
  default: (url: string, opts: unknown) => {
    postgresCalls.push({ url, opts });
    return {
      end: () => {
        endCalled += 1;
      },
    } as unknown;
  },
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: (client: unknown) => ({ __pg: true, $client: client }) as unknown,
}));

vi.mock('drizzle-orm/postgres-js/migrator', () => ({
  migrate: async () => {
    postgresMigrateCalls += 1;
  },
}));

function restoreEnv(): void {
  if (ORIGINAL_URL === undefined) delete process.env['DATABASE_URL'];
  else process.env['DATABASE_URL'] = ORIGINAL_URL;
  if (ORIGINAL_UNPOOLED === undefined) delete process.env['DATABASE_URL_UNPOOLED'];
  else process.env['DATABASE_URL_UNPOOLED'] = ORIGINAL_UNPOOLED;
}

beforeEach(() => {
  postgresCalls.length = 0;
  endCalled = 0;
  postgresMigrateCalls = 0;
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
    process.env['DATABASE_URL_UNPOOLED'] = 'pglite://memory';
    process.env['DATABASE_URL'] = 'postgres://should-not-be-used/db';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('./migrate');
    await expect(main()).resolves.toBeUndefined();
    // The postgres branch must NOT have been taken.
    expect(postgresCalls).toHaveLength(0);
  });

  it('throws when neither DATABASE_URL nor DATABASE_URL_UNPOOLED is set', async () => {
    // No env → fail fast. There is deliberately no hidden default URL (12-factor: config
    // is always explicit), so the runner refuses to guess a database to migrate.
    const { main } = await import('./migrate');
    await expect(main()).rejects.toThrow(/DATABASE_URL is not set/);
  });

  it('uses the postgres-js driver for a postgres:// URL', async () => {
    process.env['DATABASE_URL'] = 'postgres://user:pass@localhost:5432/docket';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('./migrate');
    await main();
    expect(postgresCalls).toHaveLength(1);
    expect(postgresCalls[0]?.url).toBe('postgres://user:pass@localhost:5432/docket');
    expect(postgresCalls[0]?.opts).toEqual({ max: 1, prepare: false });
    expect(postgresMigrateCalls).toBe(1);
    expect(endCalled).toBe(1);
  });

  it('rewrites a neon: URL to postgres: before migrating', async () => {
    process.env['DATABASE_URL'] = 'neon://user:pass@ep.neon.tech/docket';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('./migrate');
    await main();
    expect(postgresCalls[0]?.url).toBe('postgres://user:pass@ep.neon.tech/docket');
  });

  it('rejects when the migration fails', async () => {
    process.env['DATABASE_URL'] = 'postgres://localhost/db';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const mig = await import('drizzle-orm/postgres-js/migrator');
    vi.spyOn(mig, 'migrate').mockRejectedValueOnce(new Error('boom'));
    const { main } = await import('./migrate');
    await expect(main()).rejects.toThrow('boom');
  });
});
