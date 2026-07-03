/**
 * `@docket/api` — the Slack half of the event drain: per-user relevance gating (noise control —
 * a message that concerns nobody creates no canonical event), mention/DM/thread routing into
 * `event_recipient`, and multi-user fan-out on one canonical event per org.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as DrainModule from '../../src/routes/event-sync';
import { getDb, one, seedBaseOrg, seedUserWithHub } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepInboundEvents!: typeof DrainModule.sweepInboundEvents;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  sweepInboundEvents = (await import('../../src/routes/event-sync')).sweepInboundEvents;
});

let seq = 0;

/** Seed a user + linked actor + connected Slack integration; returns user + integration ids. */
async function seedConnected(
  orgId: string,
  slackId: string,
): Promise<{ userId: string; integrationId: string }> {
  const userId = await seedUserWithHub(db, schema, `slack-${slackId}`);
  const a = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: slackId, userId })
      .returning({ id: schema.actor.id }),
  );
  const row = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'slack',
        pattern: 'connector',
        roles: ['signal'],
        status: 'connected',
        externalAccountId: slackId,
        connection: { externalWorkspaceId: 'T1' },
        createdBy: a.id,
      })
      .returning({ id: schema.integration.id }),
  );
  return { userId, integrationId: row.id };
}

/** Insert a received Slack inbound event around one message; returns its externalEventId. */
async function seedSlackInbound(
  orgId: string,
  integrationId: string,
  event: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<string> {
  seq += 1;
  const externalEventId = `ev_slack_drain_${String(seq)}`;
  await db.insert(schema.inboundEvent).values({
    organizationId: orgId,
    integrationId,
    provider: 'slack',
    externalEventId,
    eventType: 'message',
    // The mock observer reads top-level kind/title/externalEventId; the relevance resolver
    // reads team_id + the inner event — one payload serves both.
    payload: {
      type: 'event_callback',
      team_id: 'T1',
      kind: 'message',
      title: 'Slack message',
      externalEventId,
      event,
      ...extra,
    },
    signatureVerified: true,
  });
  return externalEventId;
}

/** The inbound row's status after the sweep. */
async function inboundStatus(externalEventId: string): Promise<string> {
  const row = one(
    await db
      .select({ status: schema.inboundEvent.status })
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, externalEventId)),
  );
  return row.status;
}

describe('sweepInboundEvents — Slack relevance gating', () => {
  it('routes a mention to the mentioned connected user and creates one event', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const a = await seedConnected(orgId, 'UAAA1');
    const b = await seedConnected(orgId, 'UBBB2');
    const extId = await seedSlackInbound(orgId, a.integrationId, {
      type: 'message',
      channel: 'C1',
      channel_type: 'channel',
      user: 'UAAA1',
      text: 'ping <@UBBB2>',
      ts: '100.1',
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);
    expect(await inboundStatus(extId)).toBe('processed');

    const evs = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(evs).toHaveLength(1);
    expect(evs[0]!.sourceSystem).toBe('slack');

    const recips = await db
      .select()
      .from(schema.eventRecipient)
      .where(eq(schema.eventRecipient.eventId, evs[0]!.id));
    expect(recips).toHaveLength(1);
    expect(recips[0]!.userId).toBe(b.userId);
    expect(recips[0]!.reason).toBe('mention');
    // The author (integration owner) is NOT fanned the whole workspace's traffic.
    expect(recips.some((r) => r.userId === a.userId)).toBe(false);
  });

  it('creates NO event for a message that concerns nobody, but remembers participation', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const a = await seedConnected(orgId, 'UAAA1');
    const extId = await seedSlackInbound(orgId, a.integrationId, {
      type: 'message',
      channel: 'C2',
      channel_type: 'channel',
      user: 'UAAA1',
      text: 'just chatting, no mentions',
      ts: '200.1',
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(0);
    expect(await inboundStatus(extId)).toBe('skipped');

    const evs = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(evs).toHaveLength(0);
    // …but the connected author's participation in (channel C2, thread 200.1) is remembered.
    const parts = await db
      .select()
      .from(schema.threadParticipation)
      .where(eq(schema.threadParticipation.organizationId, orgId));
    expect(parts).toHaveLength(1);
    expect(parts[0]!.externalUserId).toBe('UAAA1');
    expect(parts[0]!.threadTs).toBe('200.1');
  });

  it('routes a later reply in a thread the user posted in as participant relevance', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const a = await seedConnected(orgId, 'UAAA1');
    // Root message by the connected user — skipped as an event, but participation recorded.
    await seedSlackInbound(orgId, a.integrationId, {
      type: 'message',
      channel: 'C3',
      channel_type: 'channel',
      user: 'UAAA1',
      text: 'thread root',
      ts: '300.1',
    });
    await sweepInboundEvents(new Date());

    // An unconnected user replies in that thread.
    const replyId = await seedSlackInbound(orgId, a.integrationId, {
      type: 'message',
      channel: 'C3',
      channel_type: 'channel',
      user: 'UZZZ9',
      text: 'reply to you',
      ts: '301.1',
      thread_ts: '300.1',
    });
    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);
    expect(await inboundStatus(replyId)).toBe('processed');

    const evs = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(evs).toHaveLength(1);
    const recips = await db
      .select()
      .from(schema.eventRecipient)
      .where(eq(schema.eventRecipient.eventId, evs[0]!.id));
    expect(recips).toHaveLength(1);
    expect(recips[0]!.userId).toBe(a.userId);
    expect(recips[0]!.reason).toBe('participant');
  });

  it('routes a DM to the sole connected non-author', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const a = await seedConnected(orgId, 'UAAA1');
    await seedSlackInbound(orgId, a.integrationId, {
      type: 'message',
      channel: 'D1',
      channel_type: 'im',
      user: 'UZZZ9',
      text: 'direct to you',
      ts: '400.1',
    });
    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);
    const recips = await db
      .select()
      .from(schema.eventRecipient)
      .where(eq(schema.eventRecipient.organizationId, orgId));
    expect(recips).toHaveLength(1);
    expect(recips[0]!.userId).toBe(a.userId);
    expect(recips[0]!.reason).toBe('mention');
  });

  it('fans one canonical event out to several mentioned connected users', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const a = await seedConnected(orgId, 'UAAA1');
    const b = await seedConnected(orgId, 'UBBB2');
    await seedSlackInbound(orgId, a.integrationId, {
      type: 'message',
      channel: 'C4',
      channel_type: 'channel',
      user: 'UZZZ9',
      text: 'both of you: <@UAAA1> <@UBBB2>',
      ts: '500.1',
    });
    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);
    const evs = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(evs).toHaveLength(1);
    const recips = await db
      .select()
      .from(schema.eventRecipient)
      .where(eq(schema.eventRecipient.eventId, evs[0]!.id));
    expect(new Set(recips.map((r) => r.userId))).toEqual(new Set([a.userId, b.userId]));
    expect(recips.every((r) => r.reason === 'mention')).toBe(true);
  });
});
