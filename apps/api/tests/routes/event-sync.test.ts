import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as DrainModule from '../../src/routes/event-sync';
import { getDb, seedBaseOrg } from '../support/routes-harness';

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
  eventType = 'mock',
): Promise<void> {
  await db.insert(schema.inboundEvent).values({
    organizationId: orgId,
    integrationId,
    provider: 'linear',
    externalEventId,
    eventType,
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

  it('reconciles a Linear Issue webhook into native Docket tasks during the drain', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId } = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    await seedInboundEvent(
      orgId,
      intgId,
      'ev_issue_sync',
      { kind: 'status_change', title: 'Issue changed', id: 'iss-live' },
      'Issue',
    );

    await sweepInboundEvents(new Date());

    const mirrored = await db
      .select({ source: schema.task.source, integrationId: schema.task.sourceIntegrationId })
      .from(schema.task)
      .where(eq(schema.task.sourceIntegrationId, intgId));
    expect(mirrored.length).toBeGreaterThan(0);
    expect(mirrored.every((task) => task.source === 'linked')).toBe(true);
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

  it('marks an event with an unrecognized provider as skipped (source resolves to null)', async () => {
    await db.insert(schema.inboundEvent).values({
      organizationId: null,
      integrationId: null,
      provider: 'not-a-real-provider',
      externalEventId: 'ev_unknown_provider',
      eventType: 'mock',
      payload: { kind: 'mention', title: 'x', id: 'up1' },
      signatureVerified: true,
    });

    await sweepInboundEvents(new Date());

    const ev = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'ev_unknown_provider'));
    expect(ev[0]!.status).toBe('skipped');
  });

  it('reuses the cached observer and owner across two events for the same integration in one sweep', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId, actorId } = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    await seedInboundEvent(orgId, intgId, 'ev_cache_1', {
      kind: 'comment',
      title: 'First',
      id: 'c-cache-1',
    });
    await seedInboundEvent(orgId, intgId, 'ev_cache_2', {
      kind: 'comment',
      title: 'Second',
      id: 'c-cache-2',
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(2);

    const evs = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(evs).toHaveLength(2);
    expect(evs.every((e) => e.userId === userId)).toBe(true);
    expect(evs.every((e) => e.sourceSystem === 'linear')).toBe(true);
  });

  it('falls back to a null owner when the integration has no createdBy actor', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'linear',
        pattern: 'connector',
        roles: ['work'],
        connection: { externalWorkspaceId: 'ws-no-owner' },
        status: 'connected',
        createdBy: null,
      })
      .returning({ id: schema.integration.id });
    await seedInboundEvent(orgId, row!.id, 'ev_no_owner', {
      kind: 'comment',
      title: 'No owner',
      id: 'no-owner-1',
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);

    const [ev] = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(ev!.userId).toBeNull();
  });

  it('creates the event with a null owner when the inbound row carries no integrationId', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    await seedInboundEvent(orgId, null, 'ev_no_integration', {
      kind: 'comment',
      title: 'No integration',
      id: 'no-intg-1',
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);

    const [ev] = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(ev!.userId).toBeNull();
    expect(ev!.integrationId).toBeNull();
  });

  it('leaves entity and entityKind null for a draft fixture with no `id` (no entity)', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId } = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    await seedInboundEvent(orgId, intgId, 'ev_no_entity', {
      kind: 'comment',
      title: 'No entity here',
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);

    const [ev] = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(ev!.entity).toBeNull();
    expect(ev!.entityKind).toBeNull();
  });

  it('skips the Linear-Issue reconcile for an integration that is not connected, but still records the activity event', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId } = await seedUserActor(orgId);
    const [row] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'linear',
        pattern: 'connector',
        roles: ['work'],
        connection: { externalWorkspaceId: 'ws-pending' },
        status: 'pending',
        createdBy: actorId,
      })
      .returning({ id: schema.integration.id });
    await seedInboundEvent(
      orgId,
      row!.id,
      'ev_issue_pending',
      { kind: 'status_change', title: 'Issue changed', id: 'iss-pending' },
      'Issue',
    );

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);

    // No task mirrored — the integration was never connected, so the reconcile call is skipped.
    const mirrored = await db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(eq(schema.task.sourceIntegrationId, row!.id));
    expect(mirrored).toHaveLength(0);

    const ev = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'ev_issue_pending'));
    expect(ev[0]!.status).toBe('processed');
  });

  it('is a no-op (never inserts, never crashes) when two events collide on the same dedupeKey in one sweep', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId } = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    // Two distinct webhook deliveries (different inbound_event rows) whose payload both carry
    // `id: 'shared-content-id'` normalize to the SAME dedupeKey — modeling a retried delivery
    // landing as a second inbound_event row rather than a re-sweep of the same one.
    await seedInboundEvent(orgId, intgId, 'ev_dup_a', {
      kind: 'comment',
      title: 'Delivery A',
      id: 'shared-content-id',
    });
    await seedInboundEvent(orgId, intgId, 'ev_dup_b', {
      kind: 'comment',
      title: 'Delivery B',
      id: 'shared-content-id',
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.processed).toBe(2);
    expect(result.events).toBe(1); // only one canonical event survives onConflictDoNothing
    expect(result.failed).toBe(0);

    const evs = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
    expect(evs).toHaveLength(1);

    const rows = await db
      .select({ status: schema.inboundEvent.status })
      .from(schema.inboundEvent)
      .where(
        and(
          eq(schema.inboundEvent.organizationId, orgId),
          eq(schema.inboundEvent.integrationId, intgId),
        ),
      );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'processed')).toBe(true);
  });

  it("attributes a non-mention event's linked participant with reason 'participant'", async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const owner = await seedUserActor(orgId);
    const participantUser = await seedUserActor(orgId);
    await db.insert(schema.account).values({
      accountId: 'linear_user_participant',
      providerId: 'linear',
      userId: participantUser.userId,
    });
    const intgId = await seedIntegration(orgId, owner.actorId);
    await seedInboundEvent(orgId, intgId, 'ev_participant', {
      kind: 'status_change',
      title: 'Status changed',
      id: 'status-1',
      participants: ['linear_user_participant'],
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);

    const [ev] = await db
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(eq(schema.event.organizationId, orgId));
    const recip = await db
      .select({ reason: schema.eventRecipient.reason })
      .from(schema.eventRecipient)
      .where(
        and(
          eq(schema.eventRecipient.eventId, ev!.id),
          eq(schema.eventRecipient.userId, participantUser.userId),
        ),
      );
    expect(recip).toHaveLength(1);
    expect(recip[0]!.reason).toBe('participant');
  });

  it('leaves entity.title null when the fixture supplies an id but no title', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId } = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    // `id` is present (so a work_item entity exists) but `title` is absent — the entity has no
    // title field at all, distinct from the "no entity" case covered elsewhere.
    await seedInboundEvent(orgId, intgId, 'ev_entity_no_title', {
      kind: 'comment',
      id: 'entity-no-title-1',
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);

    const [ev] = await db
      .select({ entity: schema.event.entity })
      .from(schema.event)
      .where(eq(schema.event.organizationId, orgId));
    expect(ev!.entity).not.toBeNull();
    expect(ev!.entity?.title).toBeNull();
  });

  it('marks an inbound event failed (with the real error) when normalizing it throws', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId } = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    // An unparseable `occurredAt` becomes an `Invalid Date`, which throws when the insert
    // serializes it — a realistic malformed-webhook-payload failure, not a fabricated one.
    await seedInboundEvent(orgId, intgId, 'ev_bad_date', {
      kind: 'comment',
      title: 'Bad timestamp',
      id: 'bad-date-1',
      occurredAt: 'not-a-real-timestamp',
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.failed).toBe(1);
    expect(result.events).toBe(0);

    const [ev] = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'ev_bad_date'));
    expect(ev!.status).toBe('failed');
    expect(ev!.attempts).toBe(1);
    expect(ev!.lastError).toBeTruthy();
  });
});
