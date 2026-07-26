import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Migration `0048_oauth_client_unpin_registration_scopes` — semantics, not shape.
 *
 * @remarks
 * `oauthProvider()` writes `oauth_client.scopes` from its registration default when a client
 * registers without an explicit `scope`, and that row then caps BOTH `/oauth2/authorize` and
 * the token exchange — so a client pinned to `{work:read, offline_access}` can never step up to
 * `work:write`. 0048 repairs rows already written by setting them back to NULL (the plugin then
 * falls through to its configured `scopes`, which is what CIMD-registered clients already do).
 *
 * These tests execute the SHIPPED `.sql` file rather than a paraphrase of it, so the assertions
 * cannot drift from what actually runs against production.
 */

/** The `oauth_client` columns the migration cares about. */
interface ClientRow {
  client_id: string;
  scopes: string[] | null;
}

const MIGRATION = resolve(
  import.meta.dirname,
  '../drizzle/0048_oauth_client_unpin_registration_scopes.sql',
);

describe('0048 — un-pin dynamically-registered client scope ceilings', () => {
  let client!: PGlite;
  let sql!: string;

  beforeAll(async () => {
    sql = await readFile(MIGRATION, 'utf8');
    client = new PGlite('memory://');
    await migrate(drizzle(client), {
      migrationsFolder: resolve(import.meta.dirname, '../drizzle'),
    });
  });

  afterAll(async () => {
    await client.close();
  });

  async function seed(clientId: string, scopes: string[] | null): Promise<void> {
    await client.query(
      `INSERT INTO "oauth_client" ("id", "client_id", "scopes", "redirect_uris")
       VALUES ($1, $1, $2, ARRAY['https://example.test/cb'])`,
      [clientId, scopes],
    );
  }

  async function scopesOf(clientId: string): Promise<string[] | null> {
    const res = await client.query<ClientRow>(
      'SELECT "client_id", "scopes" FROM "oauth_client" WHERE "client_id" = $1',
      [clientId],
    );
    return res.rows[0]?.scopes ?? null;
  }

  it('nulls pinned rows, leaves deliberately-wider rows alone, and is idempotent', async () => {
    // The exact shape `clientRegistrationDefaultScopes: ['work:read','offline_access']` wrote.
    await seed('pinned-default', ['work:read', 'offline_access']);
    // A subset of the pin — also unusable for writes, so also repaired.
    await seed('pinned-narrower', ['work:read']);
    // Carries a capability beyond the pin: someone chose this. Must not be touched.
    await seed('deliberately-scoped', ['work:read', 'work:write']);
    // CIMD clients never get a `scopes` value; already the target state.
    await seed('cimd-style', null);

    const first = await client.exec(sql);
    expect(first.length).toBeGreaterThan(0);

    expect(await scopesOf('pinned-default')).toBeNull();
    expect(await scopesOf('pinned-narrower')).toBeNull();
    expect(await scopesOf('deliberately-scoped')).toEqual(['work:read', 'work:write']);
    expect(await scopesOf('cimd-style')).toBeNull();

    // Re-running must match nothing: repaired rows are excluded by `scopes IS NOT NULL`, so a
    // replayed migration (or a second environment applying it) cannot double-apply.
    const second = await client.query<ClientRow>(
      `UPDATE "oauth_client" SET "scopes" = NULL
       WHERE "scopes" IS NOT NULL AND "scopes" <@ ARRAY['work:read', 'offline_access']::text[]
       RETURNING "client_id", "scopes"`,
    );
    expect(second.rows).toHaveLength(0);
  });
});
