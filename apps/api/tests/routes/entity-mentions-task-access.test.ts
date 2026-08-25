/** Visibility tests for task description references. */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { entityMentionRoutes } from '../../src/routes/entity-mentions';
import {
  appWithActor,
  fakeSession,
  getDb,
  one,
  seedTaskAccessOrg,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('task mention access', () => {
  it('does not reveal references from a private task to a caller without task access', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const statuses = await schema.seedWorkspaceStatuses(db, orgId);
    const todo = statuses.get(schema.statusLookupKey('task', 'todo'));
    if (!todo) throw new Error('missing task todo status');
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Private task references',
          description: '[Sensitive material](https://private.example.test/reference)',
          state: 'todo',
          statusId: todo,
          visibility: 'private',
          createdBy: humanActorId,
        })
        .returning({ id: schema.task.id }),
    ).id;
    const resourceId = one(
      await db
        .insert(schema.externalResource)
        .values({
          organizationId: orgId,
          createdBy: humanActorId,
          provider: 'web',
          canonicalKey: 'web:https://private.example.test/reference',
          canonicalUrl: 'https://private.example.test/reference',
          resourceType: 'page',
        })
        .returning({ id: schema.externalResource.id }),
    ).id;
    await db.insert(schema.mention).values({
      organizationId: orgId,
      createdBy: humanActorId,
      subjectType: 'task',
      subjectId: taskId,
      field: 'description',
      position: 0,
      targetKind: 'external',
      externalResourceId: resourceId,
      label: 'Sensitive material',
    });
    const reader = appWithActor(
      entityMentionRoutes('task', 'Tasks'),
      orgId,
      [],
      'actor_without_task_access',
      fakeSession('user_without_task_access'),
    );

    expect((await reader.request(`/${taskId}/mentions`)).status).toBe(404);
  });
});
