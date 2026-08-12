/** Behavioral API coverage for reusable processes, recurrence series, and repeating tasks. */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type {
  ProcessDefinitionDetailOut,
  RecurrenceSeriesDetailOut,
  RecurrenceSeriesOut,
  RecurringTaskCreated,
} from '@docket/types';

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
    });
    expect(created.firstTask.startDate?.slice(0, 10)).toBe('2099-01-05');
    expect(created.firstTask.dueDate?.slice(0, 10)).toBe('2099-01-06');
    expect(created.occurrences.length).toBeGreaterThanOrEqual(8);
    expect(new Set(created.occurrences.map((occurrence) => occurrence.taskId)).size).toBe(
      created.occurrences.length,
    );
  });
});
