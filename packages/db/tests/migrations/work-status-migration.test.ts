/**
 * Proves the workspace-status backfill in `0087`, which is why that migration is hand-edited.
 *
 * @remarks
 * The migration ends by making `status_id` NOT NULL on four tables and binding each to
 * `work_status` through a composite foreign key. Every existing row has to land on a real status
 * before those constraints are legal, and only a replay against a real database can show it. The
 * cases that matter are the ones the jsonb column allowed for years: teams that agree, a team that
 * customized its workflow, a workflow missing a way to finish, duplicate keys, a malformed array,
 * a workspace with no teams at all, and tasks pointing at a key nobody kept.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
const migrationName = '0087_sour_post.sql';
const clients: PGlite[] = [];

/** Concatenate the migration chain, in file order, optionally stopping before `through`. */
function migrationSql(through: string, exclusive = false): string {
  return readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql') && (exclusive ? file < through : file <= through))
    .sort()
    .map((file) => readFileSync(resolve(migrationsFolder, file), 'utf8'))
    .join('\n');
}

/** Bring a fresh database up to the state this migration runs against. */
async function upToMigration(): Promise<PGlite> {
  const client = new PGlite('memory://');
  clients.push(client);
  await client.exec(migrationSql(migrationName, true));
  return client;
}

/** Apply the migration under test. */
async function applyMigration(client: PGlite): Promise<void> {
  await client.exec(readFileSync(resolve(migrationsFolder, migrationName), 'utf8'));
}

/** The default five, as they were stored in `team.workflow_states`. */
const DEFAULT_STATES = JSON.stringify([
  { key: 'backlog', name: 'Backlog', type: 'backlog', position: 0 },
  { key: 'todo', name: 'Todo', type: 'unstarted', position: 1 },
  { key: 'in_progress', name: 'In Progress', type: 'started', position: 2 },
  { key: 'done', name: 'Done', type: 'completed', position: 3 },
  { key: 'canceled', name: 'Canceled', type: 'canceled', position: 4 },
]);

/** Rows of one resolved status set, in board order. */
async function statusSet(
  client: PGlite,
  orgId: string,
  entityType: string,
  teamId: string | null = null,
): Promise<
  { key: string; name: string; category: string; position: number; is_default: boolean }[]
> {
  const result = await client.query<{
    key: string;
    name: string;
    category: string;
    position: number;
    is_default: boolean;
  }>(
    `SELECT "key", "name", "category", "position", "is_default" FROM "work_status"
       WHERE "organization_id" = $1 AND "entity_type" = $2
         AND "team_id" IS NOT DISTINCT FROM $3
       ORDER BY "category", "position"`,
    [orgId, entityType, teamId],
  );
  return result.rows;
}

/** How many rows of a table still lack a status. */
async function unresolved(client: PGlite, table: string): Promise<number> {
  const result = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "${table}" WHERE "status_id" IS NULL`,
  );
  return result.rows[0]?.n ?? 0;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('work status migration', () => {
  it('gives a workspace whose teams agree one shared set and no forks', async () => {
    const client = await upToMigration();
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "team" ("id", "organization_id", "name", "key", "workflow_states")
        VALUES ('teamA', 'org1', 'Alpha', 'ALP', '${DEFAULT_STATES}'::jsonb),
               ('teamB', 'org1', 'Beta', 'BET', '${DEFAULT_STATES}'::jsonb);
    `);

    await applyMigration(client);

    const forks = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "work_status" WHERE "team_id" IS NOT NULL`,
    );
    expect(forks.rows[0]?.n).toBe(0);
    expect((await statusSet(client, 'org1', 'task')).map((s) => s.key)).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'done',
      'canceled',
    ]);
  });

  it('keeps a customized team workflow by forking it, leaving the others on the workspace set', async () => {
    const client = await upToMigration();
    const custom = JSON.stringify([
      { key: 'icebox', name: 'Icebox', type: 'backlog', position: 0 },
      { key: 'doing', name: 'Doing', type: 'started', position: 1 },
      { key: 'shipped', name: 'Shipped', type: 'completed', position: 2 },
      { key: 'dropped', name: 'Dropped', type: 'canceled', position: 3 },
    ]);
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "team" ("id", "organization_id", "name", "key", "workflow_states")
        VALUES ('teamA', 'org1', 'Alpha', 'ALP', '${DEFAULT_STATES}'::jsonb),
               ('teamB', 'org1', 'Beta', 'BET', '${DEFAULT_STATES}'::jsonb),
               ('teamC', 'org1', 'Gamma', 'GAM', '${custom}'::jsonb);
    `);

    await applyMigration(client);

    expect((await statusSet(client, 'org1', 'task')).map((s) => s.key)).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'done',
      'canceled',
    ]);
    expect((await statusSet(client, 'org1', 'task', 'teamC')).map((s) => s.key)).toEqual([
      'icebox',
      'doing',
      'shipped',
      'dropped',
    ]);
    const forkedTeams = await client.query<{ team_id: string }>(
      `SELECT DISTINCT "team_id" FROM "work_status" WHERE "team_id" IS NOT NULL`,
    );
    expect(forkedTeams.rows.map((r) => r.team_id)).toEqual(['teamC']);
  });

  it('gives a workflow with no way to finish or abandon one of each', async () => {
    const client = await upToMigration();
    const partial = JSON.stringify([
      { key: 'open', name: 'Open', type: 'backlog', position: 0 },
      { key: 'doing', name: 'Doing', type: 'started', position: 1 },
    ]);
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "team" ("id", "organization_id", "name", "key", "workflow_states")
        VALUES ('teamA', 'org1', 'Alpha', 'ALP', '${partial}'::jsonb);
    `);

    await applyMigration(client);

    const set = await statusSet(client, 'org1', 'task');
    expect(set.filter((s) => s.category === 'completed')).toHaveLength(1);
    expect(set.filter((s) => s.category === 'canceled')).toHaveLength(1);
    expect(set.map((s) => s.key)).toContain('open');
  });

  it('collapses duplicate keys, which the jsonb column never prevented', async () => {
    const client = await upToMigration();
    const dupes = JSON.stringify([
      { key: 'todo', name: 'Todo', type: 'unstarted', position: 0 },
      { key: 'todo', name: 'Todo again', type: 'started', position: 1 },
      { key: 'done', name: 'Done', type: 'completed', position: 2 },
      { key: 'nope', name: 'Nope', type: 'canceled', position: 3 },
    ]);
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "team" ("id", "organization_id", "name", "key", "workflow_states")
        VALUES ('teamA', 'org1', 'Alpha', 'ALP', '${dupes}'::jsonb);
    `);

    await applyMigration(client);

    const set = await statusSet(client, 'org1', 'task');
    expect(set.filter((s) => s.key === 'todo')).toHaveLength(1);
  });

  it('falls back to the canonical set for a workspace with no usable workflow anywhere', async () => {
    const client = await upToMigration();
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug")
        VALUES ('org1', 'No Teams', 'no-teams'), ('org2', 'Junk', 'junk');
      INSERT INTO "team" ("id", "organization_id", "name", "key", "workflow_states")
        VALUES ('teamJ', 'org2', 'Junk', 'JNK', '{}'::jsonb);
    `);

    await applyMigration(client);

    for (const orgId of ['org1', 'org2']) {
      expect((await statusSet(client, orgId, 'task')).map((s) => s.key)).toEqual([
        'backlog',
        'todo',
        'in_progress',
        'done',
        'canceled',
      ]);
    }
  });

  it('seeds every container set, letting a Program both complete and be archived', async () => {
    const client = await upToMigration();
    await client.exec(
      `INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');`,
    );

    await applyMigration(client);

    const programs = await statusSet(client, 'org1', 'program');
    expect(programs.filter((s) => s.category === 'completed').map((s) => s.key)).toEqual([
      'completed',
    ]);
    expect(programs.filter((s) => s.category === 'canceled').map((s) => s.key)).toEqual([
      'archived',
    ]);
    // Active and Paused are both live work, so they share a category and are ordered within it.
    expect(programs.filter((s) => s.category === 'started').map((s) => s.key)).toEqual([
      'active',
      'paused',
    ]);
    expect(programs.filter((s) => s.is_default).map((s) => s.key)).toEqual(['active']);

    for (const entityType of ['project', 'initiative']) {
      const set = await statusSet(client, 'org1', entityType);
      expect(set.filter((s) => s.is_default)).toHaveLength(1);
      expect(set.some((s) => s.category === 'completed')).toBe(true);
      expect(set.some((s) => s.category === 'canceled')).toBe(true);
    }
  });

  it('resolves every existing row, repairing tasks whose key nobody kept', async () => {
    const client = await upToMigration();
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "team" ("id", "organization_id", "name", "key", "workflow_states")
        VALUES ('teamA', 'org1', 'Alpha', 'ALP', '${DEFAULT_STATES}'::jsonb);
      INSERT INTO "program" ("id", "organization_id", "name", "status")
        VALUES ('prog1', 'org1', 'Support', 'paused');
      INSERT INTO "project" ("id", "organization_id", "name", "status")
        VALUES ('proj1', 'org1', 'Launch', 'active');
      INSERT INTO "initiative" ("id", "organization_id", "name", "status")
        VALUES ('init1', 'org1', 'Grow', 'proposed');
      INSERT INTO "task" ("id", "organization_id", "team_id", "title", "state")
        VALUES ('taskLive', 'org1', 'teamA', 'Known key', 'in_progress');
      INSERT INTO "task" ("id", "organization_id", "team_id", "title", "state", "completed_at")
        VALUES ('taskGoneDone', 'org1', 'teamA', 'Orphan, finished', 'shipped', now());
      INSERT INTO "task" ("id", "organization_id", "team_id", "title", "state", "canceled_at")
        VALUES ('taskGoneCancel', 'org1', 'teamA', 'Orphan, abandoned', 'dropped', now());
      INSERT INTO "task" ("id", "organization_id", "team_id", "title", "state")
        VALUES ('taskGoneOpen', 'org1', 'teamA', 'Orphan, open', 'limbo');
    `);

    await applyMigration(client);

    for (const table of ['task', 'project', 'program', 'initiative']) {
      expect(await unresolved(client, table)).toBe(0);
    }

    const tasks = await client.query<{ id: string; state: string; category: string }>(
      `SELECT t."id", t."state", ws."category" FROM "task" t
         JOIN "work_status" ws ON ws."id" = t."status_id" ORDER BY t."id"`,
    );
    const byId = new Map(tasks.rows.map((r) => [r.id, r]));
    // A known key is left exactly as it was.
    expect(byId.get('taskLive')?.state).toBe('in_progress');
    // An orphan is repaired by what the row actually is, and its key rewritten to match.
    expect(byId.get('taskGoneDone')?.category).toBe('completed');
    expect(byId.get('taskGoneCancel')?.category).toBe('canceled');
    expect(byId.get('taskGoneOpen')?.category).toBe('backlog');
    for (const row of tasks.rows) {
      expect(row.state).not.toBe('shipped');
      expect(row.state).not.toBe('limbo');
    }
  });

  it('keeps every container status key byte-identical, so nothing on the wire moves', async () => {
    const client = await upToMigration();
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
      INSERT INTO "program" ("id", "organization_id", "name", "status")
        VALUES ('p1', 'org1', 'A', 'active'), ('p2', 'org1', 'B', 'paused'),
               ('p3', 'org1', 'C', 'archived');
      INSERT INTO "project" ("id", "organization_id", "name", "status")
        VALUES ('r1', 'org1', 'A', 'planned'), ('r2', 'org1', 'B', 'completed');
      INSERT INTO "initiative" ("id", "organization_id", "name", "status")
        VALUES ('i1', 'org1', 'A', 'proposed'), ('i2', 'org1', 'B', 'canceled');
    `);

    await applyMigration(client);

    const programs = await client.query<{ id: string; status: string }>(
      `SELECT "id", "status" FROM "program" ORDER BY "id"`,
    );
    expect(programs.rows.map((r) => r.status)).toEqual(['active', 'paused', 'archived']);
    const projects = await client.query<{ status: string }>(
      `SELECT "status" FROM "project" ORDER BY "id"`,
    );
    expect(projects.rows.map((r) => r.status)).toEqual(['planned', 'completed']);
    const initiatives = await client.query<{ status: string }>(
      `SELECT "status" FROM "initiative" ORDER BY "id"`,
    );
    expect(initiatives.rows.map((r) => r.status)).toEqual(['proposed', 'canceled']);
  });

  it('mints ids the application can read back', async () => {
    const client = await upToMigration();
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug") VALUES ('org1', 'Org', 'org');
    `);

    await applyMigration(client);

    const ids = await client.query<{ id: string }>(`SELECT "id" FROM "work_status"`);
    expect(ids.rows.length).toBeGreaterThan(0);
    for (const row of ids.rows) {
      // The shape `@docket/types` validates on every read.
      expect(row.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
    expect(new Set(ids.rows.map((r) => r.id)).size).toBe(ids.rows.length);
  });

  it('keeps every workspace status inside its own workspace', async () => {
    const client = await upToMigration();
    await client.exec(`
      INSERT INTO "organization" ("id", "name", "slug")
        VALUES ('org1', 'One', 'one'), ('org2', 'Two', 'two');
    `);

    await applyMigration(client);

    const shared = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "work_status" a
         JOIN "work_status" b ON a."id" = b."id" AND a."organization_id" <> b."organization_id"`,
    );
    expect(shared.rows[0]?.n).toBe(0);
  });
});
