/**
 * `@docket/api` — the mention-attribution seam in the drain: a mentioned external user (by their
 * native id) surfaces the mention for the Docket user who linked that identity, not just the
 * integration owner. Driven through the mock observer's `participants` fixture + a seeded Better
 * Auth `account` link (providerId = the source system, accountId = the external snowflake).
 */
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

/** Seed a Better Auth user + a human actor linked to it. */
async function seedUserActor(
  orgId: string,
  name: string,
): Promise<{ userId: string; actorId: string }> {
  seq += 1;
  const [u] = await db
    .insert(schema.user)
    .values({ name, email: `${name}-${String(seq)}@example.com` })
    .returning({ id: schema.user.id });
  const [a] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: name, userId: u!.id })
    .returning({ id: schema.actor.id });
  return { userId: u!.id, actorId: a!.id };
}

describe('sweepInboundEvents — mention attribution', () => {
  it('routes a Discord mention to the linked user, not just the integration owner', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const owner = await seedUserActor(orgId, 'owner');
    const mentioned = await seedUserActor(orgId, 'dani');

    // The mentioned user has linked their Discord identity (snowflake -> Docket user).
    await db.insert(schema.account).values({
      accountId: 'discord_snowflake_dani',
      providerId: 'discord',
      userId: mentioned.userId,
    });

    // A connected Discord integration owned by `owner` (the integration-owner fallback recipient).
    const [intg] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'discord',
        pattern: 'connector',
        roles: ['work'],
        connection: { externalWorkspaceId: 'guild_1' },
        status: 'connected',
        createdBy: owner.actorId,
      })
      .returning({ id: schema.integration.id });

    // A Discord mention naming the linked user (the mock observer honors `participants`).
    await db.insert(schema.inboundEvent).values({
      organizationId: orgId,
      integrationId: intg!.id,
      provider: 'discord',
      externalEventId: 'ev_discord_mention',
      eventType: 'MESSAGE_CREATE',
      payload: {
        kind: 'mention',
        title: 'Mentioned you in Discord',
        id: 'msg_1',
        participants: ['discord_snowflake_dani'],
      },
      signatureVerified: true,
    });

    const result = await sweepInboundEvents(new Date());
    expect(result.events).toBe(1);

    const [ev] = await db
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(eq(schema.event.organizationId, orgId));

    // The mentioned (linked) user gets a recipient row with reason 'mention'.
    const mentionedRecip = await db
      .select({ reason: schema.eventRecipient.reason })
      .from(schema.eventRecipient)
      .where(
        and(
          eq(schema.eventRecipient.eventId, ev!.id),
          eq(schema.eventRecipient.userId, mentioned.userId),
        ),
      );
    expect(mentionedRecip).toHaveLength(1);
    expect(mentionedRecip[0]!.reason).toBe('mention');
  });

  it('does not create a recipient for an unlinked mentioned user', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const owner = await seedUserActor(orgId, 'owner2');

    const [intg] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'discord',
        pattern: 'connector',
        roles: ['work'],
        connection: { externalWorkspaceId: 'guild_2' },
        status: 'connected',
        createdBy: owner.actorId,
      })
      .returning({ id: schema.integration.id });

    await db.insert(schema.inboundEvent).values({
      organizationId: orgId,
      integrationId: intg!.id,
      provider: 'discord',
      externalEventId: 'ev_discord_unlinked',
      eventType: 'MESSAGE_CREATE',
      payload: {
        kind: 'mention',
        title: 'Mentioned someone',
        id: 'msg_2',
        participants: ['discord_snowflake_nobody'],
      },
      signatureVerified: true,
    });

    await sweepInboundEvents(new Date());

    const [ev] = await db
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(eq(schema.event.organizationId, orgId));
    // Only the integration owner is a recipient; the unlinked snowflake resolves to nobody.
    const recips = await db
      .select({ userId: schema.eventRecipient.userId })
      .from(schema.eventRecipient)
      .where(eq(schema.eventRecipient.eventId, ev!.id));
    expect(recips.map((r) => r.userId)).toEqual([owner.userId]);
  });
});
