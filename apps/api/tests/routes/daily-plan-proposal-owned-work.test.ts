import { beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import type dailyPlanRouter from '../../src/routes/daily-plan';
import {
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

let schema: typeof DbModule;
let router: typeof dailyPlanRouter;
beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/daily-plan')).default;
});

async function createUnassignedTask(userId: string, title: string) {
  const { orgId, teamId } = await seedBaseOrg(schema.db, schema);
  const [actor] = await schema.db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Planner', userId })
    .returning();
  if (!actor) throw new Error('Expected created actor');
  const statusId = await seedStatuses(schema.db, schema, orgId);
  const [task] = await schema.db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      teamId,
      createdBy: actor.id,
      assigneeId: null,
      title,
      state: 'todo',
      statusId: statusId('task', 'todo'),
      visibility: 'public',
      estimateMinutes: 60,
    })
    .returning();
  if (!task) throw new Error('Expected created task');
  return task;
}

async function proposal(userId: string) {
  const response = await appWithSession(router, fakeSession(userId)).request(
    '/day/2027-01-05/proposal',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  );

  expect(response.status).toBe(200);
  return (await response.json()) as {
    tasks: { taskId: string; title: string; reason: string }[];
    draft: {
      tasks: { taskId: string; selectionSource: string }[];
      sessions: { allocations: { taskId: string }[] }[];
    };
  };
}

it('automatically schedules unfinished tasks created by the caller even when unassigned', async () => {
  const userId = await seedUserWithHub(schema.db, schema, 'ProposalCreatedWork');
  const task = await createUnassignedTask(userId, 'A task I created');
  const result = await proposal(userId);

  expect(result.tasks).toContainEqual(
    expect.objectContaining({
      taskId: task.id,
      title: 'A task I created',
      reason: 'Existing backlog work',
    }),
  );
  expect(result.draft.tasks).toContainEqual(
    expect.objectContaining({ taskId: task.id, selectionSource: 'suggested' }),
  );
  expect(result.draft.sessions.flatMap((session) => session.allocations)).toContainEqual(
    expect.objectContaining({ taskId: task.id }),
  );
});

it('does not suggest completed tasks created by the caller', async () => {
  const userId = await seedUserWithHub(schema.db, schema, 'ProposalCreatedCompletedWork');
  const task = await createUnassignedTask(userId, 'Completed task I created');
  await schema.db
    .update(schema.task)
    .set({ completedAt: new Date() })
    .where(eq(schema.task.id, task.id));

  expect((await proposal(userId)).draft.tasks).toEqual([]);
});
