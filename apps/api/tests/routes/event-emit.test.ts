import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as EmitModule from '../../src/routes/event-emit';
import { getDb, seedBaseOrg } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let emitEvent!: typeof EmitModule.emitEvent;
let emitTimerEvent!: typeof EmitModule.emitTimerEvent;
let emitFieldChange!: typeof EmitModule.emitFieldChange;
let emitElicitationEvent!: typeof EmitModule.emitElicitationEvent;
let emitAgentMilestone!: typeof EmitModule.emitAgentMilestone;
let emitInboundEmail!: typeof EmitModule.emitInboundEmail;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/event-emit');
  emitEvent = mod.emitEvent;
  emitTimerEvent = mod.emitTimerEvent;
  emitFieldChange = mod.emitFieldChange;
  emitElicitationEvent = mod.emitElicitationEvent;
  emitAgentMilestone = mod.emitAgentMilestone;
  emitInboundEmail = mod.emitInboundEmail;
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
    .values({ organizationId: orgId, kind: 'human', displayName: 'U', userId: assertDefined(u).id })
    .returning({ id: schema.actor.id });
  return { userId: assertDefined(u).id, actorId: assertDefined(a).id };
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
  return assertDefined(t).id;
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
    expect(assertDefined(evs[0]).kind).toBe('status_change');
    expect(assertDefined(evs[0]).entity?.externalId).toBe(taskId);

    const recips = await recipients(assertDefined(evs[0]).id);
    expect(recips).toEqual([{ userId: assignee.userId, reason: 'owned' }]);

    const searchJobs = await db
      .select({
        sourceTable: schema.searchIndexJob.sourceTable,
        entityId: schema.searchIndexJob.entityId,
        reason: schema.searchIndexJob.reason,
        sourceEventId: schema.searchIndexJob.sourceEventId,
      })
      .from(schema.searchIndexJob)
      .where(eq(schema.searchIndexJob.sourceEventId, assertDefined(evs[0]).id));
    expect(searchJobs).toEqual(
      expect.arrayContaining([
        {
          sourceTable: 'event',
          entityId: assertDefined(evs[0]).id,
          reason: 'event_log',
          sourceEventId: assertDefined(evs[0]).id,
        },
        {
          sourceTable: 'task',
          entityId: taskId,
          reason: 'event_log',
          sourceEventId: assertDefined(evs[0]).id,
        },
      ]),
    );
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
    expect(await recipients(assertDefined(evs[0]).id)).toHaveLength(1);
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
    expect((await recipients(assertDefined(ev).id))[0]).toEqual({
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
    const recips = await recipients(assertDefined(ev).id);
    expect(recips).toEqual([{ userId: creator.userId, reason: 'owned' }]);
  });
});

describe('typed producers', () => {
  it('keeps a timer transition on the tracked task but out of its owners’ feeds', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const owner = await seedUserActor(orgId);
    const tracker = await seedUserActor(orgId);
    const taskId = await seedTask(orgId, teamId, owner.actorId, owner.actorId);

    await emitTimerEvent({
      organizationId: orgId,
      kind: 'timer_started',
      userId: tracker.userId,
      actorId: tracker.actorId,
      occurredAt: new Date('2026-08-02T09:00:00.000Z'),
      tracked: { type: 'task', id: taskId, title: 'Ship the beta' },
      timeRecordId: 'tr_1',
      elapsedMs: 0,
      trackedLabel: 'Ship the beta',
    });

    const [ev] = await db
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'timer_started')));
    // The task still carries the event, so its own history reads correctly …
    expect(assertDefined(ev).entity?.externalId).toBe(taskId);
    expect(assertDefined(ev).detail).toMatchObject({
      schema: 'docket.timer',
      timeRecordId: 'tr_1',
    });
    // … but the task's assignee/creator hears nothing about someone else's stopwatch.
    expect(await recipients(assertDefined(ev).id)).toEqual([
      { userId: tracker.userId, reason: 'owned' },
    ]);
  });

  it('records freeform tracking with no canonical subject rather than dropping it', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const tracker = await seedUserActor(orgId);

    await emitTimerEvent({
      organizationId: orgId,
      kind: 'timer_stopped',
      userId: tracker.userId,
      actorId: tracker.actorId,
      occurredAt: new Date('2026-08-02T09:30:00.000Z'),
      timeRecordId: 'tr_free',
      elapsedMs: 900_000,
      trackedLabel: 'Reading email',
    });

    const [ev] = await db
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'timer_stopped')));
    expect(assertDefined(ev).title).toBe('Stopped tracking Reading email');
    expect(assertDefined(ev).entity).toBeNull();
    expect(assertDefined(ev).entityKind).toBeNull();
  });

  it('gives every timer transition its own verb and its own sentence', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const tracker = await seedUserActor(orgId);
    const transitions = [
      ['timer_started', 'Started tracking Ship the beta'],
      ['timer_paused', 'Paused tracking Ship the beta'],
      ['timer_resumed', 'Resumed tracking Ship the beta'],
      ['timer_switched', 'Switched tracking to Ship the beta'],
      ['timer_stopped', 'Stopped tracking Ship the beta'],
    ] as const;

    for (const [index, [kind]] of transitions.entries()) {
      await emitTimerEvent({
        organizationId: orgId,
        kind,
        userId: tracker.userId,
        actorId: tracker.actorId,
        occurredAt: new Date(Date.UTC(2026, 7, 2, 14, index)),
        timeRecordId: 'tr_walk',
        // A switch names the record it left, so elapsed time is never counted twice.
        ...(kind === 'timer_switched' && { previousTimeRecordId: 'tr_prev' }),
        elapsedMs: index * 1000,
        trackedLabel: 'Ship the beta',
      });
    }

    const rows = await db
      .select({ kind: schema.event.kind, title: schema.event.title, detail: schema.event.detail })
      .from(schema.event)
      .where(eq(schema.event.organizationId, orgId));
    expect(rows).toHaveLength(transitions.length);
    for (const [kind, title] of transitions) {
      expect(rows.find((r) => r.kind === kind)?.title).toBe(title);
    }
    expect(rows.find((r) => r.kind === 'timer_switched')?.detail).toMatchObject({
      previousTimeRecordId: 'tr_prev',
    });
  });

  it('carries a whole multi-field edit as one event, and keeps two edits in one millisecond apart', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const owner = await seedUserActor(orgId);
    const editor = await seedUserActor(orgId);
    const taskId = await seedTask(orgId, teamId, owner.actorId, owner.actorId);
    const at = new Date('2026-08-02T10:00:00.000Z');
    const subject = { type: 'task', id: taskId, title: 'Ship the beta' };

    await emitFieldChange({
      organizationId: orgId,
      subject,
      actorId: editor.actorId,
      occurredAt: at,
      changes: [
        { field: 'dueDate', label: 'Due', from: null, to: 'Aug 14' },
        { field: 'projectId', label: 'Project', from: 'Inbox', to: 'Website redesign' },
      ],
    });
    await emitFieldChange({
      organizationId: orgId,
      subject,
      actorId: editor.actorId,
      occurredAt: at,
      changes: [{ field: 'priority', label: 'Priority', from: 'Medium', to: 'High' }],
    });

    const evs = await db
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'field_change')));
    // Two fields moving in one mutation is ONE event — not one per field …
    expect(evs).toHaveLength(2);
    const multi = evs.find((e) => e.summary === 'Due, Project');
    expect(assertDefined(multi).detail).toMatchObject({
      schema: 'docket.field_change',
      fields: ['dueDate', 'projectId'],
    });
    // … and the owner learns their task changed.
    expect(await recipients(assertDefined(multi).id)).toEqual([
      { userId: owner.userId, reason: 'owned' },
    ]);
  });

  it('says nothing when nothing moved, and names the fields when the subject has no title', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const editor = await seedUserActor(orgId);
    const subject = { type: 'project', id: 'proj_untitled' };

    await emitFieldChange({
      organizationId: orgId,
      subject,
      actorId: editor.actorId,
      occurredAt: new Date('2026-08-02T15:00:00.000Z'),
      changes: [],
    });
    await emitFieldChange({
      organizationId: orgId,
      subject,
      actorId: editor.actorId,
      occurredAt: new Date('2026-08-02T15:01:00.000Z'),
      changes: [{ field: 'health', label: 'Health', from: 'On track', to: 'At risk' }],
    });

    const evs = await db
      .select({ title: schema.event.title })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'field_change')));
    // An empty change set is a no-op, not an empty feed line.
    expect(evs).toEqual([{ title: 'Health' }]);
  });

  it('collapses the identical edit emitted twice', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const owner = await seedUserActor(orgId);
    const taskId = await seedTask(orgId, teamId, owner.actorId, owner.actorId);
    const input = {
      organizationId: orgId,
      subject: { type: 'task', id: taskId, title: 'Ship the beta' },
      actorId: owner.actorId,
      occurredAt: new Date('2026-08-02T10:05:00.000Z'),
      changes: [{ field: 'dueDate', label: 'Due', from: null, to: 'Aug 14' }],
    };

    await emitFieldChange(input);
    await emitFieldChange(input);

    const evs = await db
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'field_change')));
    expect(evs).toHaveLength(1);
  });

  it('puts an open question in front of the person being asked, even when they are the actor', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const asked = await seedUserActor(orgId);

    // The agent acts as this user's own Athena: same underlying user, so ordinary routing
    // would self-exclude them and the question would reach nobody.
    await emitElicitationEvent({
      organizationId: orgId,
      kind: 'elicitation_requested',
      sessionId: 'sess_1',
      elicitationId: 'sa_1',
      askedUserId: asked.userId,
      agentActorId: asked.actorId,
      occurredAt: new Date('2026-08-02T11:00:00.000Z'),
      question: 'Which workspace should this land in?',
    });

    const [ev] = await db
      .select()
      .from(schema.event)
      .where(
        and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'elicitation_requested')),
      );
    expect(assertDefined(ev).entityKind).toBe('agent_session');
    expect(await recipients(assertDefined(ev).id)).toEqual([
      { userId: asked.userId, reason: 'awaiting_you' },
    ]);
  });

  it('records an expiry as actorless, so a timeout can never read as a human decision', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const asked = await seedUserActor(orgId);

    await emitElicitationEvent({
      organizationId: orgId,
      kind: 'elicitation_expired',
      sessionId: 'sess_2',
      elicitationId: 'sa_2',
      askedUserId: asked.userId,
      agentActorId: asked.actorId,
      occurredAt: new Date('2026-08-02T11:30:00.000Z'),
      question: 'Which workspace should this land in?',
      autoResolvedValue: 'Acme',
    });

    const [ev] = await db
      .select()
      .from(schema.event)
      .where(
        and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'elicitation_expired')),
      );
    expect(assertDefined(ev).actor).toBeNull();
    expect(assertDefined(ev).detail).toMatchObject({ answer: null, autoResolvedValue: 'Acme' });
  });

  it('grades agent milestones: a block waits on you, bare progress addresses nobody', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const owner = await seedUserActor(orgId);
    const base = {
      organizationId: orgId,
      sessionId: 'sess_3',
      ownerUserId: owner.userId,
      agentName: 'Research subagent',
      parentSessionId: 'sess_1',
    };

    await emitAgentMilestone({
      ...base,
      kind: 'agent_progress',
      occurredAt: new Date('2026-08-02T12:00:00.000Z'),
      milestone: 'Read the last four incident reports',
      progress: 40,
    });
    await emitAgentMilestone({
      ...base,
      kind: 'agent_blocked',
      occurredAt: new Date('2026-08-02T12:01:00.000Z'),
      milestone: 'Needs access to the billing workspace',
      reasonCode: 'awaiting_authorization',
    });

    const [progress] = await db
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'agent_progress')));
    const [blocked] = await db
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'agent_blocked')));

    // Progress is still recorded and still reaches live observers — it just addresses no one.
    expect(assertDefined(progress).detail).toMatchObject({
      parentSessionId: 'sess_1',
      progress: 40,
    });
    expect(await recipients(assertDefined(progress).id)).toEqual([]);
    expect(await recipients(assertDefined(blocked).id)).toEqual([
      { userId: owner.userId, reason: 'awaiting_you' },
    ]);
  });

  it('keeps two subagent milestones fired in the same millisecond', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const owner = await seedUserActor(orgId);
    const at = new Date('2026-08-02T12:30:00.000Z');

    for (const milestone of ['Drafted the plan', 'Opened the pull request']) {
      await emitAgentMilestone({
        organizationId: orgId,
        kind: 'agent_completed',
        sessionId: 'sess_4',
        ownerUserId: owner.userId,
        agentName: 'Athena',
        occurredAt: at,
        milestone,
      });
    }

    const evs = await db
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'agent_completed')));
    expect(evs).toHaveLength(2);
  });

  it('records a received message as a message, tied to what it became', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const mailbox = await seedUserActor(orgId);

    await emitInboundEmail({
      organizationId: orgId,
      userId: mailbox.userId,
      occurredAt: new Date('2026-08-02T13:00:00.000Z'),
      messageId: '<abc@mail>',
      fromAddress: 'dani@example.com',
      fromName: 'Dani',
      subject: 'Q3 budget',
      snippet: 'Can you look at the numbers',
      captured: { kind: 'work_item', id: 'task_9' },
    });

    const [ev] = await db
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'email_received')));
    expect(assertDefined(ev).entityKind).toBe('message');
    expect(assertDefined(ev).detail).toMatchObject({
      schema: 'docket.inbound_email',
      fromAddress: 'dani@example.com',
      capturedEntityId: 'task_9',
    });
    expect(await recipients(assertDefined(ev).id)).toEqual([
      { userId: mailbox.userId, reason: 'owned' },
    ]);
  });
});
