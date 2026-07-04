/**
 * `@docket/api` — the token-routed Discord edge: the Gateway relay forwards messages here,
 * authenticated + org-routed by the per-integration `event_subscription.ingestToken` (no Ed25519).
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

const JSON_HEADERS = { 'content-type': 'application/json' };

async function seedTokenedIntegration(token: string): Promise<string> {
  const { orgId, humanActorId } = await seedBaseOrg(db, schema);
  const [intg] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'discord',
      pattern: 'connector',
      roles: ['work'],
      connection: { externalWorkspaceId: 'guild_relay' },
      status: 'connected',
      createdBy: humanActorId,
    })
    .returning({ id: schema.integration.id });
  await db.insert(schema.eventSubscription).values({
    organizationId: orgId,
    integrationId: intg!.id,
    provider: 'discord',
    ingestToken: token,
    status: 'active',
    createdBy: humanActorId,
  });
  return orgId;
}

describe('POST /internal/ingest/discord/:token', () => {
  it('routes a relay-forwarded message by its ingest token (no signature)', async () => {
    await seedTokenedIntegration('tok_relay_ok');

    const res = await ingest.request('/discord/tok_relay_ok', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        externalEventId: 'ev_relay_1',
        t: 'MESSAGE_CREATE',
        d: { id: 'M1', channel_id: 'C1', guild_id: 'guild_relay', content: 'hi @dani' },
        mentioned_user_ids: ['U2'],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, routed: true });

    const rows = await db
      .select({ id: schema.inboundEvent.id })
      .from(schema.inboundEvent)
      .where(
        and(
          eq(schema.inboundEvent.provider, 'discord'),
          eq(schema.inboundEvent.externalEventId, 'ev_relay_1'),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('rejects an unknown ingest token with 401', async () => {
    const res = await ingest.request('/discord/tok_does_not_exist', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ externalEventId: 'ev_x', t: 'MESSAGE_CREATE', d: { id: 'M9' } }),
    });
    expect(res.status).toBe(401);
  });
});
