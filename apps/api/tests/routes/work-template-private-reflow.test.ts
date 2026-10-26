import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { desc, eq, sql } from 'drizzle-orm';
import { appWithActor, getDb, one, seedTaskAccessOrg } from '../support/routes-harness';
import { generatedDateOwnership } from '../support/generated-work';
import { ProcessDefinitionCreate, RecurrenceSeriesCreate } from '../../src/contracts/recurrence';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import { createRecurrenceSeries } from '../../src/lib/recurrence/series';
import { materializeOccurrence } from '../../src/lib/recurrence/materialize';
import { undoChangeSetAtomically } from '../../src/mcp/change-set';
import tasks from '../../src/routes/tasks';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
const headers = { 'content-type': 'application/json' };
async function fixture(withOffsets = false) {
  const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const source = await createPublishedProcessDefinition(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definition: ProcessDefinitionCreate.parse({
      name: 'Private completion',
      creationMode: 'all_at_once',
      tasks: [
        { key: 'first', title: 'First', teamId: f.teamId },
        {
          ...(withOffsets ? { startOffsetDays: -1, dueOffsetDays: 2 } : {}),
          key: 'second',
          title: 'Second',
          teamId: f.teamId,
          timing: { kind: 'after_step_completion', stepKey: 'first', offsetDays: 2 },
        },
      ],
    }),
  });
  const series = await createRecurrenceSeries(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    series: RecurrenceSeriesCreate.parse({
      name: 'Private completion',
      processDefinitionId: source.definitionId,
      effectiveFrom: '2026-10-14',
      trigger: { kind: 'manual' },
    }),
  });
  const revision = one(
    await schema.db
      .select()
      .from(schema.recurrenceSeriesRevision)
      .where(eq(schema.recurrenceSeriesRevision.seriesId, series.id)),
  );
  const result = await materializeOccurrence(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    seriesId: series.id,
    seriesRevisionId: revision.id,
    scheduledFor: '2026-10-14',
  });
  const first = result.taskIdsByKey['first'],
    second = result.taskIdsByKey['second'];
  if (!first || !second) throw new Error('Missing retained original tasks');
  return { ...f, first, second, app: appWithActor(tasks, f.orgId, ['manage'], f.humanActorId) };
}
async function task(id: string) {
  return one(await schema.db.select().from(schema.task).where(eq(schema.task.id, id)));
}
function state(f: Awaited<ReturnType<typeof fixture>>, state: string) {
  return f.app.request(`/${f.first}/state`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ state }),
  });
}
describe('private retained completion reflow in ordinary mutations', () => {
  it('dates a checked waiting sibling and clears it on reopen in the enclosing mutation', async () => {
    const f = await fixture();
    expect((await task(f.second)).dueDate).toBeNull();
    expect((await state(f, 'done')).status).toBe(200);
    const completed = await task(f.first),
      dependent = await task(f.second);
    const expected = new Date(completed.completedAt?.toISOString() ?? '');
    expected.setUTCDate(expected.getUTCDate() + 2);
    expect(dependent.dueDate?.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
    expect((await state(f, 'todo')).status).toBe(200);
    expect((await task(f.second)).dueDate).toBeNull();
  });
  it('pins an explicit null while waiting so completion cannot silently restore the date', async () => {
    const f = await fixture();
    expect(
      (
        await f.app.request(`/${f.second}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ dueDate: null }),
        })
      ).status,
    ).toBe(200);
    const ownership = await generatedDateOwnership(schema, f.orgId, f.second);
    expect(ownership.find((row) => row.field === 'dueDate')?.manual).toBe(true);
    expect((await state(f, 'done')).status).toBe(200);
    expect((await task(f.second)).dueDate).toBeNull();
  });
  it('undoes private completion ownership so a later completion remains managed', async () => {
    const f = await fixture();
    expect((await state(f, 'done')).status).toBe(200);
    const receipt = one(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId))
        .orderBy(desc(schema.changeSet.id))
        .limit(1),
    );
    const undo = await undoChangeSetAtomically(f.orgId, receipt.id);
    expect(undo.outcomes.every((item) => item.reverted)).toBe(true);
    expect((await task(f.first)).completedAt).toBeNull();
    expect((await task(f.second)).dueDate).toBeNull();
    const owner = one(
      (await generatedDateOwnership(schema, f.orgId, f.second)).filter(
        (row) => row.field === 'dueDate',
      ),
    );
    expect(owner.manual).toBe(false);
    expect(owner.lastDerivedDate).toBeNull();
    expect((await state(f, 'done')).status).toBe(200);
    expect((await task(f.second)).dueDate).not.toBeNull();
  });
  it('undoes a private waiting-null pin before later completion derives its date', async () => {
    const f = await fixture();
    expect(
      (
        await f.app.request(`/${f.second}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ dueDate: null }),
        })
      ).status,
    ).toBe(200);
    const receipt = one(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId))
        .orderBy(desc(schema.changeSet.id))
        .limit(1),
    );
    const undo = await undoChangeSetAtomically(f.orgId, receipt.id);
    expect(undo.outcomes.every((item) => item.reverted)).toBe(true);
    const owner = one(
      (await generatedDateOwnership(schema, f.orgId, f.second)).filter(
        (row) => row.field === 'dueDate',
      ),
    );
    expect(owner.manual).toBe(false);
    expect((await state(f, 'done')).status).toBe(200);
    expect((await task(f.second)).dueDate).not.toBeNull();
  });
  it('keeps independent private start and due ownership in one reversible receipt', async () => {
    const f = await fixture(true),
      before = await task(f.second);
    expect(
      (
        await f.app.request(`/${f.second}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ startDate: null, dueDate: null }),
        })
      ).status,
    ).toBe(200);
    const receipt = one(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId))
        .orderBy(desc(schema.changeSet.id))
        .limit(1),
    );
    const entries = await schema.db
      .select()
      .from(schema.changeSetEntry)
      .where(eq(schema.changeSetEntry.changeSetId, receipt.id));
    // Retained runs record one row per field; canonical runs record the occurrence's native ownership.
    const retained = entries.filter((entry) => entry.entityKind === 'retained_date_ownership');
    const native = entries.filter((entry) => entry.entityKind === 'native_schedule_date_ownership');
    if (retained.length) {
      expect(retained).toHaveLength(2);
      expect(new Set(retained.map((entry) => entry.entityId)).size).toBe(2);
    } else expect(native.length).toBeGreaterThan(0);
    expect(
      (await undoChangeSetAtomically(f.orgId, receipt.id)).outcomes.every((item) => item.reverted),
    ).toBe(true);
    expect((await task(f.second)).startDate).toEqual(before.startDate);
    expect((await task(f.second)).dueDate).toEqual(before.dueDate);
    const owners = await generatedDateOwnership(schema, f.orgId, f.second);
    expect(owners).toHaveLength(2);
    expect(owners.every((owner) => !owner.manual)).toBe(true);
  });
  it('rolls back completion and its receipt when the checked dependent date write fails', async () => {
    const f = await fixture();
    const before = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId));
    await schema.db.execute(
      sql`create function pg_temp.reject_private_reflow() returns trigger language plpgsql as $$ begin if NEW.title='Second' and NEW.due_date is not null then raise exception 'Private dependent write rejected'; end if;return NEW;end $$`,
    );
    await schema.db.execute(
      sql`create trigger reject_private_reflow before update on task for each row execute function pg_temp.reject_private_reflow()`,
    );
    try {
      expect((await state(f, 'done')).status).toBe(500);
      expect((await task(f.first)).completedAt).toBeNull();
      expect((await task(f.second)).dueDate).toBeNull();
      expect(
        await schema.db
          .select()
          .from(schema.changeSet)
          .where(eq(schema.changeSet.organizationId, f.orgId)),
      ).toHaveLength(before.length);
    } finally {
      await schema.db.execute(sql`drop trigger reject_private_reflow on task`);
    }
  });
});
