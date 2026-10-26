import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { ProcessDefinitionId } from '@docket/work/ids';
import { TeamId } from '@docket/identity-access/ids';
import type { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import type hubRouter from '../../src/routes/hub';
import { materializeOccurrence } from '../../src/lib/recurrence/materialize';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import { createRecurrenceSeries } from '../../src/lib/recurrence/series';
import { grantProcessAuthor } from '../recurrence/work-template-legacy-fixture';
import { assertDefined } from '@docket/test-utils';
import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedBaseOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let hub!: typeof hubRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  hub = (await import('../../src/routes/hub')).default;
});

describe('Today completion advances retained process work', () => {
  it('advances completion-driven process work when Today completes a generated task', async () => {
    const userId = await seedUserWithHub(db, schema, 'Today process author');
    const { id: hubId } = one(
      await db.select({ id: schema.hub.id }).from(schema.hub).where(eq(schema.hub.userId, userId)),
    );
    const org = await seedBaseOrg(db, schema);
    const ownerActorId = await addMember(db, schema, org.orgId, userId);
    await db
      .update(schema.role)
      .set({ capabilities: ['contribute'] })
      .where(and(eq(schema.role.organizationId, org.orgId), eq(schema.role.key, 'member')));
    await grantProcessAuthor(db, org.orgId, ownerActorId);
    const definition: ProcessDefinitionCreate = {
      name: 'Today process advancement',
      creationMode: 'when_ready',
      milestones: [],
      tasks: [
        {
          key: 'first',
          title: 'Complete from Today',
          teamId: TeamId.parse(org.teamId),
          priority: 'none',
          labelIds: [],
          timing: { kind: 'on_trigger' },
        },
        {
          key: 'follow-up',
          title: 'Released follow-up',
          teamId: TeamId.parse(org.teamId),
          priority: 'none',
          labelIds: [],
          timing: { kind: 'after_step_completion', stepKey: 'first', offsetDays: 1 },
        },
      ],
      dependencies: [{ blockingStepKey: 'first', blockedStepKey: 'follow-up' }],
    };
    const authored = await createPublishedProcessDefinition(db, {
      organizationId: org.orgId,
      actorId: ownerActorId,
      definition,
    });
    const series = await createRecurrenceSeries(db, {
      organizationId: org.orgId,
      actorId: ownerActorId,
      series: {
        processDefinitionId: ProcessDefinitionId.parse(authored.definitionId),
        name: definition.name,
        trigger: {
          kind: 'calendar',
          schedule: {
            kind: 'daily',
            interval: 1,
            startDate: '2026-08-05',
            timezone: 'America/Los_Angeles',
            end: { kind: 'after_count', count: 2 },
          },
          missedPolicy: 'skip',
          materialization: { horizonDays: 2, minimumOccurrences: 1 },
        },
      },
    });
    const [revision] = await db
      .select({ id: schema.recurrenceSeriesRevision.id })
      .from(schema.recurrenceSeriesRevision)
      .where(eq(schema.recurrenceSeriesRevision.seriesId, series.id));
    const occurrence = await materializeOccurrence(db, {
      organizationId: org.orgId,
      actorId: ownerActorId,
      seriesId: series.id,
      seriesRevisionId: assertDefined(revision).id,
      scheduledFor: '2026-08-05',
    });
    const [planItem] = await db
      .insert(schema.dailyPlanItem)
      .values({
        hubId,
        refOrganizationId: org.orgId,
        refTaskId: assertDefined(occurrence.taskIdsByKey['first']),
        date: '2026-08-05',
      })
      .returning({ id: schema.dailyPlanItem.id });

    const app = appWithSession(hub, fakeSession(userId));
    const response = await app.request(`/today/items/${assertDefined(planItem).id}/complete`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);

    // Only the completed run's follow-up is released; the second scheduled run is still waiting.
    const released = await db
      .select({ title: schema.task.title })
      .from(schema.task)
      .where(
        and(eq(schema.task.organizationId, org.orgId), eq(schema.task.title, 'Released follow-up')),
      );
    expect(released).toHaveLength(1);
  });
});
