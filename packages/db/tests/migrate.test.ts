import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the offline migration runner.
 *
 * The real PGlite migration path is smoke-tested in `db.test.ts`; these tests keep the
 * runner contract fast by mocking the driver and migrator boundaries.
 */

const migrateMocks = vi.hoisted(() => ({
  clients: [] as { close: ReturnType<typeof vi.fn> }[],
  drizzlePglite: vi.fn((client: unknown) => ({ client })),
  migratePglite: vi.fn(async () => undefined),
  openPglite: vi.fn(),
}));

vi.mock('../src/client', () => ({ openPglite: migrateMocks.openPglite }));
vi.mock('drizzle-orm/pglite', () => ({ drizzle: migrateMocks.drizzlePglite }));
vi.mock('drizzle-orm/pglite/migrator', () => ({ migrate: migrateMocks.migratePglite }));

const ORIGINAL_URL = process.env['DATABASE_URL'];
const ORIGINAL_UNPOOLED = process.env['DATABASE_URL_UNPOOLED'];

function restoreEnv(): void {
  if (ORIGINAL_URL === undefined) delete process.env['DATABASE_URL'];
  else process.env['DATABASE_URL'] = ORIGINAL_URL;
  if (ORIGINAL_UNPOOLED === undefined) delete process.env['DATABASE_URL_UNPOOLED'];
  else process.env['DATABASE_URL_UNPOOLED'] = ORIGINAL_UNPOOLED;
}

function resetDriverMocks(): void {
  migrateMocks.clients.length = 0;
  migrateMocks.openPglite.mockReset();
  migrateMocks.drizzlePglite.mockClear();
  migrateMocks.migratePglite.mockClear();
  migrateMocks.migratePglite.mockResolvedValue(undefined);
  migrateMocks.openPglite.mockImplementation(() => {
    const client = { close: vi.fn(async () => undefined) };
    migrateMocks.clients.push(client);
    return client;
  });
}

beforeEach(() => {
  delete process.env['DATABASE_URL'];
  delete process.env['DATABASE_URL_UNPOOLED'];
  vi.resetModules();
  resetDriverMocks();
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe('migrate main()', () => {
  it('migrates a fresh in-memory PGlite URL', async () => {
    process.env['DATABASE_URL'] = 'pglite://memory';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../src/migrate');

    await expect(main()).resolves.toBeUndefined();

    expect(migrateMocks.openPglite).toHaveBeenCalledWith('pglite://memory');
    expect(migrateMocks.migratePglite).toHaveBeenCalledWith(expect.anything(), {
      migrationsFolder: expect.stringContaining('packages/db/drizzle'),
    });
    expect(migrateMocks.clients[0]!.close).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('migrations applied (pglite)'));
  });

  it('migrates a bare pglite: URL using the same driver path', async () => {
    process.env['DATABASE_URL'] = 'pglite:';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../src/migrate');

    await expect(main()).resolves.toBeUndefined();

    expect(migrateMocks.openPglite).toHaveBeenCalledWith('pglite:');
    expect(migrateMocks.migratePglite).toHaveBeenCalledTimes(1);
    expect(migrateMocks.clients[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('migrates a pglite:// URL with the :memory: alias', async () => {
    process.env['DATABASE_URL'] = 'pglite://:memory:';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../src/migrate');

    await expect(main()).resolves.toBeUndefined();

    expect(migrateMocks.openPglite).toHaveBeenCalledWith('pglite://:memory:');
  });

  it('migrates an on-disk pglite path', async () => {
    const dir = join('/tmp', 'docket-migrate-test');
    process.env['DATABASE_URL'] = `pglite://${dir}`;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../src/migrate');

    await expect(main()).resolves.toBeUndefined();

    expect(migrateMocks.openPglite).toHaveBeenCalledWith(`pglite://${dir}`);
    expect(migrateMocks.clients[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('prefers DATABASE_URL_UNPOOLED over DATABASE_URL', async () => {
    process.env['DATABASE_URL_UNPOOLED'] = 'pglite://:memory:';
    process.env['DATABASE_URL'] = 'pglite://memory';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../src/migrate');

    await expect(main()).resolves.toBeUndefined();

    expect(migrateMocks.openPglite).toHaveBeenCalledWith('pglite://:memory:');
  });

  it('throws when neither DATABASE_URL nor DATABASE_URL_UNPOOLED is set', async () => {
    const { main } = await import('../src/migrate');

    await expect(main()).rejects.toThrow(/DATABASE_URL is not set/);
    expect(migrateMocks.openPglite).not.toHaveBeenCalled();
  });
});
