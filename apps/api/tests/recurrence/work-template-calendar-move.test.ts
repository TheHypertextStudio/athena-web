import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { getDb, one } from '../support/routes-harness';
import { retainedFixture } from './work-template-adapter-fixture';
import { materializeOccurrence } from '../../src/lib/recurrence/materialize';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function fixture() {
  const f = await retainedFixture(
    schema,
    false,
    undefined,
    WorkTemplateDefinition.parse({
      name: 'Calendar report',
      payload: { targetType: 'task' },
      blueprint: {
        dependencies: [],
        steps: [
          {
            key: 'followup',
            parentStepKey: null,
            sort: 0,
            template: null,
            optional: { enabled: false, selectedByDefault: true },
            kind: 'task',
            fields: { title: 'Follow up' },
            teamRule: 'parent_team',
            actorRule: 'unassigned',
            cycleRule: 'none',
            dates: {
              dueDate: {
                kind: 'anchor',
                anchor: { kind: 'parent' },
                offset: { days: 1, unit: 'calendar' },
              },
            },
          },
        ],
      },
    }),
  );
  await schema.db
    .update(schema.processOccurrence)
    .set({ externalOccurrenceKey: 'calendar-report' })
    .where(eq(schema.processOccurrence.id, f.occurrence.id));
  const command = {
    organizationId: f.orgId,
    seriesId: f.series.id,
    seriesRevisionId: f.seriesRevision.id,
    actorId: f.humanActorId,
    externalOccurrenceKey: 'calendar-report',
    scheduledFor: '2026-10-14',
  };
  const result = await materializeOccurrence(schema.db, command);
  const rootId = result.taskIdsByKey['report'];
  if (!rootId) throw new Error('Missing root');
  const child = one(
    await schema.db.select().from(schema.task).where(eq(schema.task.parentTaskId, rootId)),
  );
  return { ...f, command, result, rootId, child };
}
async function task(id: string) {
  return one(await schema.db.select().from(schema.task).where(eq(schema.task.id, id)));
}
describe('checked calendar occurrence move', () => {
  it('keeps occurrence/work identities and reflows managed root and generated descendant dates once', async () => {
    const f = await fixture();
    expect((await task(f.rootId)).dueDate?.toISOString().slice(0, 10)).toBe('2026-10-14');
    expect(f.child.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-15');
    const moved = await materializeOccurrence(schema.db, {
      ...f.command,
      scheduledFor: '2026-10-21',
    });
    expect(moved).toEqual(f.result);
    expect((await task(f.rootId)).dueDate?.toISOString().slice(0, 10)).toBe('2026-10-21');
    expect((await task(f.child.id)).dueDate?.toISOString().slice(0, 10)).toBe('2026-10-22');
    const occurrence = one(
      await schema.db
        .select()
        .from(schema.processOccurrence)
        .where(eq(schema.processOccurrence.id, f.occurrence.id)),
    );
    expect(occurrence).toMatchObject({
      scheduledFor: '2026-10-21',
      originalScheduledFor: '2026-10-14',
    });
    const beforeRetry = await task(f.rootId);
    await materializeOccurrence(schema.db, { ...f.command, scheduledFor: '2026-10-21' });
    expect(await task(f.rootId)).toEqual(beforeRetry);
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toHaveLength(2);
  });
  it('preserves an explicitly cleared root anchor on provider movement', async () => {
    const f = await fixture();
    await schema.db.update(schema.task).set({ dueDate: null }).where(eq(schema.task.id, f.rootId));
    await materializeOccurrence(schema.db, { ...f.command, scheduledFor: '2026-10-21' });
    expect((await task(f.rootId)).dueDate).toBeNull();
    expect((await task(f.child.id)).dueDate).toEqual(f.child.dueDate);
  });
});
