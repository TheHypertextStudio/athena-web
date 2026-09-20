/** Proves the day-cadence migration preserves existing cycle windows and weekly meaning. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
const cadenceMigration = '0138_real_scourge.sql';
const nativeStartMigration = '0139_lowly_kinsey_walden.sql';
const clients: PGlite[] = [];

function migrationsBefore(name: string): string {
  return readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql') && file < name)
    .sort()
    .map((file) => readFileSync(resolve(migrationsFolder, file), 'utf8'))
    .join('\n');
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('cycle cadence migration', () => {
  it('converts weeks to days without changing existing cycle boundaries', async () => {
    const client = new PGlite('memory://');
    clients.push(client);
    await client.exec(migrationsBefore(cadenceMigration));
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "team" (
        "id", "organization_id", "name", "key", "cycle_cadence_weeks"
      ) VALUES ('team1', 'org1', 'Platform', 'PLAT', 10);
      INSERT INTO "cycle" (
        "id", "organization_id", "team_id", "number", "starts_at", "ends_at"
      ) VALUES
        ('cycle1', 'org1', 'team1', 1, '2026-09-14', '2026-11-22'),
        ('cycle2', 'org1', 'team1', 2, '2026-11-23', '2027-01-31');
    `);
    const before = await client.query<{ id: string; startsAt: string; endsAt: string }>(`
      SELECT "id", "starts_at"::text AS "startsAt", "ends_at"::text AS "endsAt"
      FROM "cycle" ORDER BY "id"
    `);

    await client.exec(readFileSync(resolve(migrationsFolder, cadenceMigration), 'utf8'));

    const cadence = await client.query<{ days: number; anchor: string; revision: number }>(`
      SELECT "cycle_cadence_days" AS "days", "cycle_cadence_anchor"::text AS "anchor",
        "cycle_cadence_revision" AS "revision" FROM "team" WHERE "id" = 'team1'
    `);
    const after = await client.query<{ id: string; startsAt: string; endsAt: string }>(`
      SELECT "id", "starts_at"::text AS "startsAt", "ends_at"::text AS "endsAt"
      FROM "cycle" ORDER BY "id"
    `);
    await client.exec(`
      INSERT INTO "team" ("id", "organization_id", "name", "key")
      VALUES ('team2', 'org1', 'Default cadence', 'DEF');
    `);
    const defaults = await client.query<{ days: number }>(`
      SELECT "cycle_cadence_days" AS "days" FROM "team" WHERE "id" = 'team2'
    `);

    expect(cadence.rows).toEqual([{ days: 70, anchor: '2024-01-01', revision: 1 }]);
    expect(after.rows).toEqual(before.rows);
    expect(defaults.rows).toEqual([{ days: 7 }]);
  });

  it('enforces one native cycle for each team and start date', async () => {
    const client = new PGlite('memory://');
    clients.push(client);
    await client.exec(migrationsBefore(cadenceMigration));
    await client.exec(readFileSync(resolve(migrationsFolder, cadenceMigration), 'utf8'));
    await client.exec(readFileSync(resolve(migrationsFolder, nativeStartMigration), 'utf8'));
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "team" ("id", "organization_id", "name", "key")
      VALUES ('team1', 'org1', 'Platform', 'PLAT');
      INSERT INTO "cycle" (
        "id", "organization_id", "team_id", "number", "starts_at", "ends_at"
      ) VALUES ('cycle1', 'org1', 'team1', 1, '2026-09-14', '2026-09-20');
    `);

    await expect(
      client.exec(`
        INSERT INTO "cycle" (
          "id", "organization_id", "team_id", "number", "starts_at", "ends_at"
        ) VALUES ('cycle2', 'org1', 'team1', 2, '2026-09-14', '2026-09-21');
      `),
    ).rejects.toThrow(/cycle_native_start_uq/);
  });
});
