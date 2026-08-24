/** Proves the Initiative Project-count removal repairs every persisted work-view state. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
const migrationName = '0097_remove_initiative_project_count.sql';
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

describe('Initiative Project-count removal migration', () => {
  it('repairs saved, default, and personal Initiative view definitions without resetting them', async () => {
    const migrationPath = resolve(migrationsFolder, migrationName);
    expect(existsSync(migrationPath), `${migrationName} must exist`).toBe(true);

    const client = new PGlite('memory://');
    clients.push(client);
    await client.exec(migrationSql(migrationName, true));
    await client.exec(`
      INSERT INTO "user" ("id", "name", "email")
        VALUES ('user1', 'Viewer', 'viewer@example.com');
      INSERT INTO "organization" ("id", "name", "slug")
        VALUES ('org1', 'Workspace', 'workspace');
      INSERT INTO "actor" ("id", "organization_id", "kind", "display_name", "user_id")
        VALUES ('actor1', 'org1', 'human', 'Viewer', 'user1');
      INSERT INTO "hub" ("id", "user_id", "preferences") VALUES (
        'hub1',
        'user1',
        '{
          "theme":"dark",
          "viewState":[
            {
              "instanceKey":"product:initiative:organization:org1",
              "target":"initiative",
              "arrangement":{"orderBy":[
                {"field":"activeProjectCount","direction":"desc"},
                {"field":"name","direction":"asc"}
              ]},
              "presentation":{"properties":["health","activeProjectCount"]},
              "collapsedGroups":["active"],
              "hiddenBoardColumns":[],
              "favoriteViewIds":[]
            },
            {
              "instanceKey":"product:program:organization:org1",
              "target":"program",
              "presentation":{"properties":["projectCount"]},
              "collapsedGroups":[],
              "hiddenBoardColumns":[],
              "favoriteViewIds":[]
            }
          ]
        }'::jsonb
      );
      INSERT INTO "saved_view" (
        "id", "organization_id", "name", "target", "context", "position", "definition"
      ) VALUES (
        'view1',
        'org1',
        'Initiative health',
        'initiative',
        '{"kind":"organization"}'::jsonb,
        'a0',
        '{
          "version":2,
          "target":"initiative",
          "filter":{"kind":"all","children":[
            {"kind":"predicate","field":"name","operator":"contains","operand":"Transit"},
            {"kind":"any","children":[
              {"kind":"predicate","field":"activeProjectCount","operator":"greaterThan","operand":0},
              {"kind":"predicate","field":"health","operator":"is","operand":"at_risk"}
            ]},
            {"kind":"not","child":
              {"kind":"predicate","field":"activeProjectCount","operator":"is","operand":0}
            }
          ]},
          "arrangement":{"groupBy":null,"subGroupBy":null,"orderBy":[
            {"field":"activeProjectCount","direction":"desc"},
            {"field":"name","direction":"asc"}
          ]},
          "presentation":{"layout":"list","properties":["health","activeProjectCount"],"density":"compact","showEmptyGroups":false}
        }'::jsonb
      );
      INSERT INTO "organization_work_view_default" (
        "organization_id", "target", "definition", "updated_by"
      ) VALUES (
        'org1',
        'initiative',
        '{
          "version":2,
          "target":"initiative",
          "filter":{"kind":"predicate","field":"activeProjectCount","operator":"greaterThan","operand":0},
          "arrangement":{"groupBy":null,"subGroupBy":null,"orderBy":[{"field":"activeProjectCount","direction":"desc"}]},
          "presentation":{"layout":"list","properties":["status","activeProjectCount"],"density":"compact","showEmptyGroups":false}
        }'::jsonb,
        'actor1'
      );
    `);

    await client.exec(readFileSync(migrationPath, 'utf8'));

    const saved = await client.query<{ definition: Record<string, unknown> }>(
      `SELECT "definition" FROM "saved_view" WHERE "id" = 'view1'`,
    );
    expect(saved.rows[0]?.definition).toEqual({
      version: 2,
      target: 'initiative',
      filter: {
        kind: 'all',
        children: [
          { kind: 'predicate', field: 'name', operator: 'contains', operand: 'Transit' },
          { kind: 'predicate', field: 'health', operator: 'is', operand: 'at_risk' },
        ],
      },
      arrangement: {
        groupBy: null,
        subGroupBy: null,
        orderBy: [{ field: 'name', direction: 'asc' }],
      },
      presentation: {
        layout: 'list',
        properties: ['health'],
        density: 'compact',
        showEmptyGroups: false,
      },
    });

    const defaults = await client.query<{ definition: Record<string, unknown> }>(
      `SELECT "definition" FROM "organization_work_view_default" WHERE "target" = 'initiative'`,
    );
    expect(defaults.rows[0]?.definition).toMatchObject({
      filter: null,
      arrangement: { orderBy: [] },
      presentation: { properties: ['status'] },
    });

    const hubs = await client.query<{ preferences: Record<string, unknown> }>(
      `SELECT "preferences" FROM "hub" WHERE "id" = 'hub1'`,
    );
    expect(hubs.rows[0]?.preferences).toEqual({
      theme: 'dark',
      viewState: [
        {
          instanceKey: 'product:initiative:organization:org1',
          target: 'initiative',
          arrangement: { orderBy: [{ field: 'name', direction: 'asc' }] },
          presentation: { properties: ['health'] },
          collapsedGroups: ['active'],
          hiddenBoardColumns: [],
          favoriteViewIds: [],
        },
        {
          instanceKey: 'product:program:organization:org1',
          target: 'program',
          presentation: { properties: ['projectCount'] },
          collapsedGroups: [],
          hiddenBoardColumns: [],
          favoriteViewIds: [],
        },
      ],
    });
  });
});
