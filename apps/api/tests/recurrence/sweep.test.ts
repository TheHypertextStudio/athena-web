/** Rolling recurrence materialization, missed-work policy, and future-supersession behavior. */
import { resolve } from 'node:path';

import {
  fullSchema,
  organization,
  processInstance,
  processInstanceTask,
  processOccurrence,
  recurrenceSeriesRevision,
  seedWorkspaceStatuses,
  task,
  team,
  type Database,
} from '@docket/db';
import { ProcessDefinitionId, type ProcessDefinitionCreate, TeamId } from '@docket/types';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import {
  createRecurrenceSeries,
  editRecurrenceSeries,
  transitionRecurrenceSeries,
} from '../../src/lib/recurrence/series';
import {
  materializeRecurrenceSeriesWindow,
  sweepRecurrenceMaterialization,
} from '../../src/lib/recurrence/sweep';
import { assertDefined } from '@docket/test-utils';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let client!: PGlite;
let db!: Database;
let organizationId!: string;
let teamId!: ReturnType<typeof TeamId.parse>;

beforeAll(async () => {
  client = new PGlite('memory://');
  db = drizzle(client, { schema: fullSchema });
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  await installTestProductFixture(db);
  organizationId = assertDefined(
    (
      await db
        .insert(organization)
        .values({ name: 'Recurrence sweep', slug: `recurrence-sweep-${Date.now()}` })
        .returning()
    )[0],
  ).id;
  // Statuses come before any work: every Task this sweep materializes stores both its state key
  // and the id of the workspace status carrying it.
  await seedWorkspaceStatuses(db, organizationId);
  teamId = TeamId.parse(
    assertDefined(
      (
        await db.insert(team).values({ organizationId, name: 'Operations', key: 'OPS' }).returning()
      )[0],
    ).id,
  );
});

afterAll(async () => {
  await client.close();
});

/** Publish one ordinary task as a reusable one-step process. */
async function taskProcess(name: string): Promise<{ definitionId: string; revisionId: string }> {
  const definition: ProcessDefinitionCreate = {
    name,
    creationMode: 'all_at_once',
    milestones: [],
    tasks: [
      {
        key: 'task',
        title: name,
        teamId,
        priority: 'none',
        labelIds: [],
        timing: { kind: 'on_trigger' },
      },
    ],
    dependencies: [],
  };
  const created = await createPublishedProcessDefinition(db, { organizationId, definition });
  return { definitionId: created.definitionId, revisionId: created.revisionId };
}

/** Create a daily series with one explicit missed-work policy. */
async function dailySeries(
  name: string,
  missedPolicy: 'skip' | 'carry' | 'resolve',
  startDate = '2026-08-01',
): Promise<{ id: string }> {
  const process = await taskProcess(name);
  return createRecurrenceSeries(db, {
    organizationId,
    series: {
      processDefinitionId: ProcessDefinitionId.parse(process.definitionId),
      name,
      trigger: {
        kind: 'calendar',
        schedule: {
          kind: 'daily',
          interval: 1,
          startDate,
          timezone: 'America/Los_Angeles',
          end: { kind: 'after_count', count: 20 },
        },
        missedPolicy,
        materialization: { horizonDays: 2, minimumOccurrences: 2 },
      },
    },
  });
}

describe('rolling recurrence sweep', () => {
  it('applies skip, carry, and resolve policies once, then idempotently extends the window', async () => {
    const skip = await dailySeries('Daily run', 'skip');
    const carry = await dailySeries('Send owed report', 'carry');
    const resolve = await dailySeries('Ambiguous daily review', 'resolve');

    const skipped = await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: skip.id,
      asOf: '2026-08-05',
      now: new Date('2026-08-05T12:00:00.000Z'),
    });
    const carried = await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: carry.id,
      asOf: '2026-08-05',
      now: new Date('2026-08-05T12:00:00.000Z'),
    });
    const unresolved = await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: resolve.id,
      asOf: '2026-08-05',
      now: new Date('2026-08-05T12:00:00.000Z'),
    });

    expect(skipped).toMatchObject({ skipped: 4, carried: 0, needsResolution: 0, materialized: 3 });
    expect(carried).toMatchObject({ skipped: 0, carried: 4, needsResolution: 0, materialized: 3 });
    expect(unresolved).toMatchObject({
      skipped: 0,
      carried: 0,
      needsResolution: 4,
      materialized: 3,
    });

    const retried = await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: skip.id,
      asOf: '2026-08-05',
      now: new Date('2026-08-05T12:05:00.000Z'),
    });
    expect(retried).toMatchObject({ skipped: 0, carried: 0, needsResolution: 0, materialized: 0 });

    const extended = await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: skip.id,
      asOf: '2026-08-07',
      now: new Date('2026-08-07T12:00:00.000Z'),
    });
    expect(extended.materialized).toBe(2);
    expect(
      await db
        .select()
        .from(processOccurrence)
        .where(
          and(eq(processOccurrence.seriesId, skip.id), eq(processOccurrence.status, 'skipped')),
        ),
    ).toHaveLength(4);
    expect(
      await db
        .select()
        .from(processOccurrence)
        .where(
          and(
            eq(processOccurrence.seriesId, resolve.id),
            eq(processOccurrence.status, 'needs_resolution'),
          ),
        ),
    ).toHaveLength(4);
  });

  it('does not create work while a series is paused', async () => {
    const series = await dailySeries('Paused cadence', 'skip', '2026-09-01');
    await transitionRecurrenceSeries(db, organizationId, series.id, { action: 'pause' });

    const result = await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: series.id,
      asOf: '2026-09-01',
    });

    expect(result.materialized).toBe(0);
    expect(
      await db.select().from(processOccurrence).where(eq(processOccurrence.seriesId, series.id)),
    ).toHaveLength(0);
  });

  it('supersedes unfinished materialized work at a future revision boundary', async () => {
    const series = await dailySeries('Editable future cadence', 'skip', '2026-10-01');
    await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: series.id,
      asOf: '2026-10-01',
    });
    const before = await db
      .select()
      .from(processOccurrence)
      .where(
        and(
          eq(processOccurrence.seriesId, series.id),
          gte(processOccurrence.scheduledFor, '2026-10-03'),
        ),
      );
    expect(before.length).toBeGreaterThan(0);

    await editRecurrenceSeries(db, {
      organizationId,
      seriesId: series.id,
      edit: {
        scope: 'future',
        effectiveFrom: '2026-10-03',
        trigger: {
          kind: 'calendar',
          schedule: {
            kind: 'daily',
            interval: 2,
            startDate: '2026-10-03',
            timezone: 'America/Los_Angeles',
            end: { kind: 'after_count', count: 6 },
          },
          missedPolicy: 'skip',
          materialization: { horizonDays: 4, minimumOccurrences: 2 },
        },
      },
    });
    expect(
      await db
        .select()
        .from(processOccurrence)
        .where(
          and(
            eq(processOccurrence.seriesId, series.id),
            gte(processOccurrence.scheduledFor, '2026-10-03'),
            eq(processOccurrence.status, 'superseded'),
          ),
        ),
    ).toHaveLength(before.length);

    const oldTaskRows = await db
      .select({ archivedAt: task.archivedAt })
      .from(processOccurrence)
      .innerJoin(processInstance, eq(processInstance.occurrenceId, processOccurrence.id))
      .innerJoin(processInstanceTask, eq(processInstanceTask.instanceId, processInstance.id))
      .innerJoin(task, eq(task.id, processInstanceTask.taskId))
      .where(
        inArray(
          processOccurrence.id,
          before.map((occurrence) => occurrence.id),
        ),
      );
    expect(oldTaskRows.every((row) => row.archivedAt !== null)).toBe(true);

    await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: series.id,
      asOf: '2026-10-01',
    });
    const revisions = await db
      .select()
      .from(recurrenceSeriesRevision)
      .where(eq(recurrenceSeriesRevision.seriesId, series.id));
    const latest = revisions.find((revision) => revision.number === 2);
    expect(latest).toBeDefined();
    expect(
      await db
        .select()
        .from(processOccurrence)
        .where(
          and(
            eq(processOccurrence.seriesId, series.id),
            eq(processOccurrence.seriesRevisionId, assertDefined(latest).id),
            eq(processOccurrence.status, 'materialized'),
          ),
        ),
    ).toEqual([
      expect.objectContaining({ scheduledFor: '2026-10-03' }),
      expect.objectContaining({ scheduledFor: '2026-10-05' }),
    ]);
  });

  it('rejects past and out-of-order future revision boundaries', async () => {
    const series = await dailySeries('Chronological future cadence', 'skip', '2026-10-01');

    await expect(
      editRecurrenceSeries(db, {
        organizationId,
        seriesId: series.id,
        asOf: '2026-10-02',
        edit: {
          scope: 'future',
          effectiveFrom: '2026-10-01',
          trigger: {
            kind: 'calendar',
            schedule: {
              kind: 'daily',
              interval: 2,
              startDate: '2026-10-01',
              timezone: 'America/Los_Angeles',
              end: { kind: 'never' },
            },
            missedPolicy: 'skip',
            materialization: { horizonDays: 4, minimumOccurrences: 2 },
          },
        },
      }),
    ).rejects.toThrow('Future schedule changes cannot begin in the past');

    await editRecurrenceSeries(db, {
      organizationId,
      seriesId: series.id,
      asOf: '2026-10-01',
      edit: {
        scope: 'future',
        effectiveFrom: '2026-10-03',
        trigger: {
          kind: 'calendar',
          schedule: {
            kind: 'daily',
            interval: 2,
            startDate: '2026-10-03',
            timezone: 'America/Los_Angeles',
            end: { kind: 'never' },
          },
          missedPolicy: 'skip',
          materialization: { horizonDays: 4, minimumOccurrences: 2 },
        },
      },
    });

    await expect(
      editRecurrenceSeries(db, {
        organizationId,
        seriesId: series.id,
        asOf: '2026-10-01',
        edit: {
          scope: 'future',
          effectiveFrom: '2026-10-02',
          trigger: {
            kind: 'calendar',
            schedule: {
              kind: 'daily',
              interval: 3,
              startDate: '2026-10-02',
              timezone: 'America/Los_Angeles',
              end: { kind: 'never' },
            },
            missedPolicy: 'skip',
            materialization: { horizonDays: 4, minimumOccurrences: 2 },
          },
        },
      }),
    ).rejects.toThrow('Future schedule changes must follow the latest schedule version');
  });

  it('retires generated work when one materialized occurrence moves', async () => {
    const series = await dailySeries('Move one occurrence', 'skip', '2026-12-01');
    await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: series.id,
      asOf: '2026-12-01',
    });
    const [original] = await db
      .select({
        occurrenceId: processOccurrence.id,
        instanceId: processInstance.id,
        taskId: task.id,
      })
      .from(processOccurrence)
      .innerJoin(processInstance, eq(processInstance.occurrenceId, processOccurrence.id))
      .innerJoin(processInstanceTask, eq(processInstanceTask.instanceId, processInstance.id))
      .innerJoin(task, eq(task.id, processInstanceTask.taskId))
      .where(
        and(
          eq(processOccurrence.seriesId, series.id),
          eq(processOccurrence.scheduledFor, '2026-12-02'),
        ),
      );
    expect(original).toBeDefined();
    const retiredTaskIds: string[] = [];

    await editRecurrenceSeries(db, {
      organizationId,
      seriesId: series.id,
      edit: {
        scope: 'occurrence',
        scheduledFor: '2026-12-02',
        resolution: { kind: 'reschedule', scheduledFor: '2026-12-20' },
      },
      onRetired: async (work) => {
        retiredTaskIds.push(...work.taskIds);
      },
    });

    expect(retiredTaskIds).toEqual([assertDefined(original).taskId]);
    expect(
      await db
        .select({ archivedAt: task.archivedAt })
        .from(task)
        .where(eq(task.id, assertDefined(original).taskId)),
    ).toEqual([{ archivedAt: expect.any(Date) }]);
    expect(
      await db
        .select({ status: processInstance.status })
        .from(processInstance)
        .where(eq(processInstance.id, assertDefined(original).instanceId)),
    ).toEqual([{ status: 'canceled' }]);
    expect(
      await db
        .select({ status: processOccurrence.status })
        .from(processOccurrence)
        .where(eq(processOccurrence.id, assertDefined(original).occurrenceId)),
    ).toEqual([{ status: 'canceled' }]);
    expect(
      await db
        .select({ archivedAt: task.archivedAt })
        .from(processOccurrence)
        .innerJoin(processInstance, eq(processInstance.occurrenceId, processOccurrence.id))
        .innerJoin(processInstanceTask, eq(processInstanceTask.instanceId, processInstance.id))
        .innerJoin(task, eq(task.id, processInstanceTask.taskId))
        .where(
          and(
            eq(processOccurrence.seriesId, series.id),
            eq(processOccurrence.scheduledFor, '2026-12-20'),
          ),
        ),
    ).toEqual([{ archivedAt: null }]);
  });

  it('sweeps active series globally and isolates aggregate counts', async () => {
    const result = await sweepRecurrenceMaterialization(db, new Date('2026-11-01T12:00:00.000Z'));
    expect(result.seriesSwept).toBeGreaterThan(0);
    expect(result.failedSeriesIds).toEqual([]);
  });
});
import { installTestProductFixture } from '../support/db';
