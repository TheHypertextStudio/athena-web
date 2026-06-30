import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as DrainModule from '../../src/routes/event-sync';
import { getDb, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepInboundEvents!: typeof DrainModule.sweepInboundEvents;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  sweepInboundEvents = (await import('../../src/routes/event-sync')).sweepInboundEvents;
});

let seq = 0;

/** Seed a Better Auth user + a human actor linked to it; returns both ids. */
async function seedUserActor(orgId: string): Promise<{ userId: string; actorId: string }> {
  seq += 1;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `ada-${String(seq)}@example.com` })
    .returning({ id: schema.user.id });
  const [a] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId: u!.id })
    .returning({ id: schema.actor.id });
  return { userId: u!.id, actorId: a!.id };
}

/** Seed a connected Linear integration owned by `actorId`. */
async function seedIntegration(orgId: string, actorId: string): Promise<string> {
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'linear',
      pattern: 'connector',
      roles: ['work'],
      connection: { externalWorkspaceId: 'ws' },
      status: 'connected',
      createdBy: actorId,
    })
    .returning({ id: schema.integration.id });
  return row!.id;
}

/** Insert a received inbound event carrying a fixture payload the mock observer normalizes. */
async function seedInboundEvent(
  orgId: string | null,
  integrationId: string | null,
  externalEventId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.inboundEvent).values({
    organizationId: orgId,
    integrationId,
    provider: 'linear',
    externalEventId,
    eventType: 'mock',
    payload,
    signatureVerified: true,
  });
}

describe('sweepInboundEvents (the event drain)', () => {
  it('normalizes a received event into a canonical event and fans it to the owner', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId, actorId } = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    await seedInboundEvent(orgId, intgId, 'ev_m1', {
      kind: 'mention',
      title: 'You were mentioned',
      id: 'x1',
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);

    const evs = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(evs).toHaveLength(1);
    expect(evs[0]!.kind).toBe('mention');
    expect(evs[0]!.sourceSystem).toBe('linear');
    expect(evs[0]!.userId).toBe(userId);
    expect(evs[0]!.entityKind).toBe('work_item');
    expect(evs[0]!.sourceEventId).not.toBeNull();

    const ev = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'ev_m1'));
    expect(ev[0]!.status).toBe('processed');

    // The mention reaches the integration owner's personal feed (event_recipient), reason 'mention'.
    const recips = await db
      .select()
      .from(schema.eventRecipient)
      .where(eq(schema.eventRecipient.userId, userId));
    expect(recips).toHaveLength(1);
    expect(recips[0]!.reason).toBe('mention');
  });

  it('is idempotent: a re-sweep neither reprocesses nor duplicates the event', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId } = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    await seedInboundEvent(orgId, intgId, 'ev_idem', {
      kind: 'comment',
      title: 'Commented',
      id: 'c1',
    });

    await sweepInboundEvents(new Date());
    const second = await sweepInboundEvents(new Date());
    // The first sweep marked the event processed, so the second finds nothing to claim here.
    expect(second.processed).toBe(0);

    const evs = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(evs).toHaveLength(1);
  });

  it('marks an unrouted event (no org) as skipped without creating an event', async () => {
    await seedInboundEvent(null, null, 'ev_unrouted', { kind: 'mention', title: 'x', id: 'u1' });

    await sweepInboundEvents(new Date());

    const ev = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'ev_unrouted'));
    expect(ev[0]!.status).toBe('skipped');
  });
});
