/**
 * `@docket/api` — the Slack ingestion edge: the url_verification handshake, a signed event
 * written to the write-ahead inbox, and a rejected signature. (Mock observer in test mode; the
 * Slack-specific verify/route/normalize logic is unit-tested in @docket/integrations.)
 */
import { and, eq } from 'drizzle-orm';
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

/** Headers the mock Slack observer accepts (any present x-slack-signature except "invalid"). */
const SIGNED = { 'content-type': 'application/json', 'x-slack-signature': 'v0=ok' };

describe('POST /internal/ingest/slack', () => {
  it('echoes the url_verification challenge', async () => {
    const res = await ingest.request('/slack', {
      method: 'POST',
      headers: SIGNED,
      body: JSON.stringify({ type: 'url_verification', challenge: 'chal_123' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'chal_123' });
  });

  it('verifies + write-aheads a signed event', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    // The mock observer routes by `organizationId` (defaulting to 'mock-workspace'); seed a
    // matching Slack integration so the event routes.
    await db.insert(schema.integration).values({
      organizationId: orgId,
      provider: 'slack',
      pattern: 'connector',
      roles: ['work'],
      connection: { externalWorkspaceId: 'mock-workspace' },
      status: 'connected',
      createdBy: humanActorId,
    });

    const res = await ingest.request('/slack', {
      method: 'POST',
      headers: SIGNED,
      body: JSON.stringify({
        type: 'event_callback',
        externalEventId: 'ev_slack_1',
        event: { type: 'app_mention', user: 'U1', channel: 'C1', text: 'hi' },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, routed: true });

    // Slack deliveries write one row per routed org, dedup-keyed `<event_id>:<orgId>`.
    const rows = await db
      .select({ organizationId: schema.inboundEvent.organizationId })
      .from(schema.inboundEvent)
      .where(
        and(
          eq(schema.inboundEvent.provider, 'slack'),
          eq(schema.inboundEvent.externalEventId, `ev_slack_1:${orgId}`),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organizationId).toBe(orgId);
  });

  it('fans one delivery out to every org connected to the workspace', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    for (const { orgId, humanActorId } of [a, b]) {
      await db.insert(schema.integration).values({
        organizationId: orgId,
        provider: 'slack',
        pattern: 'connector',
        roles: ['signal'],
        connection: { externalWorkspaceId: 'mock-workspace' },
        status: 'connected',
        createdBy: humanActorId,
      });
    }

    const res = await ingest.request('/slack', {
      method: 'POST',
      headers: SIGNED,
      body: JSON.stringify({
        type: 'event_callback',
        externalEventId: 'ev_slack_2',
        event: { type: 'message', user: 'U1', channel: 'C1', text: 'hi' },
      }),
    });
    expect(await res.json()).toEqual({ received: true, routed: true });

    for (const { orgId } of [a, b]) {
      const rows = await db
        .select({ organizationId: schema.inboundEvent.organizationId })
        .from(schema.inboundEvent)
        .where(eq(schema.inboundEvent.externalEventId, `ev_slack_2:${orgId}`));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.organizationId).toBe(orgId);
    }

    // A retry of the same delivery is a per-org no-op (unique (provider, external_event_id)).
    await ingest.request('/slack', {
      method: 'POST',
      headers: SIGNED,
      body: JSON.stringify({
        type: 'event_callback',
        externalEventId: 'ev_slack_2',
        event: { type: 'message', user: 'U1', channel: 'C1', text: 'hi' },
      }),
    });
    const afterRetry = await db
      .select({ id: schema.inboundEvent.id })
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, `ev_slack_2:${a.orgId}`));
    expect(afterRetry).toHaveLength(1);
  });

  it('rejects an invalid signature', async () => {
    const res = await ingest.request('/slack', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-slack-signature': 'invalid' },
      body: JSON.stringify({ type: 'event_callback', event: { type: 'message' } }),
    });
    expect(res.status).toBe(400);
  });
});
