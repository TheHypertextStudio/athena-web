import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import {
  createWorkSchedule,
  reviseWorkSchedule,
} from '../../src/lib/recurrence/schedule-authoring';
import { materializeOccurrence } from '../../src/lib/recurrence/materialize';
import schedules from '../../src/routes/work-schedules';
import { scheduleRouteFixture } from '../routes/work-schedule-fixture';
import { getDb, one } from '../support/routes-harness';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
describe('canonical provider occurrence adapter', () => {
  it('moves the original applied revision across future boundaries without renaming or replacing work', async () => {
    const f = await scheduleRouteFixture(schema, schedules);
    const saved = await createWorkSchedule(schema.db, {
      ...f.command,
      organizationId: f.orgId,
      actorId: f.humanActorId,
    });
    const original = {
      organizationId: f.orgId,
      seriesId: saved.series.id,
      seriesRevisionId: saved.revision.id,
      scheduledFor: '2026-10-08',
      externalOccurrenceKey: 'calendar-provider:community-dinner',
    };
    const first = await materializeOccurrence(schema.db, original);
    const changed = await reviseWorkSchedule(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: saved.series.id,
      expectedRevisionId: saved.revision.id,
      effectiveFrom: '2099-11-01',
      name: f.command.name,
      trigger: f.command.trigger,
      document: WorkScheduleDraft.parse({
        ...f.command.document,
        titlePattern: '{month} Gathering',
      }),
    });
    const moved = await materializeOccurrence(schema.db, {
      ...original,
      seriesRevisionId: changed.revision.id,
      scheduledFor: '2099-11-20',
    });
    expect(moved).toEqual(first);
    const occurrence = one(
      await schema.db
        .select()
        .from(schema.processOccurrence)
        .where(eq(schema.processOccurrence.id, first.occurrenceId)),
    );
    expect(occurrence).toMatchObject({
      seriesRevisionId: saved.revision.id,
      scheduledFor: '2099-11-20',
      originalScheduledFor: '2026-10-08',
      externalOccurrenceKey: original.externalOccurrenceKey,
    });
    const project = one(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    );
    expect(project).toMatchObject({ name: 'October Dinner', targetDate: new Date('2099-11-20') });
    const task = one(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    );
    expect(task.dueDate).toEqual(new Date('2099-11-13'));
  });
});
