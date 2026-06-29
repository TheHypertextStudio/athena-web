import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let ingest!: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ingest = (await import('../../src/routes/ingest')).default;
});

/** A request with a (mock-accepted) signature header. */
const SIGNED = { 'content-type': 'application/json', 'linear-signature': 'sig-ok' };

/** Seed a connected Linear integration scoped to an external workspace; returns its id. */
async function seedLinearIntegration(orgId: string, actorId: string, ws: string): Promise<string> {
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'linear',
      pattern: 'connector',
      roles: ['work'],
      connection: { externalWorkspaceId: ws },
      status: 'connected',
      createdBy: actorId,
    })
    .returning({ id: schema.integration.id });
  return row!.id;
}

describe('POST /v1/ingest/linear', () => {
  it('verifies, routes to the integration, and write-aheads one inbound event', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const intgId = await seedLinearIntegration(orgId, humanActorId, 'ws_alpha');

    const res = await ingest.request('/linear', {
      method: 'POST',
      headers: SIGNED,
      body: JSON.stringify({
        type: 'Issue',
        organizationId: 'ws_alpha',
        id: 'iss_1',
        externalEventId: 'ev_1',
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, routed: true });

    const rows = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'ev_1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organizationId).toBe(orgId);
    expect(rows[0]!.integrationId).toBe(intgId);
    expect(rows[0]!.provider).toBe('linear');
    expect(rows[0]!.signatureVerified).toBe(true);
    expect(rows[0]!.status).toBe('received');
  });

  it('is idempotent against retries (dedup on provider + external event id)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedLinearIntegration(orgId, humanActorId, 'ws_beta');
    const body = JSON.stringify({
      type: 'Issue',
      organizationId: 'ws_beta',
      id: 'iss_2',
      externalEventId: 'ev_dup',
    });

    await ingest.request('/linear', { method: 'POST', headers: SIGNED, body });
    await ingest.request('/linear', { method: 'POST', headers: SIGNED, body });

    const rows = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'ev_dup'));
    expect(rows).toHaveLength(1);
  });

  it('400s a missing or invalid signature before any write', async () => {
    const res = await ingest.request('/linear', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'linear-signature': 'invalid' },
      body: '{"type":"Issue","externalEventId":"ev_bad"}',
    });
    expect(res.status).toBe(400);
    const rows = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'ev_bad'));
    expect(rows).toHaveLength(0);
  });

  it('acknowledges an event for an unknown workspace as unrouted (200)', async () => {
    const res = await ingest.request('/linear', {
      method: 'POST',
      headers: SIGNED,
      body: JSON.stringify({
        type: 'Issue',
        organizationId: 'ws_unknown',
        id: 'iss_3',
        externalEventId: 'ev_unrouted',
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, routed: false });

    const rows = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'ev_unrouted'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organizationId).toBeNull();
    expect(rows[0]!.integrationId).toBeNull();
  });

  it('400s an unparseable body', async () => {
    const res = await ingest.request('/linear', {
      method: 'POST',
      headers: SIGNED,
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});
