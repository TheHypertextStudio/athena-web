import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as EmitModule from '../../src/routes/event-emit';
import { getDb, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let emitEvent!: typeof EmitModule.emitEvent;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  emitEvent = (await import('../../src/routes/event-emit')).emitEvent;
});

let seq = 0;

/** Seed a Better Auth user + linked human actor; returns both ids. */
async function seedUserActor(orgId: string): Promise<{ userId: string; actorId: string }> {
  seq += 1;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'U', email: `u-${String(seq)}@example.com` })
    .returning({ id: schema.user.id });
  const [a] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'U', userId: u!.id })
    .returning({ id: schema.actor.id });
  return { userId: u!.id, actorId: a!.id };
}

async function seedTask(
  orgId: string,
  teamId: string,
  assigneeId: string,
  createdBy: string,
): Promise<string> {
  const [t] = await db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      title: 'Ship the beta',
      teamId,
      state: 'in_progress',
      assigneeId,
      createdBy,
    })
    .returning({ id: schema.task.id });
  return t!.id;
}

async function recipients(eventId: string): Promise<{ userId: string; reason: string }[]> {
  return db
    .select({ userId: schema.eventRecipient.userId, reason: schema.eventRecipient.reason })
    .from(schema.eventRecipient)
    .where(eq(schema.eventRecipient.eventId, eventId));
}

describe('emitEvent', () => {
  it('writes a docket event and fans out to the assignee (owned), excluding the actor', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const assignee = await seedUserActor(orgId);
    const acting = await seedUserActor(orgId);
    const taskId = await seedTask(orgId, teamId, assignee.actorId, acting.actorId);
    const at = new Date('2026-06-29T12:00:00.000Z');

    await emitEvent({
      organizationId: orgId,
      kind: 'status_change',
      occurredAt: at,
      title: 'Ship the beta moved to In Review',
      actorId: acting.actorId,
      subject: { type: 'task', id: taskId, title: 'Ship the beta' },
    });

    const evs = await db
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.sourceSystem, 'docket')));
    expect(evs).toHaveLength(1);
    expect(evs[0]!.kind).toBe('status_change');
    expect(evs[0]!.entity?.externalId).toBe(taskId);

    const recips = await recipients(evs[0]!.id);
    expect(recips).toEqual([{ userId: assignee.userId, reason: 'owned' }]);
  });

  it('is idempotent on the same (subject, kind, occurredAt)', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const assignee = await seedUserActor(orgId);
    const acting = await seedUserActor(orgId);
    const taskId = await seedTask(orgId, teamId, assignee.actorId, acting.actorId);
    const at = new Date('2026-06-29T13:00:00.000Z');
    const input = {
      organizationId: orgId,
      kind: 'status_change' as const,
      occurredAt: at,
      title: 'again',
      actorId: acting.actorId,
      subject: { type: 'task', id: taskId },
    };

    await emitEvent(input);
    await emitEvent(input);

    const evs = await db
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.sourceSystem, 'docket')));
    expect(evs).toHaveLength(1);
    expect(await recipients(evs[0]!.id)).toHaveLength(1);
  });

  it("labels an assignee 'assignment' on an assignment event", async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const assignee = await seedUserActor(orgId);
    const acting = await seedUserActor(orgId);
    const taskId = await seedTask(orgId, teamId, assignee.actorId, acting.actorId);

    await emitEvent({
      organizationId: orgId,
      kind: 'assignment',
      occurredAt: new Date('2026-06-29T14:00:00.000Z'),
      title: 'assigned',
      actorId: acting.actorId,
      subject: { type: 'task', id: taskId },
    });

    const [ev] = await db
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'assignment')));
    expect((await recipients(ev!.id))[0]).toEqual({
      userId: assignee.userId,
      reason: 'assignment',
    });
  });

  it('excludes the acting user but still reaches other owners (creator)', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const assignee = await seedUserActor(orgId);
    const creator = await seedUserActor(orgId);
    const taskId = await seedTask(orgId, teamId, assignee.actorId, creator.actorId);

    // The assignee themselves makes the change → assignee excluded, creator still notified.
    await emitEvent({
      organizationId: orgId,
      kind: 'status_change',
      occurredAt: new Date('2026-06-29T15:00:00.000Z'),
      title: 'self change',
      actorId: assignee.actorId,
      subject: { type: 'task', id: taskId },
    });

    const [ev] = await db
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.title, 'self change')));
    const recips = await recipients(ev!.id);
    expect(recips).toEqual([{ userId: creator.userId, reason: 'owned' }]);
  });
});
