/** Proves the typed planning-list migration preserves legacy Project and saved-view state. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { TaskViewDefinition } from '@docket/types';
import { afterAll, describe, expect, it } from 'vitest';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
const migrationName = '0095_zippy_wolfsbane.sql';
const clients: PGlite[] = [];

function migrationSql(through: string, exclusive = false): string {
  return readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) => (exclusive ? file < through : file <= through))
    .map((file) => readFileSync(resolve(migrationsFolder, file), 'utf8'))
    .join('\n');
}

afterAll(async () => {
  await Promise.all(clients.map(async (client) => client.close()));
});

describe('typed planning-list migration', () => {
  it('backfills Project teams, stable ranks, and executable Task definitions', async () => {
    const client = new PGlite('memory://');
    clients.push(client);
    await client.exec(migrationSql(migrationName, true));
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "team" ("id", "organization_id", "name", "key")
        VALUES ('team1', 'org1', 'Core', 'CORE');
      INSERT INTO "work_status"
        ("id", "organization_id", "entity_type", "key", "name", "category", "position", "is_default")
        VALUES ('status1', 'org1', 'project', 'planned', 'Planned', 'unstarted', 0, true);
      INSERT INTO "project"
        ("id", "organization_id", "name", "team_id", "status", "status_id")
        VALUES ('project1', 'org1', 'Launch', 'team1', 'planned', 'status1');
      INSERT INTO "saved_view"
        ("id", "organization_id", "name", "filters", "grouping", "sort")
        VALUES (
          'view1',
          'org1',
          'Important work',
          '[{"field":"priority","op":"eq","value":"high"},{"field":"assigneeId","op":"eq","value":"01ARZ3NDEKTSV4RRFFQ69G5FAV"}]'::jsonb,
          '{"by":"state","subBy":"assigneeId"}'::jsonb,
          '[{"field":"dueDate","order":"asc"}]'::jsonb
        );
    `);

    await client.exec(readFileSync(resolve(migrationsFolder, migrationName), 'utf8'));

    const project = await client.query<{ priority: string }>(
      `SELECT "priority" FROM "project" WHERE "id" = 'project1'`,
    );
    expect(project.rows).toEqual([{ priority: 'none' }]);

    const teams = await client.query<{
      project_id: string;
      team_id: string;
      is_primary: boolean;
    }>(`SELECT "project_id", "team_id", "is_primary" FROM "project_team"`);
    expect(teams.rows).toEqual([{ project_id: 'project1', team_id: 'team1', is_primary: true }]);

    const orders = await client.query<{ item_id: string; rank: string }>(`
      SELECT "item_id", "rank" FROM "work_item_order"
      WHERE "target" = 'project' AND "context_id" = 'org1'
    `);
    expect(orders.rows).toEqual([{ item_id: 'project1', rank: '000000000001' }]);

    const views = await client.query<{
      filters: unknown;
      definition: {
        filter: { children: unknown[] };
        arrangement: { groupBy: string; subGroupBy: string; orderBy: unknown[] };
      };
      position: string;
    }>(`
      SELECT "filters", "definition", "position" FROM "saved_view" WHERE "id" = 'view1'
    `);
    expect(views.rows[0]).toMatchObject({
      filters: [
        { field: 'priority', op: 'eq', value: 'high' },
        {
          field: 'assigneeId',
          op: 'eq',
          value: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        },
      ],
      definition: {
        filter: {
          children: [
            { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
            {
              kind: 'predicate',
              field: 'assignee',
              operator: 'is',
              operand: { kind: 'actor', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
            },
          ],
        },
        arrangement: {
          groupBy: 'status',
          subGroupBy: 'assignee',
          orderBy: [{ field: 'dueDate', direction: 'asc' }],
        },
      },
      position: '000000000001',
    });
    expect(() => TaskViewDefinition.parse(views.rows[0]?.definition)).not.toThrow();
  });
});
