import type { task } from '@docket/db';
import type * as DbModule from '@docket/db';
import { seedBaseOrg, seedStatuses } from '../support/routes-harness';

type StatusIdLookup = Awaited<ReturnType<typeof seedStatuses>>;

/** Create visible assigned task data for daily proposal route tests. */
export async function assignedWork(
  schema: typeof DbModule,
  userId: string,
  title: string,
  estimateMinutes: number | null,
): Promise<{
  task: typeof task.$inferSelect;
  actorId: string;
  orgId: string;
  teamId: string;
  statusId: StatusIdLookup;
}> {
  const { orgId, teamId } = await seedBaseOrg(schema.db, schema);
  const [actor] = await schema.db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Planner', userId })
    .returning();
  if (!actor) throw new Error('Expected seeded actor');
  const statusId = await seedStatuses(schema.db, schema, orgId);
  const [row] = await schema.db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      teamId,
      title,
      assigneeId: actor.id,
      state: 'todo',
      statusId: statusId('task', 'todo'),
      visibility: 'public',
      estimate: 100,
      estimateMinutes,
      dueDate: new Date('2027-01-05T17:00:00.000Z'),
    })
    .returning();
  if (!row) throw new Error('Expected seeded task');
  return { task: row, actorId: actor.id, orgId, teamId, statusId };
}
