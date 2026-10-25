import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../src/error';
import {
  createWorkSchedule,
  prepareWorkScheduleRevisionCommand,
  reviseWorkSchedule,
  type CreateWorkScheduleCommand,
} from '../../src/lib/recurrence/schedule-authoring';
import {
  executeScheduleOccurrence,
  retryScheduleOccurrence,
} from '../../src/lib/recurrence/schedule-runtime';
import * as creation from '../../src/lib/work-creation/service';
import type {
  WorkCreationBatchResult,
  WorkCreationSelectedRow,
} from '../../src/lib/work-creation/types';
import type { InsertedWork } from '../../src/lib/work-creation/writers';
import schedulesRouter from '../../src/routes/work-schedules';
import { scheduleRouteFixture } from '../routes/work-schedule-fixture';
import { getDb } from '../support/routes-harness';
import { nativeOccurrence, nativeRuntimeFixture } from './work-schedule-native-runtime-fixture';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => vi.restoreAllMocks());

const UNKNOWN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
type RuntimeFixture = Awaited<ReturnType<typeof nativeRuntimeFixture>>;
type CalendarTrigger = Extract<CreateWorkScheduleCommand['trigger'], { kind: 'calendar' }>;

async function authoring() {
  const base = await scheduleRouteFixture(schema, schedulesRouter);
  const { trigger } = base.command;
  if (trigger.kind !== 'calendar') throw new Error('Expected a calendar fixture trigger');
  const command: CreateWorkScheduleCommand = {
    ...base.command,
    organizationId: base.orgId,
    actorId: base.humanActorId,
  };
  return { base, command, trigger };
}
function calendar(
  trigger: CalendarTrigger,
  schedule: Partial<CalendarTrigger['schedule']>,
): CalendarTrigger {
  return { ...trigger, schedule: { ...trigger.schedule, ...schedule } } as CalendarTrigger;
}
/** Execute another provider run whose creation step resolves with the supplied receipt. */
async function runWithReceipt(f: RuntimeFixture, key: string, receipt: WorkCreationBatchResult) {
  vi.spyOn(creation, 'createWorkBatchInTransaction').mockResolvedValueOnce(receipt);
  return executeScheduleOccurrence(schema.db, {
    ...f.input,
    scheduledFor: '2026-11-12',
    externalOccurrenceKey: key,
  });
}
function receipt(
  root: InsertedWork,
  selected: readonly WorkCreationSelectedRow[] | undefined,
): WorkCreationBatchResult {
  return {
    rootsByKey: new Map([['root', root]]),
    resolvedManifestsByKey: new Map(),
    selectedWorkByKey: new Map(selected ? [['root', selected]] : []),
    created: [],
    changeSetId: null,
    effects: [],
  };
}

describe('schedule authoring refusals', () => {
  it('refuses a calendar cadence saved in a different timezone from the draft', async () => {
    const { command, trigger } = await authoring();
    await expect(
      createWorkSchedule(schema.db, {
        ...command,
        trigger: calendar(trigger, { timezone: 'UTC' }),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a cadence that ends before its first future run', async () => {
    const { command, trigger } = await authoring();
    await expect(
      createWorkSchedule(schema.db, {
        ...command,
        trigger: calendar(trigger, { end: { kind: 'on_date', date: '2026-10-05' } }),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('stores each selected weekday of a weekly cadence with its revision', async () => {
    const { command, trigger } = await authoring();
    const created = await createWorkSchedule(schema.db, {
      ...command,
      trigger: {
        ...trigger,
        schedule: {
          kind: 'weekly',
          interval: 1,
          startDate: '2026-10-01',
          timezone: trigger.schedule.timezone,
          end: { kind: 'never' },
          weekdays: ['monday', 'thursday'],
        },
      },
    });
    const weekdays = await schema.db
      .select()
      .from(schema.recurrenceSeriesWeekday)
      .where(eq(schema.recurrenceSeriesWeekday.seriesRevisionId, created.revision.id));
    expect(weekdays).toHaveLength(2);
  });

  it('refuses a revision preview against a stale or unconverted latest revision', async () => {
    const f = await nativeRuntimeFixture(schema);
    const document = f.schedule.revision.scheduleDraft;
    if (!document) throw new Error('Missing saved draft');
    const input = {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: f.schedule.series.id,
      expectedRevisionId: f.schedule.revision.id,
      document,
      runDate: '2026-12-10',
      effectiveFrom: '2026-12-01',
    };
    await schema.db.transaction(async (tx) => {
      await expect(
        prepareWorkScheduleRevisionCommand(tx, { ...input, expectedRevisionId: UNKNOWN_ID }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
    await schema.db.execute(sql`set session_replication_role = replica`);
    try {
      await schema.db
        .update(schema.recurrenceSeriesRevision)
        .set({ scheduleDraft: null })
        .where(eq(schema.recurrenceSeriesRevision.id, f.schedule.revision.id));
    } finally {
      await schema.db.execute(sql`set session_replication_role = origin`);
    }
    await schema.db.transaction(async (tx) => {
      await expect(prepareWorkScheduleRevisionCommand(tx, input)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });
  });

  it('refuses to revise an archived schedule', async () => {
    const f = await nativeRuntimeFixture(schema);
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ archivedAt: new Date() })
      .where(eq(schema.recurrenceSeries.id, f.schedule.series.id));
    const document = f.schedule.revision.scheduleDraft;
    if (!document) throw new Error('Missing saved draft');
    await expect(
      reviseWorkSchedule(schema.db, {
        organizationId: f.orgId,
        actorId: f.humanActorId,
        seriesId: f.schedule.series.id,
        expectedRevisionId: f.schedule.revision.id,
        effectiveFrom: '2026-12-01',
        trigger: { kind: 'manual' },
        document,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('schedule run refusals', () => {
  it('keeps a moved provider run original date through failure and retry', async () => {
    const f = await nativeRuntimeFixture(schema);
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
      new Error('Injected work failure'),
    );
    const failed = await executeScheduleOccurrence(schema.db, {
      ...f.input,
      scheduledFor: '2026-11-13',
      originalScheduledFor: '2026-11-12',
      externalOccurrenceKey: 'provider-event-moved',
    });
    expect(failed.status).toBe('failed');
    const retried = await retryScheduleOccurrence(schema.db, {
      organizationId: f.orgId,
      occurrenceId: failed.occurrenceId,
    });
    expect(retried.status).toBe('materialized');
    expect(await nativeOccurrence(schema, failed.occurrenceId)).toMatchObject({
      scheduledFor: '2026-11-13',
      originalScheduledFor: '2026-11-12',
    });
  });

  it('refuses a provider identity already reserved under another revision', async () => {
    const f = await nativeRuntimeFixture(schema);
    const document = f.schedule.revision.scheduleDraft;
    if (!document) throw new Error('Missing saved draft');
    const revised = await reviseWorkSchedule(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: f.schedule.series.id,
      expectedRevisionId: f.schedule.revision.id,
      effectiveFrom: '2026-12-01',
      trigger: { kind: 'manual' },
      document,
    });
    await expect(
      executeScheduleOccurrence(schema.db, { ...f.input, seriesRevisionId: revised.revision.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('records an invalid run when created work reports an unschedulable root or child kind', async () => {
    const f = await nativeRuntimeFixture(schema);
    const initiativeRoot = await runWithReceipt(
      f,
      'provider-initiative-root',
      receipt({ kind: 'initiative', id: UNKNOWN_ID } as InsertedWork, undefined),
    );
    expect(initiativeRoot).toMatchObject({ status: 'failed', failureCode: 'schedule_invalid' });
    const initiativeChild = await runWithReceipt(
      f,
      'provider-initiative-child',
      receipt({ kind: 'project', id: f.root.id } as InsertedWork, [
        { kind: 'initiative', id: UNKNOWN_ID, path: ['book_venue'] },
      ]),
    );
    expect(initiativeChild).toMatchObject({ status: 'failed', failureCode: 'schedule_invalid' });
  });

  it('rolls back a run whose created receipt omits its selected work and closure', async () => {
    const f = await nativeRuntimeFixture(schema);
    const run = await runWithReceipt(
      f,
      'provider-bare-root',
      receipt({ kind: 'project', id: f.root.id } as InsertedWork, undefined),
    );
    expect(run).toMatchObject({
      status: 'failed',
      failureCode: 'schedule_execution_failed',
      roots: [],
    });
    expect(await nativeOccurrence(schema, run.occurrenceId)).toMatchObject({
      blueprintAppliedAt: null,
      blueprintRootRefs: null,
    });
  });
});
