/** Behavioral API coverage for reusable processes, recurrence series, and repeating tasks. */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type {
  ProcessTrigger,
  ProcessDefinitionDetailOut,
  RecurrenceSeriesDetailOut,
  RecurrenceSeriesOut,
  RecurringTaskCreated,
} from '@docket/types';
import { eq } from 'drizzle-orm';

import type processDefinitionsRouter from '../../src/routes/process-definitions';
import type recurrenceSeriesRouter from '../../src/routes/recurrence-series';
import type { recurringTaskRoutes as RecurringTaskRouter } from '../../src/routes/recurrence-series';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let processDefinitions!: typeof processDefinitionsRouter;
let recurrenceSeries!: typeof recurrenceSeriesRouter;
let recurringTasks!: typeof RecurringTaskRouter;

const JSON_HEADERS = { 'content-type': 'application/json' };

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  processDefinitions = (await import('../../src/routes/process-definitions')).default;
  const seriesModule = await import('../../src/routes/recurrence-series');
  recurrenceSeries = seriesModule.default;
  recurringTasks = seriesModule.recurringTaskRoutes;
});

/** Parse one JSON response as the requested API DTO. */
async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Representative fixed workshop process used by the reusable-process routes. */
function workshopDefinition(teamId: string, followUp = 'Send follow-ups to attendees') {
  return {
    name: 'Intro to Urbanism Workshop Series',
    creationMode: 'all_at_once',
    project: {
      key: 'workshop',
      name: 'Intro to Urbanism Workshop · {date}',
      teamId,
      timing: { kind: 'on_trigger' },
    },
    milestones: [],
    tasks: [
      {
        key: 'publish',
        title: 'Publish event to website and other platforms',
        teamId,
        projectKey: 'workshop',
        timing: { kind: 'relative_to_trigger', offsetDays: -14 },
      },
      {
        key: 'host',
        title: 'Host workshop',
        teamId,
        projectKey: 'workshop',
        timing: { kind: 'on_trigger' },
      },
      {
        key: 'follow-up',
        title: followUp,
        teamId,
        projectKey: 'workshop',
        timing: { kind: 'after_step_completion', stepKey: 'host', offsetDays: 1 },
      },
    ],
    dependencies: [{ blockingStepKey: 'host', blockedStepKey: 'follow-up' }],
  };
}

describe('process definitions routes', () => {
  it('creates, lists, reconstructs, revises, renames, and archives one process', async () => {
    const org = await seedBaseOrg(db, schema);
    const app = appWithActor(processDefinitions, org.orgId, ['contribute'], org.humanActorId);

    const createResponse = await app.request('/', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(workshopDefinition(org.teamId)),
    });
    expect(createResponse.status).toBe(200);
    const created = await body<ProcessDefinitionDetailOut>(createResponse);
    expect(created.revision.number).toBe(1);
    expect(created.revision.tasks.map((task) => task.key)).toEqual([
      'publish',
      'host',
      'follow-up',
    ]);

    const listed = await body<{ items: ProcessDefinitionDetailOut[] }>(await app.request('/'));
    expect(listed.items).toEqual([expect.objectContaining({ id: created.id })]);
    const fetched = await body<ProcessDefinitionDetailOut>(await app.request(`/${created.id}`));
    expect(fetched.revision.dependencies).toEqual([
      { blockingStepKey: 'host', blockedStepKey: 'follow-up' },
    ]);

    const revisedResponse = await app.request(`/${created.id}/revisions`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(workshopDefinition(org.teamId, 'Send resources and survey')),
    });
    expect(revisedResponse.status).toBe(200);
    const revised = await body<ProcessDefinitionDetailOut>(revisedResponse);
    expect(revised.revision.number).toBe(2);
    expect(revised.revision.tasks.at(-1)?.title).toBe('Send resources and survey');

    const renamed = await body<ProcessDefinitionDetailOut>(
      await app.request(`/${created.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'Intro workshop' }),
      }),
    );
    expect(renamed.name).toBe('Intro workshop');
    expect(renamed.revision.number).toBe(2);

    const archived = await app.request(`/${created.id}`, { method: 'DELETE' });
    expect(archived.status).toBe(200);
    expect((await body<{ status: string }>(archived)).status).toBe('archived');
    expect((await app.request(`/${created.id}`)).status).toBe(404);
  });

  it('enforces contribute capability and tenant isolation', async () => {
    const first = await seedBaseOrg(db, schema);
    const writer = appWithActor(
      processDefinitions,
      first.orgId,
      ['contribute'],
      first.humanActorId,
    );
    const created = await body<ProcessDefinitionDetailOut>(
      await writer.request('/', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(workshopDefinition(first.teamId)),
      }),
    );
    const viewer = appWithActor(processDefinitions, first.orgId, ['view'], first.humanActorId);
    expect(
      (
        await viewer.request('/', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(workshopDefinition(first.teamId)),
        })
      ).status,
    ).toBe(403);

    const second = await seedBaseOrg(db, schema);
    const foreign = appWithActor(
      processDefinitions,
      second.orgId,
      ['contribute'],
      second.humanActorId,
    );
    expect((await foreign.request(`/${created.id}`)).status).toBe(404);
    expect((await foreign.request(`/${created.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('recurrence series routes', () => {
  it('creates, materializes, edits future behavior, pauses, resumes, and ends a series', async () => {
    const org = await seedBaseOrg(db, schema);
    const processes = appWithActor(processDefinitions, org.orgId, ['contribute'], org.humanActorId);
    const definition = await body<ProcessDefinitionDetailOut>(
      await processes.request('/', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(workshopDefinition(org.teamId)),
      }),
    );
    const app = appWithActor(recurrenceSeries, org.orgId, ['contribute'], org.humanActorId);
    const createdResponse = await app.request('/', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        processDefinitionId: definition.id,
        name: 'Workshop Series',
        trigger: { kind: 'manual' },
      }),
    });
    expect(createdResponse.status).toBe(200);
    const created = await body<RecurrenceSeriesOut>(createdResponse);
    expect(created.trigger).toEqual({ kind: 'manual' });

    const materializedResponse = await app.request(`/${created.id}/materialize`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ scheduledFor: '2098-09-01' }),
    });
    expect(materializedResponse.status).toBe(200);
    const materialized = await body<RecurrenceSeriesDetailOut>(materializedResponse);
    expect(materialized.occurrences).toEqual([
      expect.objectContaining({ scheduledFor: '2098-09-01', status: 'materialized' }),
    ]);
    const retried = await body<RecurrenceSeriesDetailOut>(
      await app.request(`/${created.id}/materialize`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ scheduledFor: '2098-09-01' }),
      }),
    );
    expect(retried.occurrences).toHaveLength(1);

    for (const scheduledFor of ['2098-09-02', '2098-09-03', '2098-09-05']) {
      expect(
        (
          await app.request(`/${created.id}/materialize`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ scheduledFor }),
          })
        ).status,
      ).toBe(200);
    }
    const skipped = await body<RecurrenceSeriesDetailOut>(
      await app.request(`/${created.id}/edits`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          scope: 'occurrence',
          scheduledFor: '2098-09-02',
          resolution: { kind: 'skip' },
        }),
      }),
    );
    expect(skipped.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scheduledFor: '2098-09-02', status: 'skipped' }),
      ]),
    );
    const rescheduled = await body<RecurrenceSeriesDetailOut>(
      await app.request(`/${created.id}/edits`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          scope: 'occurrence',
          scheduledFor: '2098-09-03',
          resolution: { kind: 'reschedule', scheduledFor: '2098-09-04' },
        }),
      }),
    );
    expect(rescheduled.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scheduledFor: '2098-09-03', status: 'canceled' }),
        expect.objectContaining({
          scheduledFor: '2098-09-04',
          originalScheduledFor: '2098-09-03',
          status: 'materialized',
        }),
      ]),
    );
    const completed = await body<RecurrenceSeriesDetailOut>(
      await app.request(`/${created.id}/edits`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          scope: 'occurrence',
          scheduledFor: '2098-09-05',
          resolution: { kind: 'complete' },
        }),
      }),
    );
    expect(completed.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scheduledFor: '2098-09-05', status: 'completed' }),
      ]),
    );
    expect(
      (
        await app.request(`/${created.id}/edits`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            scope: 'occurrence',
            scheduledFor: '2098-09-06',
            resolution: { kind: 'complete' },
          }),
        })
      ).status,
    ).toBe(404);

    const protectedOccurrence = await body<RecurrenceSeriesDetailOut>(
      await app.request(`/${created.id}/materialize`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ scheduledFor: '2098-09-07' }),
      }),
    );
    const protectedTaskId = protectedOccurrence.occurrences.find(
      (occurrence) => occurrence.scheduledFor === '2098-09-07',
    )?.taskId;
    expect(protectedTaskId).toBeTruthy();
    await db
      .update(schema.task)
      .set({ state: 'done', completedAt: new Date('2098-09-07T20:00:00.000Z') })
      .where(eq(schema.task.id, protectedTaskId!));
    expect(
      (
        await app.request(`/${created.id}/edits`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            scope: 'occurrence',
            scheduledFor: '2098-09-07',
            resolution: { kind: 'skip' },
          }),
        })
      ).status,
    ).toBe(409);

    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const futureEffectiveFrom = tomorrow.toISOString().slice(0, 10);
    const future = await body<RecurrenceSeriesDetailOut>(
      await app.request(`/${created.id}/edits`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          scope: 'future',
          effectiveFrom: futureEffectiveFrom,
          trigger: {
            kind: 'calendar',
            schedule: {
              kind: 'daily',
              interval: 1,
              startDate: futureEffectiveFrom,
              timezone: 'America/Los_Angeles',
              end: { kind: 'after_count', count: 3 },
            },
            missedPolicy: 'resolve',
            materialization: { horizonDays: 45, minimumOccurrences: 2 },
          },
        }),
      }),
    );
    expect(future.trigger.kind).toBe('calendar');
    expect(future.processRevisionId).toBe(definition.revision.id);
    expect(future.revisions.map((revision) => revision.number)).toEqual([1, 2]);
    expect(future.revisions[1]).toMatchObject({
      effectiveFrom: futureEffectiveFrom,
      trigger: { kind: 'calendar' },
    });
    expect(future.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scheduledFor: futureEffectiveFrom, status: 'materialized' }),
      ]),
    );

    for (const action of ['pause', 'resume', 'end'] as const) {
      const changed = await body<RecurrenceSeriesOut>(
        await app.request(`/${created.id}/lifecycle`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ action }),
        }),
      );
      expect(changed.status).toBe(
        action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'ended',
      );
      if (action === 'pause' || action === 'end') {
        const repeated = await body<RecurrenceSeriesOut>(
          await app.request(`/${created.id}/lifecycle`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ action }),
          }),
        );
        expect(repeated.status).toBe(action === 'pause' ? 'paused' : 'ended');
      }
      if (action === 'pause') {
        expect(
          (
            await app.request(`/${created.id}/materialize`, {
              method: 'POST',
              headers: JSON_HEADERS,
              body: JSON.stringify({ scheduledFor: '2098-10-01' }),
            })
          ).status,
        ).toBe(409);
      }
    }
    expect(
      (
        await app.request(`/${created.id}/lifecycle`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ action: 'resume' }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(`/${created.id}/edits`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            scope: 'future',
            effectiveFrom: '2099-01-01',
            trigger: { kind: 'manual' },
          }),
        })
      ).status,
    ).toBe(409);
  });

  it('round-trips every persisted trigger shape through series creation and detail reads', async () => {
    const org = await seedBaseOrg(db, schema);
    const processes = appWithActor(processDefinitions, org.orgId, ['contribute'], org.humanActorId);
    const definition = await body<ProcessDefinitionDetailOut>(
      await processes.request('/', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(workshopDefinition(org.teamId)),
      }),
    );
    const app = appWithActor(recurrenceSeries, org.orgId, ['contribute'], org.humanActorId);
    const cases = [
      {
        name: 'completion anchored',
        effectiveFrom: '2099-01-03',
        trigger: { kind: 'after_completion', interval: 2, unit: 'week' },
      },
      {
        name: 'event driven',
        trigger: {
          kind: 'event',
          event: {
            kind: 'updated',
            subjectType: 'calendar_event',
            source: 'google',
            entityKind: 'workshop',
          },
        },
      },
      {
        name: 'daily through a date',
        trigger: {
          kind: 'calendar',
          schedule: {
            kind: 'daily',
            interval: 2,
            startDate: '2099-02-01',
            timezone: 'America/Los_Angeles',
            end: { kind: 'on_date', date: '2099-02-03' },
          },
          missedPolicy: 'carry',
          materialization: { horizonDays: 14, minimumOccurrences: 1 },
        },
      },
      {
        name: 'weekly without an end',
        trigger: {
          kind: 'calendar',
          schedule: {
            kind: 'weekly',
            interval: 2,
            weekdays: ['tuesday', 'thursday'],
            startDate: '2099-03-01',
            timezone: 'America/Los_Angeles',
            end: { kind: 'never' },
          },
          missedPolicy: 'skip',
          materialization: { horizonDays: 14, minimumOccurrences: 2 },
        },
      },
      {
        name: 'monthly numbered day',
        trigger: {
          kind: 'calendar',
          schedule: {
            kind: 'monthly',
            interval: 1,
            pattern: { kind: 'day_of_month', day: 31, overflow: 'last_day' },
            startDate: '2099-04-01',
            timezone: 'America/Los_Angeles',
            end: { kind: 'after_count', count: 1 },
          },
          missedPolicy: 'resolve',
          materialization: { horizonDays: 31, minimumOccurrences: 1 },
        },
      },
      {
        name: 'monthly ordinal weekday',
        trigger: {
          kind: 'calendar',
          schedule: {
            kind: 'monthly',
            interval: 1,
            pattern: { kind: 'nth_weekday', ordinal: -1, weekday: 'sunday' },
            startDate: '2099-05-01',
            timezone: 'America/Los_Angeles',
            end: { kind: 'after_count', count: 1 },
          },
          missedPolicy: 'skip',
          materialization: { horizonDays: 31, minimumOccurrences: 1 },
        },
      },
      {
        name: 'yearly',
        trigger: {
          kind: 'calendar',
          schedule: {
            kind: 'yearly',
            interval: 1,
            month: 2,
            day: 29,
            overflow: 'skip',
            startDate: '2100-01-01',
            timezone: 'America/Los_Angeles',
            end: { kind: 'after_count', count: 1 },
          },
          missedPolicy: 'skip',
          materialization: { horizonDays: 366, minimumOccurrences: 1 },
        },
      },
    ] satisfies readonly {
      name: string;
      effectiveFrom?: string;
      trigger: ProcessTrigger;
    }[];

    const createdIds: string[] = [];
    for (const testCase of cases) {
      const response = await app.request('/', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          processDefinitionId: definition.id,
          name: `Workshop · ${testCase.name}`,
          trigger: testCase.trigger,
          ...(testCase.effectiveFrom ? { effectiveFrom: testCase.effectiveFrom } : {}),
        }),
      });
      expect(response.status, testCase.name).toBe(200);
      const created = await body<RecurrenceSeriesOut>(response);
      createdIds.push(created.id);
      expect(created.trigger, testCase.name).toEqual(testCase.trigger);

      const detail = await body<RecurrenceSeriesDetailOut>(await app.request(`/${created.id}`));
      expect(detail.trigger, testCase.name).toEqual(testCase.trigger);
      if (testCase.name === 'completion anchored') {
        expect(
          (
            await app.request(`/${created.id}/materialize`, {
              method: 'POST',
              headers: JSON_HEADERS,
              body: JSON.stringify({ scheduledFor: '2098-12-31' }),
            })
          ).status,
        ).toBe(404);
      }
    }

    const listed = await body<{ items: RecurrenceSeriesOut[] }>(await app.request('/'));
    expect(listed.items.filter((series) => createdIds.includes(series.id))).toHaveLength(
      cases.length,
    );
  });

  it('rejects a series whose process definition is unavailable in the workspace', async () => {
    const org = await seedBaseOrg(db, schema);
    const app = appWithActor(recurrenceSeries, org.orgId, ['contribute'], org.humanActorId);
    const response = await app.request('/', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        processDefinitionId: '01J00000000000000000000000',
        name: 'Unavailable process',
        trigger: { kind: 'manual' },
      }),
    });
    expect(response.status).toBe(404);

    expect(
      (
        await app.request('/01J00000000000000000000000/edits', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            scope: 'future',
            effectiveFrom: '2099-01-01',
            trigger: { kind: 'manual' },
          }),
        })
      ).status,
    ).toBe(404);
  });

  it('returns null backlinks for ordinary task and project identifiers', async () => {
    const org = await seedBaseOrg(db, schema);
    const app = appWithActor(recurrenceSeries, org.orgId, ['view'], org.humanActorId);
    expect(await body(await app.request('/for-task/01J00000000000000000000000'))).toBeNull();
    expect(await body(await app.request('/for-project/01J00000000000000000000000'))).toBeNull();
  });
});

describe('recurring task route', () => {
  it('creates the rolling task window and preserves the ordinary task draft', async () => {
    const org = await seedBaseOrg(db, schema);
    const project = (
      await db
        .insert(schema.project)
        .values({ organizationId: org.orgId, teamId: org.teamId, name: 'Marathon training' })
        .returning()
    )[0]!;
    const app = appWithActor(recurringTasks, org.orgId, ['contribute'], org.humanActorId);
    const response = await app.request('/', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        task: {
          title: 'Run six miles',
          description: 'Easy conversational pace.',
          teamId: org.teamId,
          projectId: project.id,
          priority: 'medium',
          estimateMinutes: 45,
          startDate: '2099-01-05',
          dueDate: '2099-01-06',
        },
        schedule: {
          kind: 'weekly',
          interval: 1,
          weekdays: ['monday', 'wednesday', 'friday'],
          startDate: '2099-01-05',
          timezone: 'America/Los_Angeles',
          end: { kind: 'after_count', count: 8 },
        },
        missedPolicy: 'skip',
        materialization: { horizonDays: 28, minimumOccurrences: 2 },
      }),
    });
    expect(response.status).toBe(200);
    const created = await body<RecurringTaskCreated>(response);
    expect(created.firstTask).toMatchObject({
      title: 'Run six miles',
      description: 'Easy conversational pace.',
      projectId: project.id,
      priority: 'medium',
      estimateMinutes: 45,
    });
    expect(created.firstTask.startDate?.slice(0, 10)).toBe('2099-01-05');
    expect(created.firstTask.dueDate?.slice(0, 10)).toBe('2099-01-06');
    expect(created.occurrences.length).toBeGreaterThanOrEqual(8);
    expect(new Set(created.occurrences.map((occurrence) => occurrence.taskId)).size).toBe(
      created.occurrences.length,
    );
  });

  it('anchors completion schedules to due date, start date, or today in that order', async () => {
    const org = await seedBaseOrg(db, schema);
    const app = appWithActor(recurringTasks, org.orgId, ['contribute'], org.humanActorId);
    const today = new Date().toISOString().slice(0, 10);
    const cases = [
      {
        title: 'Check in after the race-plan review',
        taskDates: { startDate: '2099-06-01', dueDate: '2099-06-03' },
        expectedDate: '2099-06-03',
      },
      {
        title: 'Check in after onboarding begins',
        taskDates: { startDate: '2099-07-04' },
        expectedDate: '2099-07-04',
      },
      {
        title: 'Check in after completion',
        taskDates: {},
        expectedDate: today,
      },
    ] as const;

    for (const testCase of cases) {
      const response = await app.request('/', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          task: {
            title: testCase.title,
            teamId: org.teamId,
            ...testCase.taskDates,
          },
          schedule: { kind: 'after_completion', interval: 2, unit: 'week' },
        }),
      });
      expect(response.status, testCase.title).toBe(200);
      const created = await body<RecurringTaskCreated>(response);
      expect(created.occurrences).toHaveLength(1);
      expect(created.occurrences[0]?.scheduledFor).toBe(testCase.expectedDate);
      expect(created.firstTask.title).toBe(testCase.title);
    }
  });

  it('rejects a finite calendar rule whose complete series is already in the past', async () => {
    const org = await seedBaseOrg(db, schema);
    const app = appWithActor(recurringTasks, org.orgId, ['contribute'], org.humanActorId);
    const response = await app.request('/', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        task: { title: 'Expired daily workout', teamId: org.teamId },
        schedule: {
          kind: 'daily',
          interval: 1,
          startDate: '2020-01-01',
          timezone: 'America/Los_Angeles',
          end: { kind: 'after_count', count: 1 },
        },
      }),
    });
    expect(response.status).toBe(409);
  });
});
