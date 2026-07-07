/**
 * `@docket/api` — the Discord ingestion edge: the type:1 PING→PONG handshake, a signed event
 * written to the write-ahead inbox, and a rejected signature. (Mock observer in test mode; the
 * Discord-specific Ed25519 verify/route/normalize logic is unit-tested in @docket/integrations.)
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

/** Headers the mock Discord observer accepts (any present x-signature-ed25519 except "invalid"). */
const SIGNED = {
  'content-type': 'application/json',
  'x-signature-ed25519': 'ok',
  'x-signature-timestamp': '1',
};

describe('POST /internal/ingest/discord', () => {
  it('answers the type:1 PING with a type:1 PONG', async () => {
    const res = await ingest.request('/discord', {
      method: 'POST',
      headers: SIGNED,
      body: JSON.stringify({ type: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('verifies + write-aheads a signed message event', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    // The mock observer routes by `organizationId` (defaulting to 'mock-workspace'); seed a
    // matching Discord integration so the event routes.
    await db.insert(schema.integration).values({
      organizationId: orgId,
      provider: 'discord',
      pattern: 'connector',
      roles: ['work'],
      connection: { externalWorkspaceId: 'mock-workspace' },
      status: 'connected',
      createdBy: humanActorId,
    });

    const res = await ingest.request('/discord', {
      method: 'POST',
      headers: SIGNED,
      body: JSON.stringify({
        organizationId: 'mock-workspace',
        externalEventId: 'ev_discord_1',
        t: 'MESSAGE_CREATE',
        d: { id: 'M1', channel_id: 'C1', guild_id: 'G1', content: 'hi @dani' },
        mentioned_user_ids: ['U2'],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, routed: true });

    const rows = await db
      .select({ provider: schema.inboundEvent.provider })
      .from(schema.inboundEvent)
      .where(
        and(
          eq(schema.inboundEvent.provider, 'discord'),
          eq(schema.inboundEvent.externalEventId, 'ev_discord_1'),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('rejects an invalid signature', async () => {
    const res = await ingest.request('/discord', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature-ed25519': 'invalid' },
      body: JSON.stringify({ type: 1 }),
    });
    expect(res.status).toBe(400);
  });
});
