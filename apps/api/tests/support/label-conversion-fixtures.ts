/** Actual labels/work/publication fixture shared by embedded and PostgreSQL acceptance. */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { one, seedTaskAccessOrg, seedUserWithHub } from './routes-harness';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
export async function labelConversionFixture(schema: typeof DbModule) {
  const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const userId = await seedUserWithHub(schema.db, schema, 'Conversion reviewer');
  await schema.db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, f.humanActorId));
  const caller = { orgId: f.orgId, actorId: f.humanActorId, userId };
  const group = one(
    await schema.db
      .insert(schema.labelGroup)
      .values({ organizationId: f.orgId, name: 'Work kind' })
      .returning(),
  );
  const standIn = one(
    await schema.db
      .insert(schema.label)
      .values({ organizationId: f.orgId, groupId: group.id, name: 'Event', color: 'blue' })
      .returning(),
  );
  const unrelated = one(
    await schema.db
      .insert(schema.label)
      .values({ organizationId: f.orgId, name: 'Urgent', color: 'red' })
      .returning(),
  );
  const work = one(
    await schema.db
      .insert(schema.task)
      .values({
        organizationId: f.orgId,
        teamId: f.teamId,
        title: 'Community dinner',
        description: 'Hand-written notes',
        dueDate: new Date('2027-04-10T00:00:00Z'),
        state: 'todo',
        statusId: f.statusId('task', 'todo'),
      })
      .returning(),
  );
  await schema.db.insert(schema.taskLabel).values(
    [standIn, unrelated].map((label) => ({
      organizationId: f.orgId,
      taskId: work.id,
      labelId: label.id,
    })),
  );
  const draft = await createWorkTemplate(
    caller,
    WorkTemplateCreate.parse({
      targetType: 'task',
      scope: 'personal',
      definition: {
        name: 'Event',
        payload: {
          targetType: 'task',
          description: 'Starting document that must not replace notes',
        },
      },
    }),
  );
  const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  const choices = {
    labelGroupId: group.id,
    items: [
      {
        kind: 'task' as const,
        id: work.id,
        removeLabelIds: [standIn.id],
        workTypeId: published.id,
        workTypeVersionId: published.latestPublishedVersionId,
      },
    ],
  };
  return { ...f, caller, group, standIn, unrelated, work, published, choices };
}
