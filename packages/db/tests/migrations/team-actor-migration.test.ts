/**
 * Proves the team↔actor backfill in `0068`, which is the only reason that migration is hand-edited.
 *
 * @remarks
 * The check constraint it ends with cannot be added to a database that still holds the orphan
 * `actor{kind:'team'}` rows org creation has been writing since the beginning. Three cases have to
 * come out right before the constraint is legal, and only a replay against a real database can show
 * that: an orphan whose name still matches its team gets linked, an orphan whose name matches
 * nothing gets dropped, and a team with no actor at all gets one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
const migrationName = '0073_safe_boomer.sql';
const clients: PGlite[] = [];

/**
 * Concatenate the migration chain, in file order.
 *
 * @param through - The last migration to include, or to stop before when `exclusive` is set.
 * @param exclusive - Stop *before* `through`, yielding the state a database is in on the way in.
 */
function migrationSql(through: string, exclusive = false): string {
  return readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql') && (exclusive ? file < through : file <= through))
    .sort()
    .map((file) => readFileSync(resolve(migrationsFolder, file), 'utf8'))
    .join('\n');
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('team actor migration', () => {
  it('links, prunes and creates team actors so the 1:1 check constraint can hold', async () => {
    const client = new PGlite('memory://');
    clients.push(client);

    await client.exec(migrationSql(migrationName, true));

    // One org, two teams. `Alpha` gets the orphan actor org creation would have written; `Beta`
    // gets none, standing in for every team created after that code path stopped writing one.
    // `Ghost` is an orphan whose team was renamed out from under it — nothing to link to.
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "team" ("id", "organization_id", "name", "key")
        VALUES ('teamA', 'org1', 'Alpha', 'ALP'), ('teamB', 'org1', 'Beta', 'BET');
      INSERT INTO "actor" ("id", "organization_id", "kind", "display_name")
        VALUES ('actorA', 'org1', 'team', 'Alpha'), ('actorGhost', 'org1', 'team', 'Ghost');
      INSERT INTO "actor" ("id", "organization_id", "kind", "display_name")
        VALUES ('actorHuman', 'org1', 'human', 'A Person');
    `);

    await client.exec(readFileSync(resolve(migrationsFolder, migrationName), 'utf8'));

    const actors = await client.query<{ id: string; team_id: string | null; kind: string }>(`
      SELECT "id", "team_id", "kind" FROM "actor" ORDER BY "id"
    `);
    expect(actors.rows).toEqual([
      // The pre-existing row is reused rather than replaced, so any incidental reference survives.
      { id: 'actorA', team_id: 'teamA', kind: 'team' },
      { id: 'actorHuman', team_id: null, kind: 'human' },
      // Beta's actor is new and reuses the team's own id.
      { id: 'teamB', team_id: 'teamB', kind: 'team' },
    ]);
  });

  it('makes a team actor without a team unrepresentable', async () => {
    const client = new PGlite('memory://');
    clients.push(client);

    await client.exec(migrationSql(migrationName));
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
    `);

    await expect(
      client.exec(`
        INSERT INTO "actor" ("id", "organization_id", "kind", "display_name")
          VALUES ('bad', 'org1', 'team', 'No Team');
      `),
    ).rejects.toThrow(/actor_team_kind_check/);
  });

  it('makes a non-team actor carrying a team unrepresentable', async () => {
    const client = new PGlite('memory://');
    clients.push(client);

    await client.exec(migrationSql(migrationName));
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "team" ("id", "organization_id", "name", "key")
        VALUES ('teamA', 'org1', 'Alpha', 'ALP');
    `);

    await expect(
      client.exec(`
        INSERT INTO "actor" ("id", "organization_id", "kind", "display_name", "team_id")
          VALUES ('bad', 'org1', 'human', 'A Person', 'teamA');
      `),
    ).rejects.toThrow(/actor_team_kind_check/);
  });
});
