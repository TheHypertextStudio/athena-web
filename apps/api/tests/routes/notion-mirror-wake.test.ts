import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import {
  applyNotionMirrorGeneration,
  captureNotionMirrorGeneration,
  failNotionMirrorGeneration,
  wakeNotionMirror,
} from '../../src/routes/notion-mirror-wake';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function seedNotionIntegration(): Promise<{
  integrationId: string;
  organizationId: string;
}> {
  const { orgId, humanActorId } = await seedBaseOrg(db, schema);
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'notion',
      pattern: 'connector',
      status: 'connected',
      createdBy: humanActorId,
      config: { notionMirror: { containerPageId: 'parent-1' } },
      syncCadenceMinutes: 15,
    })
    .returning({ id: schema.integration.id });
  if (!row) throw new Error('failed to seed Notion integration');
  return { integrationId: row.id, organizationId: orgId };
}

describe('Notion mirror wake generations', () => {
  it('creates one durable pending generation and increments it on every wake', async () => {
    const integration = await seedNotionIntegration();
    const first = await wakeNotionMirror({
      ...integration,
      now: new Date('2030-01-01T00:00:00.000Z'),
    });
    const second = await wakeNotionMirror({
      ...integration,
      now: new Date('2030-01-01T00:00:01.000Z'),
    });

    expect(first).toMatchObject({ desiredGeneration: 1, appliedGeneration: 0 });
    expect(second).toMatchObject({ desiredGeneration: 2, appliedGeneration: 0 });
    expect(second.nextAttemptAt).toEqual(new Date('2030-01-01T00:00:01.000Z'));
  });

  it('does not erase a wake that arrives while an earlier generation runs', async () => {
    const integration = await seedNotionIntegration();
    const running = await wakeNotionMirror({
      ...integration,
      now: new Date('2030-01-01T00:00:00.000Z'),
    });
    await wakeNotionMirror({
      ...integration,
      now: new Date('2030-01-01T00:00:01.000Z'),
    });

    await applyNotionMirrorGeneration({
      integrationId: integration.integrationId,
      generation: running.desiredGeneration,
      now: new Date('2030-01-01T00:00:02.000Z'),
    });

    const [state] = await db
      .select()
      .from(schema.notionMirrorState)
      .where(eq(schema.notionMirrorState.integrationId, integration.integrationId));
    expect(state).toMatchObject({
      desiredGeneration: 2,
      appliedGeneration: 1,
      nextAttemptAt: new Date('2030-01-01T00:00:01.000Z'),
      consecutiveFailures: 0,
      lastSuccessAt: new Date('2030-01-01T00:00:02.000Z'),
    });
  });

  it('keeps failed work pending and schedules bounded exponential retries', async () => {
    const integration = await seedNotionIntegration();
    await wakeNotionMirror({
      ...integration,
      now: new Date('2030-01-01T00:00:00.000Z'),
    });
    const captured = await captureNotionMirrorGeneration({
      ...integration,
      now: new Date('2030-01-01T00:00:01.000Z'),
    });
    expect(captured.desiredGeneration).toBe(1);

    const first = await failNotionMirrorGeneration({
      integrationId: integration.integrationId,
      now: new Date('2030-01-01T00:00:02.000Z'),
      kind: 'rate_limit',
      error: 'Notion asked Docket to slow down.',
    });
    const second = await failNotionMirrorGeneration({
      integrationId: integration.integrationId,
      now: new Date('2030-01-01T00:00:10.000Z'),
      kind: 'rate_limit',
      error: 'Notion asked Docket to slow down.',
    });

    expect(first).toMatchObject({
      desiredGeneration: 1,
      appliedGeneration: 0,
      consecutiveFailures: 1,
      nextAttemptAt: new Date('2030-01-01T00:00:07.000Z'),
    });
    expect(second).toMatchObject({
      consecutiveFailures: 2,
      nextAttemptAt: new Date('2030-01-01T00:00:20.000Z'),
      lastErrorKind: 'rate_limit',
      lastError: 'Notion asked Docket to slow down.',
    });
  });
});
