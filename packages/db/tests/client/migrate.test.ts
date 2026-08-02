import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the offline migration runner.
 *
 * The real PGlite migration path is smoke-tested in `db.test.ts`; these tests keep the
 * runner contract fast by mocking the driver and migrator boundaries.
 */

const migrateMocks = vi.hoisted(() => ({
  clients: [] as { close: ReturnType<typeof vi.fn>; exec: ReturnType<typeof vi.fn> }[],
  drizzlePglite: vi.fn((client: unknown) => ({ client })),
  migratePglite: vi.fn(async () => undefined),
  openPglite: vi.fn(),
}));

vi.mock('../../src/client', () => ({ openPglite: migrateMocks.openPglite }));
vi.mock('drizzle-orm/pglite', () => ({ drizzle: migrateMocks.drizzlePglite }));
vi.mock('drizzle-orm/pglite/migrator', () => ({ migrate: migrateMocks.migratePglite }));

function resetDriverMocks(): void {
  migrateMocks.clients.length = 0;
  migrateMocks.openPglite.mockReset();
  migrateMocks.drizzlePglite.mockClear();
  migrateMocks.migratePglite.mockClear();
  migrateMocks.migratePglite.mockResolvedValue(undefined);
  migrateMocks.openPglite.mockImplementation(() => {
    const client = {
      close: vi.fn(async () => undefined),
      exec: vi.fn(async () => undefined),
    };
    migrateMocks.clients.push(client);
    return client;
  });
}

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', undefined);
  vi.stubEnv('DATABASE_URL_UNPOOLED', undefined);
  vi.resetModules();
  resetDriverMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('migrate main()', () => {
  it('migrates a fresh in-memory PGlite URL', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite://memory');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../../src/migrate');

    await expect(main()).resolves.toBeUndefined();

    expect(migrateMocks.openPglite).toHaveBeenCalledWith('pglite://memory');
    expect(migrateMocks.migratePglite).toHaveBeenCalledWith(expect.anything(), {
      migrationsFolder: expect.stringContaining('packages/db/drizzle'),
    });
    expect(migrateMocks.clients[0]!.exec).toHaveBeenCalledWith(
      expect.stringContaining("ADD VALUE IF NOT EXISTS 'pending'"),
    );
    expect(migrateMocks.clients[0]!.close).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('migrations applied (pglite)'));
  });

  it('migrates a bare pglite: URL using the same driver path', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite:');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../../src/migrate');

    await expect(main()).resolves.toBeUndefined();

    expect(migrateMocks.openPglite).toHaveBeenCalledWith('pglite:');
    expect(migrateMocks.migratePglite).toHaveBeenCalledTimes(1);
    expect(migrateMocks.clients[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('migrates a pglite:// URL with the :memory: alias', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite://:memory:');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../../src/migrate');

    await expect(main()).resolves.toBeUndefined();

    expect(migrateMocks.openPglite).toHaveBeenCalledWith('pglite://:memory:');
  });

  it('migrates an on-disk pglite path', async () => {
    const dir = join('/tmp', 'docket-migrate-test');
    vi.stubEnv('DATABASE_URL', `pglite://${dir}`);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../../src/migrate');

    await expect(main()).resolves.toBeUndefined();

    expect(migrateMocks.openPglite).toHaveBeenCalledWith(`pglite://${dir}`);
    expect(migrateMocks.clients[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('prefers DATABASE_URL_UNPOOLED over DATABASE_URL', async () => {
    vi.stubEnv('DATABASE_URL_UNPOOLED', 'pglite://:memory:');
    vi.stubEnv('DATABASE_URL', 'pglite://memory');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { main } = await import('../../src/migrate');

    await expect(main()).resolves.toBeUndefined();

    expect(migrateMocks.openPglite).toHaveBeenCalledWith('pglite://:memory:');
  });

  it('refuses to migrate PGlite while the app reads Postgres, and vice versa', async () => {
    // The real-world failure: `.env.local` left DATABASE_URL_UNPOOLED pointing at the Docker
    // Postgres while DATABASE_URL stayed on embedded PGlite, so every `pnpm dev` migrated
    // Postgres and the PGlite database the app actually read silently fell behind.
    vi.stubEnv('DATABASE_URL_UNPOOLED', 'postgres://docket:docket@localhost:5433/docket');
    vi.stubEnv('DATABASE_URL', 'pglite://.data/docket');
    const { main } = await import('../../src/migrate');

    await expect(main()).rejects.toThrow(/different database backends/);
    expect(migrateMocks.openPglite).not.toHaveBeenCalled();
  });

  it('allows a pooled app URL with an unpooled DDL endpoint on the same backend', async () => {
    // Production legitimately pairs a pooled `neon:` app URL with an unpooled `postgres:` one —
    // the same database via a different endpoint, which the guard must not reject.
    vi.stubEnv('DATABASE_URL_UNPOOLED', 'postgres://user:pw@db.example.invalid/docket');
    vi.stubEnv('DATABASE_URL', 'neon://user:pw@pooler.example.invalid/docket');
    const { main } = await import('../../src/migrate');

    // It gets far enough to actually dial the (unresolvable) host, which is the proof that the
    // backend guard did not fire — the assertion is on *which* failure comes back, not on success.
    await expect(main()).rejects.toThrow(/ENOTFOUND|getaddrinfo|ECONNREFUSED/);
  });

  it('throws when neither DATABASE_URL nor DATABASE_URL_UNPOOLED is set', async () => {
    const { main } = await import('../../src/migrate');

    await expect(main()).rejects.toThrow(/DATABASE_URL is not set/);
    expect(migrateMocks.openPglite).not.toHaveBeenCalled();
  });
});
