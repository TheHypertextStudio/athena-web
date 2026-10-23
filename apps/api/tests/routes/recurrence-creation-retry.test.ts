/** Durable recurrence creation retries must reuse both the series and its generated work. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../../src/context';
import type {
  RecurrenceSeriesOut,
  RecurrenceSeriesDetailOut,
} from '../../src/contracts/recurrence';
import { idempotency } from '../../src/lib/idempotency';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import * as sweep from '../../src/lib/recurrence/sweep';
import recurrenceSeries from '../../src/routes/recurrence-series';
import { appWithAuthenticatedActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function fixture() {
  const org = await seedTaskAccessOrg(schema.db, schema);
  const definition = await createPublishedProcessDefinition(schema.db, {
    organizationId: org.orgId,
    actorId: org.humanActorId,
    definition: ProcessDefinitionCreate.parse({
      name: 'Weekly report',
      tasks: [{ key: 'report', title: 'Write report', teamId: org.teamId }],
    }),
  });
  const base = `/v1/orgs/${org.orgId}/recurrence-series`;
  const router = new Hono<AppEnv>();
  router.use('*', idempotency);
  router.route(base, recurrenceSeries);
  const app = await appWithAuthenticatedActor(
    schema.db,
    schema,
    router,
    org.orgId,
    ['contribute'],
    org.humanActorId,
  );
  const input = {
    processDefinitionId: definition.definitionId,
    name: 'Reports',
    effectiveFrom: '2098-09-01',
    trigger: {
      kind: 'calendar',
      schedule: {
        kind: 'daily',
        interval: 1,
        startDate: '2098-09-01',
        timezone: 'UTC',
        end: { kind: 'after_count', count: 1 },
      },
      missedPolicy: 'skip',
      materialization: { horizonDays: 7, minimumOccurrences: 1 },
    },
  };
  const request = (key: string, data: unknown = input) =>
    app.request(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(data),
    });
  return { org, app, input, request, base, router };
}

describe('recurrence creation receipts', () => {
  it('replays the original series after a lost response and rejects changed input', async () => {
    const f = await fixture();
    const first = await f.request('lost-response');
    expect(first.status).toBe(201);
    const result = (await first.json()) as RecurrenceSeriesOut;
    const retry = await f.request('lost-response');
    expect(retry.status).toBe(201);
    expect(retry.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await retry.json()).toEqual(result);
    expect((await f.request('lost-response', { ...f.input, name: 'Changed' })).status).toBe(422);
    const detail = (await (
      await f.app.request(`${f.base}/${result.id}`)
    ).json()) as RecurrenceSeriesDetailOut;
    expect(detail.occurrences).toHaveLength(1);
    const series = await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.organizationId, f.org.orgId));
    expect(series).toHaveLength(1);
  });

  it('resumes materialization after work committed but the initial request failed', async () => {
    const f = await fixture();
    const materialize = sweep.materializeRecurrenceSeriesWindow;
    vi.spyOn(sweep, 'materializeRecurrenceSeriesWindow').mockImplementationOnce(async (...args) => {
      await materialize(...args);
      throw new Error('Response failed after initial work committed');
    });
    expect((await f.request('resume-initial-work')).status).toBe(500);
    const series = await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.organizationId, f.org.orgId));
    expect(series).toHaveLength(1);
    const retry = await f.request('resume-initial-work');
    expect(retry.status).toBe(201);
    const result = (await retry.json()) as RecurrenceSeriesOut;
    expect(result.id).toBe(series[0]?.id);
    const detail = (await (
      await f.app.request(`${f.base}/${result.id}`)
    ).json()) as RecurrenceSeriesDetailOut;
    expect(detail.occurrences).toHaveLength(1);
    const tasks = await schema.db
      .select()
      .from(schema.processInstanceTask)
      .where(eq(schema.processInstanceTask.organizationId, f.org.orgId));
    expect(tasks).toHaveLength(1);
  });

  it('retries after failure before initial work exists', async () => {
    const f = await fixture();
    vi.spyOn(sweep, 'materializeRecurrenceSeriesWindow').mockRejectedValueOnce(
      new Error('Unavailable'),
    );
    expect((await f.request('before-work')).status).toBe(500);
    const series = await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.organizationId, f.org.orgId));
    expect(series).toHaveLength(1);
    expect((await f.request('before-work')).status).toBe(201);
    const occurrences = await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.organizationId, f.org.orgId));
    expect(occurrences).toHaveLength(1);
  });

  it('keeps completion-anchored initial work singular across retries', async () => {
    const f = await fixture();
    const input = { ...f.input, trigger: { kind: 'after_completion', interval: 2, unit: 'week' } };
    const first = await f.request('completion-work', input);
    expect(first.status).toBe(201);
    const result = (await first.json()) as RecurrenceSeriesOut;
    const retry = await f.request('completion-work', input);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(result);
    const detail = (await (
      await f.app.request(`${f.base}/${result.id}`)
    ).json()) as RecurrenceSeriesDetailOut;
    expect(detail.occurrences).toHaveLength(1);
  });

  it('serializes concurrent creation with the same key', async () => {
    const f = await fixture();
    const responses = await Promise.all([f.request('simultaneous'), f.request('simultaneous')]);
    expect(responses.some((response) => response.status === 201)).toBe(true);
    expect(responses.every((response) => response.status === 201 || response.status === 409)).toBe(
      true,
    );
    const retry = await f.request('simultaneous');
    expect(retry.status).toBe(201);
    const series = await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.organizationId, f.org.orgId));
    expect(series).toHaveLength(1);
    const occurrences = await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.organizationId, f.org.orgId));
    expect(occurrences).toHaveLength(1);
  });

  it('rejects an empty key and validates input before claiming a receipt', async () => {
    const f = await fixture();
    expect((await f.request('')).status).toBe(422);
    expect(
      (await f.request('bad-input', { ...f.input, trigger: { kind: 'missing' } })).status,
    ).toBe(422);
    expect((await f.request('bad-input')).status).toBe(201);
  });

  it('checks current capability before replaying a completed receipt', async () => {
    const f = await fixture();
    expect((await f.request('revoked')).status).toBe(201);
    const viewer = await appWithAuthenticatedActor(
      schema.db,
      schema,
      f.router,
      f.org.orgId,
      ['view'],
      f.org.humanActorId,
    );
    const response = await viewer.request(f.base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'revoked' },
      body: JSON.stringify(f.input),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('Idempotency-Replayed')).toBeNull();
  });

  it('rechecks current private series access before replaying a completed receipt', async () => {
    const f = await fixture();
    const response = await f.request('archived-series');
    expect(response.status).toBe(201);
    const result = (await response.json()) as RecurrenceSeriesOut;
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ archivedAt: new Date() })
      .where(eq(schema.recurrenceSeries.id, result.id));
    expect((await f.request('archived-series')).status).toBe(404);
  });

  it('preserves 404 for a missing definition and releases the failed request key', async () => {
    const f = await fixture();
    const missing = { ...f.input, processDefinitionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' };
    expect((await f.request('missing-definition', missing)).status).toBe(404);
    expect((await f.request('missing-definition')).status).toBe(201);
  });

  it('preserves 404 for a private definition in another workspace', async () => {
    const f = await fixture();
    const other = await fixture();
    const privateDefinition = { ...f.input, processDefinitionId: other.input.processDefinitionId };
    const response = await f.request('private-definition', privateDefinition);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'not_found' });
    const series = await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.organizationId, f.org.orgId));
    expect(series).toHaveLength(0);
  });
});
