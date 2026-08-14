/** Storage-level invariants for normalized process and recurrence execution state. */
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fullSchema, type Database } from '../../src/client';
import {
  organization,
  processDefinition,
  processInstance,
  processInstanceTask,
  processOccurrence,
  processProjectSpec,
  processRevision,
  processStep,
  processTaskSpec,
  recurrenceSeries,
  recurrenceSeriesRevision,
  task,
  team,
} from '../../src/schema';
import { assertDefined } from '@docket/test-utils';

let client!: PGlite;
let db!: Database;
let orgId!: string;
let teamId!: string;
let definitionId!: string;
let revisionId!: string;

/** Require a write to fail for one specific database constraint. */
async function expectConstraint(write: Promise<unknown>, constraint: string): Promise<void> {
  await expect(write).rejects.toMatchObject({ cause: { constraint } });
}

describe('recurrence schema', () => {
  beforeAll(async () => {
    client = new PGlite('memory://');
    const migrated = drizzle(client, { schema: fullSchema });
    await migrate(migrated, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
    db = migrated;

    orgId = assertDefined(
      (
        await db
          .insert(organization)
          .values({ name: 'Repeating work', slug: `repeat-${Date.now()}` })
          .returning()
      )[0],
    ).id;
    teamId = assertDefined(
      (
        await db
          .insert(team)
          .values({ organizationId: orgId, name: 'Events', key: 'EVENTS' })
          .returning()
      )[0],
    ).id;
    definitionId = assertDefined(
      (
        await db
          .insert(processDefinition)
          .values({ organizationId: orgId, name: 'Workshop series' })
          .returning()
      )[0],
    ).id;
    revisionId = assertDefined(
      (
        await db
          .insert(processRevision)
          .values({ organizationId: orgId, definitionId, number: 1, creationMode: 'all_at_once' })
          .returning()
      )[0],
    ).id;
  });

  afterAll(async () => {
    await client.close();
  });

  it('keeps step keys unique across every item kind in one revision', async () => {
    await db.insert(processStep).values({
      organizationId: orgId,
      revisionId,
      key: 'host',
      kind: 'task',
      timingKind: 'on_trigger',
    });

    await expectConstraint(
      db.insert(processStep).values({
        organizationId: orgId,
        revisionId,
        key: 'host',
        kind: 'milestone',
        timingKind: 'on_trigger',
      }),
      'process_step_revision_key_uq',
    );
  });

  it('requires timing payloads to match their discriminant', async () => {
    await expectConstraint(
      db.insert(processStep).values({
        organizationId: orgId,
        revisionId,
        key: 'invalid-relative',
        kind: 'task',
        timingKind: 'relative_to_trigger',
      }),
      'process_step_timing_shape_check',
    );
  });

  it('refuses negative estimates in reusable task specifications', async () => {
    const stepId = assertDefined(
      (
        await db
          .insert(processStep)
          .values({
            organizationId: orgId,
            revisionId,
            key: 'publish',
            kind: 'task',
            timingKind: 'relative_to_trigger',
            offsetDays: -14,
          })
          .returning()
      )[0],
    ).id;

    await expectConstraint(
      db.insert(processTaskSpec).values({
        stepId,
        organizationId: orgId,
        title: 'Publish event',
        teamId,
        priority: 'none',
        estimateMinutes: -30,
      }),
      'process_task_spec_estimate_minutes_nonneg',
    );
  });

  it('requires reusable task due dates to fall on or after their start dates', async () => {
    const stepId = assertDefined(
      (
        await db
          .insert(processStep)
          .values({
            organizationId: orgId,
            revisionId,
            key: 'ordered-dates',
            kind: 'task',
            timingKind: 'on_trigger',
          })
          .returning()
      )[0],
    ).id;

    await expectConstraint(
      db.insert(processTaskSpec).values({
        stepId,
        organizationId: orgId,
        title: 'Invalid date order',
        teamId,
        priority: 'none',
        startOffsetDays: 2,
        dueOffsetDays: 1,
      }),
      'process_task_spec_date_offsets_ordered',
    );
  });

  it('requires reusable project targets to fall on or after their starts', async () => {
    const stepId = assertDefined(
      (
        await db
          .insert(processStep)
          .values({
            organizationId: orgId,
            revisionId,
            key: 'ordered-project-dates',
            kind: 'project',
            timingKind: 'on_trigger',
          })
          .returning()
      )[0],
    ).id;

    await expectConstraint(
      db.insert(processProjectSpec).values({
        stepId,
        organizationId: orgId,
        name: 'Invalid project date order',
        status: 'planned',
        startOffsetDays: 2,
        targetOffsetDays: 1,
      }),
      'process_project_spec_date_offsets_ordered',
    );
  });

  it('requires calendar series revisions to carry a complete calendar schedule', async () => {
    const seriesId = assertDefined(
      (
        await db
          .insert(recurrenceSeries)
          .values({ organizationId: orgId, definitionId, name: 'Workshop series' })
          .returning()
      )[0],
    ).id;

    await expectConstraint(
      db.insert(recurrenceSeriesRevision).values({
        organizationId: orgId,
        seriesId,
        processRevisionId: revisionId,
        number: 1,
        effectiveFrom: '2026-09-01',
        triggerKind: 'calendar',
      }),
      'recurrence_series_revision_trigger_shape_check',
    );
  });

  it('materializes one occurrence and instance exactly once under retries', async () => {
    const seriesId = assertDefined(
      (
        await db
          .insert(recurrenceSeries)
          .values({ organizationId: orgId, definitionId, name: 'Daily run' })
          .returning()
      )[0],
    ).id;
    const seriesRevisionId = assertDefined(
      (
        await db
          .insert(recurrenceSeriesRevision)
          .values({
            organizationId: orgId,
            seriesId,
            processRevisionId: revisionId,
            number: 1,
            effectiveFrom: '2026-08-12',
            triggerKind: 'calendar',
            scheduleKind: 'daily',
            interval: 1,
            startDate: '2026-08-12',
            timezone: 'America/Los_Angeles',
            endKind: 'never',
            missedPolicy: 'skip',
            horizonDays: 28,
            minimumOccurrences: 2,
          })
          .returning()
      )[0],
    ).id;
    const occurrenceId = assertDefined(
      (
        await db
          .insert(processOccurrence)
          .values({
            organizationId: orgId,
            seriesId,
            seriesRevisionId,
            scheduledFor: '2026-08-12',
          })
          .returning()
      )[0],
    ).id;

    await expectConstraint(
      db.insert(processOccurrence).values({
        organizationId: orgId,
        seriesId,
        seriesRevisionId,
        scheduledFor: '2026-08-12',
      }),
      'process_occurrence_revision_date_uq',
    );

    await db.insert(processInstance).values({
      organizationId: orgId,
      definitionId,
      revisionId,
      occurrenceId,
    });
    await expectConstraint(
      db.insert(processInstance).values({
        organizationId: orgId,
        definitionId,
        revisionId,
        occurrenceId,
      }),
      'process_instance_occurrence_uq',
    );
  });

  it('maps each generated task to one source step per instance', async () => {
    const seriesId = assertDefined(
      (
        await db
          .insert(recurrenceSeries)
          .values({ organizationId: orgId, definitionId, name: 'Map test' })
          .returning()
      )[0],
    ).id;
    const seriesRevisionId = assertDefined(
      (
        await db
          .insert(recurrenceSeriesRevision)
          .values({
            organizationId: orgId,
            seriesId,
            processRevisionId: revisionId,
            number: 1,
            effectiveFrom: '2026-08-13',
            triggerKind: 'manual',
          })
          .returning()
      )[0],
    ).id;
    const occurrenceId = assertDefined(
      (
        await db
          .insert(processOccurrence)
          .values({
            organizationId: orgId,
            seriesId,
            seriesRevisionId,
            scheduledFor: '2026-08-13',
          })
          .returning()
      )[0],
    ).id;
    const instanceId = assertDefined(
      (
        await db
          .insert(processInstance)
          .values({ organizationId: orgId, definitionId, revisionId, occurrenceId })
          .returning()
      )[0],
    ).id;
    const stepId = assertDefined(
      (
        await db
          .insert(processStep)
          .values({
            organizationId: orgId,
            revisionId,
            key: 'mapped-task',
            kind: 'task',
            timingKind: 'on_trigger',
          })
          .returning()
      )[0],
    ).id;
    await db.insert(processTaskSpec).values({
      stepId,
      organizationId: orgId,
      title: 'Mapped task',
      teamId,
      priority: 'none',
    });
    const taskId = assertDefined(
      (
        await db
          .insert(task)
          .values({ organizationId: orgId, teamId, title: 'Mapped task', state: 'backlog' })
          .returning()
      )[0],
    ).id;

    await db.insert(processInstanceTask).values({
      organizationId: orgId,
      instanceId,
      stepId,
      taskId,
    });
    await expectConstraint(
      db.insert(processInstanceTask).values({
        organizationId: orgId,
        instanceId,
        stepId,
        taskId,
      }),
      'process_instance_task_instance_step_uq',
    );
  });
});
