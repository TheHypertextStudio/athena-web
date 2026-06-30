/**
 * `@docket/api` — the proactive engine: a recent mention/assignment for an opted-in user drafts
 * an (approval-gated) agent session, idempotently (one per observation+user), and skips users
 * who haven't opted in.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as SweepModule from '../../src/routes/proactive-sweep';
import { getDb, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepProactiveSessions!: typeof SweepModule.sweepProactiveSessions;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  sweepProactiveSessions = (await import('../../src/routes/proactive-sweep')).sweepProactiveSessions;
});

let seq = 0;

async function seedUserActor(orgId: string, proactive: boolean): Promise<{ userId: string; actorId: string }> {
  seq += 1;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'P', email: `proactive-${String(seq)}@e.com` })
    .returning({ id: schema.user.id });
  await db
    .insert(schema.hub)
    .values({ userId: u!.id, preferences: proactive ? { proactive: { enabled: true } } : {} });
  const [a] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'P', userId: u!.id })
    .returning({ id: schema.actor.id });
  return { userId: u!.id, actorId: a!.id };
}

async function seedMention(orgId: string, userId: string, at: Date): Promise<string> {
  seq += 1;
  const [o] = await db
    .insert(schema.observation)
    .values({
      organizationId: orgId,
      provider: 'slack',
      kind: 'mention',
      occurredAt: at,
      title: 'You were mentioned in #eng',
      summary: 'can you review the fix?',
      dedupeKey: `pm-${String(seq)}`,
    })
    .returning({ id: schema.observation.id });
  await db.insert(schema.observationRecipient).values({
    observationId: o!.id,
    userId,
    organizationId: orgId,
    occurredAt: at,
    reason: 'mention',
  });
  return o!.id;
}

describe('sweepProactiveSessions', () => {
  it('drafts a session for an opted-in user’s recent mention, idempotently', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const user = await seedUserActor(orgId, true);
    const obsId = await seedMention(orgId, user.userId, new Date());

    const first = await sweepProactiveSessions(new Date());
    expect(first.created).toBeGreaterThanOrEqual(1);

    const sessions = await db
      .select({ trigger: schema.agentSession.trigger, ref: schema.agentSession.externalRunRef })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, `observation:${obsId}:${user.userId}`));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.trigger).toBe('mention');

    // Second sweep must not create a duplicate (external_run_ref dedup).
    const second = await sweepProactiveSessions(new Date());
    const after = await db
      .select({ id: schema.agentSession.id })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, `observation:${obsId}:${user.userId}`));
    expect(after).toHaveLength(1);
    expect(second.created).toBe(0);
  });

  it('skips users who have not opted into proactive', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const user = await seedUserActor(orgId, false);
    await seedMention(orgId, user.userId, new Date());

    await sweepProactiveSessions(new Date());
    const sessions = await db
      .select({ id: schema.agentSession.id })
      .from(schema.agentSession)
      .where(
        and(
          eq(schema.agentSession.organizationId, orgId),
          eq(schema.agentSession.trigger, 'mention'),
        ),
      );
    expect(sessions).toHaveLength(0);
  });
});
