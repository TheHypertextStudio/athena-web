/** Generated Project history must link to its Project independently of surviving Tasks. */
import { beforeAll, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import type {
  RecurrenceSeriesDetailOut,
  RecurrenceSeriesOut,
} from '../../src/contracts/recurrence';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import recurrenceSeries from '../../src/routes/recurrence-series';
import { appWithActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';

let schema: typeof DbModule;
const JSON_HEADERS = { 'content-type': 'application/json' };

beforeAll(async () => {
  schema = await getDb();
});

async function generatedProjectFixture() {
  const org = await seedTaskAccessOrg(schema.db, schema);
  const definition = await createPublishedProcessDefinition(schema.db, {
    organizationId: org.orgId,
    actorId: org.humanActorId,
    definition: ProcessDefinitionCreate.parse({
      name: 'Quarterly accounts review',
      project: { key: 'accounts', name: 'Accounts review · {date}', teamId: org.teamId },
      tasks: [
        { key: 'check', title: 'Check balances', teamId: org.teamId, projectKey: 'accounts' },
      ],
    }),
  });
  const app = appWithActor(recurrenceSeries, org.orgId, ['contribute'], org.humanActorId);
  const createdResponse = await app.request('/', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      processDefinitionId: definition.definitionId,
      name: 'Accounts review',
      trigger: { kind: 'manual' },
    }),
  });
  expect(createdResponse.status).toBe(201);
  const created = (await createdResponse.json()) as RecurrenceSeriesOut;
  const result = await app.request(`/${created.id}/materialize`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ scheduledFor: '2098-09-01' }),
  });
  expect(result.status).toBe(200);
  const initial = (await result.json()) as RecurrenceSeriesDetailOut;
  return { app, created, initial };
}

it('retains the generated Project destination before and after all its Tasks are removed', async () => {
  const { app, created, initial } = await generatedProjectFixture();
  expect(initial.occurrences).toEqual([
    expect.objectContaining({
      scheduledFor: '2098-09-01',
      status: 'materialized',
      projectId: expect.any(String),
      taskId: expect.any(String),
    }),
  ]);
  const instanceId = assertDefined(initial.occurrences[0]?.processInstanceId);
  const generatedTasks = await schema.db
    .select({ id: schema.processInstanceTask.taskId })
    .from(schema.processInstanceTask)
    .where(eq(schema.processInstanceTask.instanceId, instanceId));
  expect(generatedTasks).toHaveLength(1);
  await schema.db.delete(schema.task).where(
    inArray(
      schema.task.id,
      generatedTasks.map(({ id }) => id),
    ),
  );
  const refreshed = await app.request(`/${created.id}`);
  expect(refreshed.status).toBe(200);
  const materialized = (await refreshed.json()) as RecurrenceSeriesDetailOut;
  expect(materialized.occurrences).toEqual([
    expect.objectContaining({ projectId: initial.occurrences[0]?.projectId, taskId: null }),
  ]);
  const projectId = assertDefined(materialized.occurrences[0]?.projectId);
  const [generatedProject] = await schema.db
    .select()
    .from(schema.project)
    .where(eq(schema.project.id, projectId));
  expect(generatedProject?.name).toBe('Accounts review · 2098-09-01');
});
