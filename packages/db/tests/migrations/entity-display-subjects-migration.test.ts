import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
const clients: PGlite[] = [];

function migrationSql(files: readonly string[]): string {
  return files.map((file) => readFileSync(resolve(migrationsFolder, file), 'utf8')).join('\n');
}

function allMigrationFiles(): readonly string[] {
  return readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

afterAll(async () => {
  await Promise.all(clients.map(async (client) => client.close()));
});

describe('entity display subject migration', () => {
  it('preserves legacy display rows while widening the accepted subjects', async () => {
    const client = new PGlite('memory://');
    clients.push(client);
    const files = allMigrationFiles();
    const migrationIndex = files.indexOf('0110_fair_night_thrasher.sql');
    expect(migrationIndex).toBeGreaterThan(0);
    await client.exec(migrationSql(files.slice(0, migrationIndex)));
    await client.exec(`
      INSERT INTO "user" ("id", "name", "email")
        VALUES ('user1', 'Viewer', 'viewer@example.com');
      INSERT INTO "organization" ("id", "name", "slug")
        VALUES ('org1', 'Workspace', 'workspace');
      INSERT INTO "entity_display" (
        "id", "organization_id", "subject_type", "subject_id", "icon_key", "color_key"
      ) VALUES
        ('legacy-initiative', 'org1', 'initiative', 'initiative-1', 'target', 'neutral'),
        ('legacy-project', 'org1', 'project', 'project-1', 'folder', 'primary'),
        ('legacy-team', 'org1', 'team', 'team-1', 'users', 'blue');
    `);

    await client.exec(migrationSql(files.slice(migrationIndex, migrationIndex + 1)));

    const stored = await client.query<{ id: string; subject_type: string }>(
      'SELECT "id", "subject_type" FROM "entity_display" ORDER BY "id"',
    );
    expect(stored.rows).toEqual([
      { id: 'legacy-initiative', subject_type: 'initiative' },
      { id: 'legacy-project', subject_type: 'project' },
      { id: 'legacy-team', subject_type: 'team' },
    ]);
  });

  it('accepts a display row for every native work entity', async () => {
    const client = new PGlite('memory://');
    clients.push(client);
    await client.exec(migrationSql(allMigrationFiles()));
    await client.exec(`
      INSERT INTO "user" ("id", "name", "email")
        VALUES ('user1', 'Viewer', 'viewer@example.com');
      INSERT INTO "organization" ("id", "name", "slug")
        VALUES ('org1', 'Workspace', 'workspace');
    `);

    for (const subjectType of [
      'initiative',
      'program',
      'project',
      'task',
      'cycle',
      'milestone',
      'team',
      'label',
      'workStatus',
    ]) {
      await client.exec(`
        INSERT INTO "entity_display" (
          "id", "organization_id", "subject_type", "subject_id", "icon_key", "color_key"
        ) VALUES (
          'display-${subjectType}', 'org1', '${subjectType}', '${subjectType}-1', 'flag', 'neutral'
        );
      `);
    }

    const stored = await client.query<{ subject_type: string }>(
      'SELECT "subject_type" FROM "entity_display" ORDER BY "subject_type"',
    );
    expect(stored.rows.map((row) => row.subject_type)).toEqual([
      'cycle',
      'initiative',
      'label',
      'milestone',
      'program',
      'project',
      'task',
      'team',
      'workStatus',
    ]);
  });

  it('adds the Project-to-Initiative lookup index used by the detail aggregate', async () => {
    const client = new PGlite('memory://');
    clients.push(client);
    await client.exec(migrationSql(allMigrationFiles()));

    const indexes = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'initiative_project'",
    );

    expect(indexes.rows.map((index) => index.indexname)).toContain(
      'initiative_project_project_idx',
    );
  });
});
