/**
 * `@docket/db` — the constraints that make a workspace's status sets trustworthy.
 *
 * @remarks
 * Every assertion here writes straight into the table, going around the API entirely, because the
 * work island is also written by connector reconcile, MCP tools, the email-to-task path, seed data
 * and migrations. The composite foreign key is the centrepiece: it is what lets a reader keep using
 * the `state`/`status` key it has always used while `status_id` carries the authority, and it only
 * means something if storage refuses a row where the two disagree.
 */
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fullSchema, type Database } from '../../src/client';
import { genId } from '../../src/id';
import { organization, project, task, team, workStatus } from '../../src/schema';
import {
  seedWorkspaceStatuses,
  statusLookupKey,
  type SeededStatuses,
} from '../../src/seed-statuses';
import { assertDefined } from '@docket/test-utils';

let client!: PGlite;
let db!: Database;
let orgId!: string;
let otherOrgId!: string;
let teamId!: string;
let statuses!: SeededStatuses;

/** The id of a seeded status, or a failure naming the one that was missing. */
function statusId(entityType: 'task' | 'project' | 'program' | 'initiative', key: string): string {
  const id = statuses.get(statusLookupKey(entityType, key));
  if (id === undefined) throw new Error(`no seeded ${entityType} status ${key}`);
  return id;
}

/** Assert a raw write is refused by the named constraint, rather than by anything incidental. */
async function expectRefusedBy(write: Promise<unknown>, constraint: string): Promise<void> {
  await expect(write).rejects.toMatchObject({ cause: { constraint } });
}

beforeAll(async () => {
  client = new PGlite('memory://');
  const d = drizzle(client, { schema: fullSchema });
  await migrate(d, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  db = d;

  orgId = assertDefined(
    (await db.insert(organization).values({ name: 'Statuses', slug: 'statuses' }).returning())[0],
  ).id;
  otherOrgId = assertDefined(
    (await db.insert(organization).values({ name: 'Elsewhere', slug: 'elsewhere' }).returning())[0],
  ).id;
  teamId = assertDefined(
    (
      await db.insert(team).values({ organizationId: orgId, name: 'Core', key: 'CORE' }).returning()
    )[0],
  ).id;
  statuses = await seedWorkspaceStatuses(db, orgId);
  await seedWorkspaceStatuses(db, otherOrgId);
});

afterAll(async () => {
  await client.close();
});

describe('a status key cannot drift from the status it names', () => {
  it('refuses a task whose state disagrees with its status', async () => {
    await expectRefusedBy(
      db.insert(task).values({
        organizationId: orgId,
        teamId,
        title: 'Mismatched',
        state: 'done',
        statusId: statusId('task', 'backlog'),
      }),
      'task_status_fk',
    );
  });

  it('rewrites the key on every row when a status key is rewritten', async () => {
    const created = assertDefined(
      (
        await db
          .insert(task)
          .values({
            organizationId: orgId,
            teamId,
            title: 'Follows its status',
            state: 'todo',
            statusId: statusId('task', 'todo'),
          })
          .returning()
      )[0],
    );

    await db
      .update(workStatus)
      .set({ key: 'next_up' })
      .where(eq(workStatus.id, statusId('task', 'todo')));

    const after = await db.select({ state: task.state }).from(task).where(eq(task.id, created.id));
    expect(after[0]?.state).toBe('next_up');

    await db
      .update(workStatus)
      .set({ key: 'todo' })
      .where(eq(workStatus.id, statusId('task', 'todo')));
  });

  it('refuses to delete a status that work still points at', async () => {
    await db.insert(task).values({
      organizationId: orgId,
      teamId,
      title: 'Holds a status',
      state: 'backlog',
      statusId: statusId('task', 'backlog'),
    });

    await expectRefusedBy(
      db.delete(workStatus).where(eq(workStatus.id, statusId('task', 'backlog'))),
      'task_status_fk',
    );
  });

  it('refuses a status belonging to another workspace', async () => {
    const theirs = await db
      .select({ id: workStatus.id, key: workStatus.key })
      .from(workStatus)
      .where(eq(workStatus.organizationId, otherOrgId));
    const theirTask = theirs.find((s) => s.key === 'backlog');

    await expectRefusedBy(
      db.insert(task).values({
        organizationId: orgId,
        teamId,
        title: 'Borrowed',
        state: 'backlog',
        statusId: theirTask?.id ?? '',
      }),
      'task_status_fk',
    );
  });

  it('holds a project to the same rule', async () => {
    await expectRefusedBy(
      db.insert(project).values({
        organizationId: orgId,
        name: 'Mismatched',
        status: 'completed',
        statusId: statusId('project', 'planned'),
      }),
      'project_status_fk',
    );
  });
});

describe('a status set stays well-formed', () => {
  it('refuses two statuses sharing a key in the workspace set', async () => {
    await expectRefusedBy(
      db.insert(workStatus).values({
        organizationId: orgId,
        entityType: 'task',
        key: 'backlog',
        name: 'Backlog again',
        category: 'backlog',
        position: 9,
      }),
      'work_status_ws_key_uq',
    );
  });

  it('lets a forked team reuse a key the workspace set already holds', async () => {
    const row = await db
      .insert(workStatus)
      .values({
        organizationId: orgId,
        teamId,
        entityType: 'task',
        key: 'backlog',
        name: 'Backlog',
        category: 'backlog',
        position: 0,
      })
      .returning();
    expect(row[0]?.teamId).toBe(teamId);
    await db.delete(workStatus).where(eq(workStatus.id, assertDefined(row[0]).id));
  });

  it('refuses a second default in one set', async () => {
    await expectRefusedBy(
      db.insert(workStatus).values({
        organizationId: orgId,
        entityType: 'project',
        key: 'also_default',
        name: 'Also default',
        category: 'unstarted',
        position: 5,
        isDefault: true,
      }),
      'work_status_ws_default_uq',
    );
  });

  it('refuses a team-owned status for a kind of work that is not team-scoped', async () => {
    await expectRefusedBy(
      db.insert(workStatus).values({
        organizationId: orgId,
        teamId,
        entityType: 'project',
        key: 'team_project',
        name: 'Team project status',
        category: 'started',
        position: 0,
      }),
      'work_status_team_scope',
    );
  });

  it('refuses archiving a status, which would hide it while its work kept pointing at it', async () => {
    await expectRefusedBy(
      db
        .update(workStatus)
        .set({ archivedAt: new Date() })
        .where(eq(workStatus.id, statusId('task', 'todo'))),
      'work_status_never_archived',
    );
  });

  it('refuses a blank name, a blank key, and a negative position', async () => {
    const base = {
      id: genId(),
      organizationId: orgId,
      entityType: 'task' as const,
      key: 'valid_key',
      name: 'Valid',
      category: 'started' as const,
      position: 0,
    };
    await expectRefusedBy(
      db.insert(workStatus).values({ ...base, id: genId(), name: '  ' }),
      'work_status_name_not_blank',
    );
    await expectRefusedBy(
      db.insert(workStatus).values({ ...base, id: genId(), key: ' ' }),
      'work_status_key_not_blank',
    );
    await expectRefusedBy(
      db.insert(workStatus).values({ ...base, id: genId(), key: 'neg', position: -1 }),
      'work_status_position_nonneg',
    );
  });
});

describe('seeding a workspace', () => {
  it('leaves an already-seeded workspace exactly as it was', async () => {
    const before = await db
      .select({ id: workStatus.id })
      .from(workStatus)
      .where(eq(workStatus.organizationId, orgId));

    const again = await seedWorkspaceStatuses(db, orgId);

    const after = await db
      .select({ id: workStatus.id })
      .from(workStatus)
      .where(eq(workStatus.organizationId, orgId));
    expect(after).toHaveLength(before.length);
    expect(again.get(statusLookupKey('task', 'backlog'))).toBe(statusId('task', 'backlog'));
  });
});
