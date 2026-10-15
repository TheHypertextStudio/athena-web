/** Persistence coverage for work without optional authorization ancestors. */
import { resolve } from 'node:path';
import { ancestorChain, type ResourceKind, type ResourceRef } from '@docket/db/identity-access';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';

import { fullSchema, type Database } from '../src/client';
import { organization, project, task, team } from '../src/schema';
import { seedWorkspaceStatuses, statusLookupKey, type SeededStatuses } from '../src/seed-statuses';

let client: PGlite | undefined;
let db: Database;
let orgId: string;
let teamId: string;
let statuses: SeededStatuses;

function target(kind: ResourceKind, id: string): ResourceRef {
  return { kind, id, orgId };
}

function statusId(kind: 'task' | 'project', key: string): string {
  return assertDefined(statuses.get(statusLookupKey(kind, key)));
}

beforeAll(async () => {
  client = new PGlite('memory://');
  const migrated = drizzle(client, { schema: fullSchema });
  await migrate(migrated, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
  db = migrated;
  orgId = assertDefined(
    (
      await db
        .insert(organization)
        .values({ name: 'Standalone work', slug: 'standalone-ancestry' })
        .returning({ id: organization.id })
    )[0],
  ).id;
  statuses = await seedWorkspaceStatuses(db, orgId);
  teamId = assertDefined(
    (
      await db
        .insert(team)
        .values({ organizationId: orgId, name: 'Standalone team', key: 'STAND' })
        .returning({ id: team.id })
    )[0],
  ).id;
});

afterAll(async () => {
  await client?.close();
});

describe('standalone work ancestry', () => {
  it('keeps a task within its team and organization', async () => {
    const [row] = await db
      .insert(task)
      .values({
        organizationId: orgId,
        title: 'Standalone task',
        teamId,
        state: 'todo',
        statusId: statusId('task', 'todo'),
      })
      .returning({ id: task.id });
    const id = assertDefined(row).id;
    await expect(ancestorChain(target('task', id), db)).resolves.toEqual([
      target('task', id),
      target('team', teamId),
      target('organization', orgId),
    ]);
  });

  it('keeps a project within its organization', async () => {
    const [row] = await db
      .insert(project)
      .values({
        organizationId: orgId,
        name: 'Standalone project',
        statusId: statusId('project', 'planned'),
      })
      .returning({ id: project.id });
    const id = assertDefined(row).id;
    await expect(ancestorChain(target('project', id), db)).resolves.toEqual([
      target('project', id),
      target('organization', orgId),
    ]);
  });
});
