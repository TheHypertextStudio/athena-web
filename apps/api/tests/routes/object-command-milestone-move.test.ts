import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type objectCommandsRouter from '../../src/routes/object-commands';
import { appWithActor, getDb, seedProject, seedTaskAccessOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let objectCommands!: typeof objectCommandsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  objectCommands = (await import('../../src/routes/object-commands')).default;
});

async function send(
  app: ReturnType<typeof appWithActor>,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': String(body['commandId']) },
    body: JSON.stringify(body),
  });
}

async function seedMilestoneMove() {
  const seeded = await seedTaskAccessOrg(db, schema, 'manage');
  const firstProject = await seedProject(db, schema, seeded.statusId, {
    organizationId: seeded.orgId,
    teamId: seeded.teamId,
    createdBy: seeded.humanActorId,
    name: 'First project',
  });
  const secondProject = await seedProject(db, schema, seeded.statusId, {
    organizationId: seeded.orgId,
    teamId: seeded.teamId,
    createdBy: seeded.humanActorId,
    name: 'Second project',
  });
  const [milestone] = await db
    .insert(schema.milestone)
    .values({ organizationId: seeded.orgId, projectId: firstProject.id, name: 'Beta' })
    .returning({ id: schema.milestone.id });
  if (!milestone) throw new Error('milestone fixture insert failed');
  const taskRows = await db
    .insert(schema.task)
    .values(
      ['Milestoned task', 'Unscheduled task'].map((title, index) => ({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        projectId: firstProject.id,
        milestoneId: index === 0 ? milestone.id : null,
        title,
        state: 'backlog' as const,
        statusId: seeded.statusId('task', 'backlog'),
      })),
    )
    .returning({ id: schema.task.id });
  const [milestoned, plain] = taskRows;
  if (!milestoned || !plain) throw new Error('task fixture insert failed');
  const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
  return { app, firstProject, secondProject, milestone, milestoned, plain };
}

async function taskRow(id: string) {
  const [row] = await db.select().from(schema.task).where(eq(schema.task.id, id));
  return row;
}

describe('object commands moving milestoned Tasks between Projects', () => {
  it('clears the milestone, and undo and redo carry it with the project', async () => {
    const { app, firstProject, secondProject, milestone, milestoned } = await seedMilestoneMove();
    const moved = await send(app, {
      commandId: 'move-milestoned',
      objectKind: 'task',
      objectIds: [milestoned.id],
      operation: { type: 'replace_property', property: 'projectId', value: secondProject.id },
    });
    expect(moved.status).toBe(200);
    const { receipt } = (await moved.json()) as { receipt: Record<string, unknown> };
    expect(receipt['entries']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'projectId',
          before: firstProject.id,
          after: secondProject.id,
        }),
        expect.objectContaining({ property: 'milestoneId', before: milestone.id, after: null }),
      ]),
    );
    expect(await taskRow(milestoned.id)).toMatchObject({
      projectId: secondProject.id,
      milestoneId: null,
    });

    const undone = await send(app, { commandId: 'undo-move', direction: 'undo', receipt });
    expect(await undone.json()).toMatchObject({ appliedIds: [milestoned.id], deniedIds: [] });
    expect(await taskRow(milestoned.id)).toMatchObject({
      projectId: firstProject.id,
      milestoneId: milestone.id,
    });

    const redone = await send(app, { commandId: 'redo-move', direction: 'redo', receipt });
    expect(await redone.json()).toMatchObject({ appliedIds: [milestoned.id], deniedIds: [] });
    expect(await taskRow(milestoned.id)).toMatchObject({
      projectId: secondProject.id,
      milestoneId: null,
    });
  });

  it('clears only the milestoned Task in a bulk move and undoes each one exactly', async () => {
    const { app, firstProject, secondProject, milestone, milestoned, plain } =
      await seedMilestoneMove();
    const moved = await send(app, {
      commandId: 'bulk-move',
      objectKind: 'task',
      objectIds: [milestoned.id, plain.id],
      operation: { type: 'replace_property', property: 'projectId', value: secondProject.id },
    });
    expect(moved.status).toBe(200);
    const { receipt } = (await moved.json()) as {
      receipt: { entries: { objectId: string; property: string }[] };
    };
    expect(
      receipt.entries.filter((entry) => entry.property === 'milestoneId').map((e) => e.objectId),
    ).toEqual([milestoned.id]);
    expect(await taskRow(plain.id)).toMatchObject({
      projectId: secondProject.id,
      milestoneId: null,
    });

    const undone = await send(app, { commandId: 'undo-bulk', direction: 'undo', receipt });
    expect(undone.status).toBe(200);
    expect(await taskRow(milestoned.id)).toMatchObject({
      projectId: firstProject.id,
      milestoneId: milestone.id,
    });
    expect(await taskRow(plain.id)).toMatchObject({
      projectId: firstProject.id,
      milestoneId: null,
    });
  });

  it('keeps the milestone when the Task already sits in the target Project', async () => {
    const { app, firstProject, milestone, milestoned } = await seedMilestoneMove();
    const moved = await send(app, {
      commandId: 'same-project',
      objectKind: 'task',
      objectIds: [milestoned.id],
      operation: { type: 'replace_property', property: 'projectId', value: firstProject.id },
    });
    expect(moved.status).toBe(200);
    expect(await taskRow(milestoned.id)).toMatchObject({
      projectId: firstProject.id,
      milestoneId: milestone.id,
    });
  });

  it('denies an undo whose milestone was deleted instead of failing the command', async () => {
    const { app, secondProject, milestone, milestoned } = await seedMilestoneMove();
    const moved = await send(app, {
      commandId: 'move-then-delete',
      objectKind: 'task',
      objectIds: [milestoned.id],
      operation: { type: 'replace_property', property: 'projectId', value: secondProject.id },
    });
    const { receipt } = (await moved.json()) as { receipt: Record<string, unknown> };
    await db.delete(schema.milestone).where(eq(schema.milestone.id, milestone.id));

    const undone = await send(app, { commandId: 'undo-deleted', direction: 'undo', receipt });
    expect(undone.status).toBe(200);
    expect(await undone.json()).toMatchObject({ appliedIds: [], deniedIds: [milestoned.id] });
    expect(await taskRow(milestoned.id)).toMatchObject({
      projectId: secondProject.id,
      milestoneId: null,
    });
  });
});
