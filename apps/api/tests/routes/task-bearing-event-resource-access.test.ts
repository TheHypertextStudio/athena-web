/**
 * `@docket/api` — task-bearing event delivery authorization.
 *
 * @remarks
 * An event feed is not a separate visibility domain: an event that identifies a private task,
 * or a comment attached to one, must use the same active-human task decision as task delivery.
 * These migrated-database regressions exercise the organization and Hub projections with actual
 * actors and grants rather than the route harness's injected capability list.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type activityRouter from '../../src/routes/activity';
import type hubRouter from '../../src/routes/hub';
import { publish } from '../../src/lib/event-bus';
import type streamRouter from '../../src/routes/stream';
import type streamSseRouter from '../../src/routes/stream-sse';
import { publishEvent, toStreamEventOut } from '../../src/routes/stream-helpers';
import {
  appWithActor,
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedBaseOrg,
  type StatusIdLookup,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let activity!: typeof activityRouter;
let hub!: typeof hubRouter;
let stream!: typeof streamRouter;
let streamSse!: typeof streamSseRouter;

const openStreams: (() => void)[] = [];

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  activity = (await import('../../src/routes/activity')).default;
  hub = (await import('../../src/routes/hub')).default;
  stream = (await import('../../src/routes/stream')).default;
  streamSse = (await import('../../src/routes/stream-sse')).default;
});

afterEach(() => {
  for (const close of openStreams.splice(0)) close();
});

interface PrivateTaskEventFixture {
  readonly orgId: string;
  readonly teamId: string;
  readonly statusId: StatusIdLookup;
  readonly viewerActorId: string;
  readonly viewerUserId: string;
  readonly taskId: string;
  readonly commentId: string;
  readonly taskAuditId: string;
  readonly commentAuditId: string;
  readonly streamEventId: string;
}

/** Grant one viewer the exact task capability that also satisfies task visibility. */
async function grantTaskContribute(
  fixture: PrivateTaskEventFixture,
  taskId = fixture.taskId,
): Promise<string> {
  return one(
    await db
      .insert(schema.grant)
      .values({
        organizationId: fixture.orgId,
        subjectKind: 'actor',
        subjectId: fixture.viewerActorId,
        resourceKind: 'task',
        resourceId: taskId,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: false,
      })
      .returning({ id: schema.grant.id }),
  ).id;
}

/** Persist a non-task observation, which should retain the existing membership-level behavior. */
async function seedNonTaskStreamEvent(orgId: string, title: string): Promise<string> {
  return one(
    await db
      .insert(schema.event)
      .values({
        organizationId: orgId,
        sourceSystem: 'docket',
        kind: 'created',
        occurredAt: new Date('2026-08-14T12:01:00.000Z'),
        title,
        entityAssociation: 'unmatched',
        dedupeKey: `non-task-event-${Math.random().toString(36).slice(2)}`,
      })
      .returning({ id: schema.event.id }),
  ).id;
}

/** Persist a non-task audit row, which must retain the established membership-level delivery. */
async function seedNonTaskAuditEvent(
  fixture: PrivateTaskEventFixture,
  metadata: Record<string, unknown>,
): Promise<string> {
  return one(
    await db
      .insert(schema.auditEvent)
      .values({
        organizationId: fixture.orgId,
        actorId: fixture.viewerActorId,
        subjectType: 'organization',
        subjectId: fixture.orgId,
        type: 'updated',
        metadata,
      })
      .returning({ id: schema.auditEvent.id }),
  ).id;
}

/** Add a task and its canonical work-item stream event at a fixed position in the feed. */
async function seedTaskStreamEvent(
  fixture: PrivateTaskEventFixture,
  title: string,
  occurredAt: Date,
  visibility: 'private' | 'public' = 'private',
): Promise<{ readonly eventId: string; readonly taskId: string }> {
  const taskRow = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: fixture.orgId,
        teamId: fixture.teamId,
        title,
        state: 'todo',
        statusId: fixture.statusId('task', 'todo'),
        visibility,
        createdBy: fixture.viewerActorId,
      })
      .returning({ id: schema.task.id }),
  );
  const eventRow = one(
    await db
      .insert(schema.event)
      .values({
        organizationId: fixture.orgId,
        sourceSystem: 'docket',
        kind: 'status_change',
        occurredAt,
        title,
        entity: {
          kind: 'work_item',
          source: 'docket',
          externalId: taskRow.id,
          title,
          url: null,
          docketEntityId: taskRow.id,
        },
        entityKind: 'work_item',
        entityAssociation: 'matched',
        docketEntityId: taskRow.id,
        dedupeKey: `private-task-event-${taskRow.id}`,
      })
      .returning({ id: schema.event.id }),
  );
  return { eventId: eventRow.id, taskId: taskRow.id };
}

/** Persist a manually resolved calendar/thread event without changing its source entity kind. */
async function seedManuallyLinkedTaskStreamEvent(
  fixture: PrivateTaskEventFixture,
): Promise<string> {
  return one(
    await db
      .insert(schema.event)
      .values({
        organizationId: fixture.orgId,
        sourceSystem: 'google_calendar',
        kind: 'calendar_update',
        occurredAt: new Date('2026-08-14T12:04:00.000Z'),
        title: 'Private manually linked meeting',
        entity: {
          kind: 'calendar_event',
          source: 'google_calendar',
          externalId: `meeting-${fixture.taskId}`,
          title: 'Private manually linked meeting',
          url: null,
          docketEntityId: fixture.taskId,
        },
        entityKind: 'calendar_event',
        entityAssociation: 'matched',
        docketEntityId: fixture.taskId,
        dedupeKey: `manual-task-event-${fixture.taskId}`,
      })
      .returning({ id: schema.event.id }),
  ).id;
}

/** Add a private task and direct audit row at a fixed position in the Hub activity timeline. */
async function seedPrivateTaskAuditEvent(
  fixture: PrivateTaskEventFixture,
  title: string,
  createdAt: Date,
): Promise<{ readonly auditId: string; readonly taskId: string }> {
  const taskRow = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: fixture.orgId,
        teamId: fixture.teamId,
        title,
        state: 'todo',
        statusId: fixture.statusId('task', 'todo'),
        visibility: 'private',
        createdBy: fixture.viewerActorId,
      })
      .returning({ id: schema.task.id }),
  );
  const auditRow = one(
    await db
      .insert(schema.auditEvent)
      .values({
        organizationId: fixture.orgId,
        actorId: fixture.viewerActorId,
        subjectType: 'task',
        subjectId: taskRow.id,
        type: 'updated',
        metadata: { title },
        createdAt,
      })
      .returning({ id: schema.auditEvent.id }),
  );
  return { auditId: auditRow.id, taskId: taskRow.id };
}

interface AgentSessionObservation {
  readonly sessionId: string;
  readonly streamEventId: string;
  readonly auditId: string;
}

interface ForeignAgentSessionObservation {
  readonly streamEventId: string;
  readonly auditId: string;
}

/** Seed the event and audit subjects that carry an agent session's private task relationship. */
async function seedAgentSessionObservations(
  fixture: PrivateTaskEventFixture,
  taskId: string | null,
): Promise<AgentSessionObservation> {
  const agentActorId = one(
    await db
      .insert(schema.actor)
      .values({
        organizationId: fixture.orgId,
        kind: 'agent',
        displayName: 'Private task agent',
      })
      .returning({ id: schema.actor.id }),
  ).id;
  const agentId = one(
    await db
      .insert(schema.agent)
      .values({
        organizationId: fixture.orgId,
        actorId: agentActorId,
        createdBy: fixture.viewerActorId,
      })
      .returning({ id: schema.agent.id }),
  ).id;
  const session = one(
    await db
      .insert(schema.agentSession)
      .values({
        organizationId: fixture.orgId,
        agentId,
        taskId,
        trigger: 'assignment',
        status: 'awaiting_approval',
        initiatorId: fixture.viewerActorId,
        workLinkage: taskId ? 'task' : 'unclassified',
      })
      .returning({ id: schema.agentSession.id }),
  );
  const streamEvent = one(
    await db
      .insert(schema.event)
      .values({
        organizationId: fixture.orgId,
        sourceSystem: 'docket',
        kind: 'elicitation_requested',
        occurredAt: new Date('2026-08-14T12:02:00.000Z'),
        title: 'Private agent-session question',
        summary: 'Private agent-session answer context',
        entity: {
          kind: 'agent_session',
          source: 'docket',
          externalId: session.id,
          title: 'Private agent-session question',
          url: null,
          docketEntityId: session.id,
        },
        entityKind: 'agent_session',
        entityAssociation: 'matched',
        docketEntityId: session.id,
        dedupeKey: `agent-session-event-${session.id}`,
      })
      .returning({ id: schema.event.id }),
  );
  const auditRow = one(
    await db
      .insert(schema.auditEvent)
      .values({
        organizationId: fixture.orgId,
        actorId: agentActorId,
        subjectType: 'agent_session',
        subjectId: session.id,
        type: 'approved',
        metadata: { approval: 'Private agent-session decision' },
      })
      .returning({ id: schema.auditEvent.id }),
  );

  return { sessionId: session.id, streamEventId: streamEvent.id, auditId: auditRow.id };
}

/** Seed a taskless Athena session whose context workspace owns the associated feed rows. */
async function seedTasklessAthenaSessionObservations(
  fixture: PrivateTaskEventFixture,
): Promise<AgentSessionObservation> {
  const session = one(
    await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: fixture.viewerUserId,
        contextOrganizationId: fixture.orgId,
        trigger: 'delegation',
        status: 'awaiting_input',
        workLinkage: 'unclassified',
      })
      .returning({ id: schema.agentSession.id }),
  );
  const streamEvent = one(
    await db
      .insert(schema.event)
      .values({
        organizationId: fixture.orgId,
        sourceSystem: 'docket',
        kind: 'agent_progress',
        occurredAt: new Date('2026-08-14T12:02:30.000Z'),
        title: 'Taskless Athena progress',
        entity: {
          kind: 'agent_session',
          source: 'docket',
          externalId: session.id,
          title: 'Taskless Athena progress',
          url: null,
          docketEntityId: session.id,
        },
        entityKind: 'agent_session',
        entityAssociation: 'matched',
        docketEntityId: session.id,
        dedupeKey: `taskless-athena-session-event-${session.id}`,
      })
      .returning({ id: schema.event.id }),
  );
  const auditRow = one(
    await db
      .insert(schema.auditEvent)
      .values({
        organizationId: fixture.orgId,
        actorId: fixture.viewerActorId,
        subjectType: 'agent_session',
        subjectId: session.id,
        type: 'updated',
        metadata: { progress: 'Taskless Athena progress' },
      })
      .returning({ id: schema.auditEvent.id }),
  );

  return { sessionId: session.id, streamEventId: streamEvent.id, auditId: auditRow.id };
}

/** Seed org-A rows that falsely point to a taskless registered session owned by org B. */
async function seedForeignTasklessAgentSessionObservations(
  fixture: PrivateTaskEventFixture,
): Promise<ForeignAgentSessionObservation> {
  const foreign = await seedBaseOrg(db, schema);
  const foreignAgentActorId = one(
    await db
      .insert(schema.actor)
      .values({
        organizationId: foreign.orgId,
        kind: 'agent',
        displayName: 'Foreign taskless agent',
      })
      .returning({ id: schema.actor.id }),
  ).id;
  const foreignAgentId = one(
    await db
      .insert(schema.agent)
      .values({
        organizationId: foreign.orgId,
        actorId: foreignAgentActorId,
        createdBy: foreign.humanActorId,
      })
      .returning({ id: schema.agent.id }),
  ).id;
  const foreignSessionId = one(
    await db
      .insert(schema.agentSession)
      .values({
        organizationId: foreign.orgId,
        agentId: foreignAgentId,
        taskId: null,
        trigger: 'assignment',
        status: 'awaiting_approval',
        initiatorId: foreign.humanActorId,
        workLinkage: 'unclassified',
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
  const streamEvent = one(
    await db
      .insert(schema.event)
      .values({
        organizationId: fixture.orgId,
        sourceSystem: 'docket',
        kind: 'elicitation_requested',
        occurredAt: new Date('2026-08-14T12:03:00.000Z'),
        title: 'Cross-org agent-session secret',
        summary: 'Cross-org session summary secret',
        entity: {
          kind: 'agent_session',
          source: 'docket',
          externalId: foreignSessionId,
          title: 'Cross-org agent-session secret',
          url: null,
          docketEntityId: foreignSessionId,
        },
        entityKind: 'agent_session',
        entityAssociation: 'matched',
        docketEntityId: foreignSessionId,
        dedupeKey: `foreign-agent-session-event-${foreignSessionId}`,
      })
      .returning({ id: schema.event.id }),
  );
  const auditRow = one(
    await db
      .insert(schema.auditEvent)
      .values({
        organizationId: fixture.orgId,
        actorId: fixture.viewerActorId,
        subjectType: 'agent_session',
        subjectId: foreignSessionId,
        type: 'approved',
        metadata: { secret: 'Cross-org agent-session audit secret' },
      })
      .returning({ id: schema.auditEvent.id }),
  );

  return { streamEventId: streamEvent.id, auditId: auditRow.id };
}

/** Open the real stream-SSE edge and read individual frames until the test closes it. */
async function openLiveStream(userId: string) {
  const app = appWithSession(streamSse, fakeSession(userId));
  const controller = new AbortController();
  const response = await app.request('/sse', {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  const body = response.body;
  if (!body) throw new Error('stream response has no body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  const nextFrame = async (): Promise<{ readonly event: string; readonly data: string }> => {
    for (;;) {
      const separator = buffered.indexOf('\n\n');
      if (separator !== -1) {
        const frame = buffered.slice(0, separator);
        buffered = buffered.slice(separator + 2);
        const event = frame.split('\n').find((line) => line.startsWith('event: '));
        const data = frame.split('\n').find((line) => line.startsWith('data: '));
        if (event) return { event: event.slice(7), data: data?.slice(6) ?? '' };
        continue;
      }
      const { done, value } = await reader.read();
      if (done) throw new Error('stream closed before a frame arrived');
      buffered += decoder.decode(value, { stream: true });
    }
  };

  const close = (): void => {
    void reader.cancel();
    controller.abort();
  };
  openStreams.push(close);
  return { close, nextFrame };
}

/** Seed one active human viewer and private task-bearing audit and observation rows. */
async function seedPrivateTaskEventFixture(): Promise<PrivateTaskEventFixture> {
  const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
  const viewerUser = one(
    await db
      .insert(schema.user)
      .values({
        name: 'Private event viewer',
        email: `private-event-${Math.random().toString(36).slice(2)}@example.test`,
      })
      .returning({ id: schema.user.id }),
  );
  await db
    .update(schema.actor)
    .set({ userId: viewerUser.id })
    .where(eq(schema.actor.id, humanActorId));

  const privateTask = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Private event task',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'private',
        createdBy: humanActorId,
      })
      .returning({ id: schema.task.id }),
  );
  const privateComment = one(
    await db
      .insert(schema.comment)
      .values({
        organizationId: orgId,
        authorId: humanActorId,
        createdBy: humanActorId,
        subjectType: 'task',
        subjectId: privateTask.id,
        body: 'Private task comment body',
      })
      .returning({ id: schema.comment.id }),
  );
  const taskAudit = one(
    await db
      .insert(schema.auditEvent)
      .values({
        organizationId: orgId,
        actorId: humanActorId,
        subjectType: 'task',
        subjectId: privateTask.id,
        type: 'updated',
        metadata: { title: 'Private task audit metadata' },
      })
      .returning({ id: schema.auditEvent.id }),
  );
  const commentAudit = one(
    await db
      .insert(schema.auditEvent)
      .values({
        organizationId: orgId,
        actorId: humanActorId,
        subjectType: 'comment',
        subjectId: privateComment.id,
        type: 'commented',
        metadata: { body: 'Private task comment audit metadata' },
      })
      .returning({ id: schema.auditEvent.id }),
  );
  const streamEvent = one(
    await db
      .insert(schema.event)
      .values({
        organizationId: orgId,
        sourceSystem: 'docket',
        kind: 'comment',
        occurredAt: new Date('2026-08-14T12:00:00.000Z'),
        title: 'Private task event title',
        summary: 'Private task event summary',
        entity: {
          kind: 'work_item',
          source: 'docket',
          externalId: privateTask.id,
          title: 'Private event task',
          url: null,
          docketEntityId: privateTask.id,
        },
        entityKind: 'work_item',
        entityAssociation: 'matched',
        docketEntityId: privateTask.id,
        dedupeKey: `private-task-event-${privateTask.id}`,
      })
      .returning({ id: schema.event.id }),
  );

  return {
    orgId,
    teamId,
    statusId,
    viewerActorId: humanActorId,
    viewerUserId: viewerUser.id,
    taskId: privateTask.id,
    commentId: privateComment.id,
    taskAuditId: taskAudit.id,
    commentAuditId: commentAudit.id,
    streamEventId: streamEvent.id,
  };
}

describe('task-bearing event delivery', () => {
  it('hides ungranted private task and task-comment events from organization and Hub feeds', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const orgStream = appWithActor(stream, fixture.orgId, [], fixture.viewerActorId);
    const orgActivity = appWithActor(activity, fixture.orgId, [], fixture.viewerActorId);
    const hubApp = appWithSession(hub, fakeSession(fixture.viewerUserId));

    const workspaceStream = await orgStream.request('/');
    expect(workspaceStream.status).toBe(200);
    expect(
      (
        (await workspaceStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).not.toContain(fixture.streamEventId);

    const workspaceActivity = await orgActivity.request('/');
    expect(workspaceActivity.status).toBe(200);
    const workspaceAuditIds = (
      (await workspaceActivity.json()) as { readonly items: readonly { readonly id: string }[] }
    ).items.map((item) => item.id);
    expect(workspaceAuditIds).not.toContain(fixture.taskAuditId);
    expect(workspaceAuditIds).not.toContain(fixture.commentAuditId);

    const hubStream = await hubApp.request('/stream');
    expect(hubStream.status).toBe(200);
    expect(
      (
        (await hubStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).not.toContain(fixture.streamEventId);

    const hubActivity = await hubApp.request('/activity');
    expect(hubActivity.status).toBe(200);
    const hubAuditIds = (
      (await hubActivity.json()) as { readonly items: readonly { readonly id: string }[] }
    ).items.map((item) => item.id);
    expect(hubAuditIds).not.toContain(fixture.taskAuditId);
    expect(hubAuditIds).not.toContain(fixture.commentAuditId);
  });

  it('treats a manually linked calendar event as task-bearing', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const eventId = await seedManuallyLinkedTaskStreamEvent(fixture);
    const orgStream = appWithActor(stream, fixture.orgId, [], fixture.viewerActorId);
    const hubApp = appWithSession(hub, fakeSession(fixture.viewerUserId));

    for (const response of [await orgStream.request('/'), await hubApp.request('/stream')]) {
      const ids = (
        (await response.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id);
      expect(ids).not.toContain(eventId);
    }

    await grantTaskContribute(fixture);
    for (const response of [await orgStream.request('/'), await hubApp.request('/stream')]) {
      const ids = (
        (await response.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id);
      expect(ids).toContain(eventId);
    }
  });

  it('requires canonical task visibility for task-bound agent-session events and audits', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const observation = await seedAgentSessionObservations(fixture, fixture.taskId);
    const orgStream = appWithActor(stream, fixture.orgId, [], fixture.viewerActorId);
    const orgActivity = appWithActor(activity, fixture.orgId, [], fixture.viewerActorId);
    const hubApp = appWithSession(hub, fakeSession(fixture.viewerUserId));

    const workspaceStream = await orgStream.request('/');
    expect(
      (
        (await workspaceStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).not.toContain(observation.streamEventId);
    const workspaceActivity = await orgActivity.request('/');
    expect(
      (
        (await workspaceActivity.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).not.toContain(observation.auditId);
    const hubStream = await hubApp.request('/stream');
    expect(
      (
        (await hubStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).not.toContain(observation.streamEventId);
    const hubActivity = await hubApp.request('/activity');
    expect(
      (
        (await hubActivity.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).not.toContain(observation.auditId);

    await grantTaskContribute(fixture);

    const grantedWorkspaceStream = await orgStream.request('/');
    expect(
      (
        (await grantedWorkspaceStream.json()) as {
          readonly items: readonly { readonly id: string }[];
        }
      ).items.map((item) => item.id),
    ).toContain(observation.streamEventId);
    const grantedWorkspaceActivity = await orgActivity.request('/');
    expect(
      (
        (await grantedWorkspaceActivity.json()) as {
          readonly items: readonly { readonly id: string }[];
        }
      ).items.map((item) => item.id),
    ).toContain(observation.auditId);
    const grantedHubStream = await hubApp.request('/stream');
    expect(
      (
        (await grantedHubStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toContain(observation.streamEventId);
    const grantedHubActivity = await hubApp.request('/activity');
    expect(
      (
        (await grantedHubActivity.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toContain(observation.auditId);
  });

  it('fails closed when a task-bound agent-session observation can no longer resolve its session', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const observation = await seedAgentSessionObservations(fixture, fixture.taskId);
    await grantTaskContribute(fixture);
    await db.delete(schema.agentSession).where(eq(schema.agentSession.id, observation.sessionId));
    const orgStream = appWithActor(stream, fixture.orgId, [], fixture.viewerActorId);
    const orgActivity = appWithActor(activity, fixture.orgId, [], fixture.viewerActorId);

    const workspaceStream = await orgStream.request('/');
    expect(
      (
        (await workspaceStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).not.toContain(observation.streamEventId);
    const workspaceActivity = await orgActivity.request('/');
    expect(
      (
        (await workspaceActivity.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).not.toContain(observation.auditId);
  });

  it('retains taskless agent-session observations as non-task feed rows', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const observation = await seedAgentSessionObservations(fixture, null);
    const athenaObservation = await seedTasklessAthenaSessionObservations(fixture);
    const orgStream = appWithActor(stream, fixture.orgId, [], fixture.viewerActorId);
    const orgActivity = appWithActor(activity, fixture.orgId, [], fixture.viewerActorId);
    const hubApp = appWithSession(hub, fakeSession(fixture.viewerUserId));

    const workspaceStream = await orgStream.request('/');
    expect(
      (
        (await workspaceStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toEqual(expect.arrayContaining([observation.streamEventId, athenaObservation.streamEventId]));
    const workspaceActivity = await orgActivity.request('/');
    expect(
      (
        (await workspaceActivity.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toEqual(expect.arrayContaining([observation.auditId, athenaObservation.auditId]));
    const hubStream = await hubApp.request('/stream');
    expect(
      (
        (await hubStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toEqual(expect.arrayContaining([observation.streamEventId, athenaObservation.streamEventId]));
    const hubActivity = await hubApp.request('/activity');
    expect(
      (
        (await hubActivity.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toEqual(expect.arrayContaining([observation.auditId, athenaObservation.auditId]));
  });

  it('fails closed when org feed rows point to a taskless agent session in another organization', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const observation = await seedForeignTasklessAgentSessionObservations(fixture);
    const orgStream = appWithActor(stream, fixture.orgId, [], fixture.viewerActorId);
    const orgActivity = appWithActor(activity, fixture.orgId, [], fixture.viewerActorId);

    const streamResponse = await orgStream.request('/');
    const streamBody = (await streamResponse.json()) as {
      readonly items: readonly { readonly id: string }[];
    };
    expect(streamBody.items.map((item) => item.id)).not.toContain(observation.streamEventId);
    expect(JSON.stringify(streamBody)).not.toContain('Cross-org agent-session secret');

    const activityResponse = await orgActivity.request('/');
    const activityBody = (await activityResponse.json()) as {
      readonly items: readonly { readonly id: string }[];
    };
    expect(activityBody.items.map((item) => item.id)).not.toContain(observation.auditId);
    expect(JSON.stringify(activityBody)).not.toContain('Cross-org agent-session audit secret');
  });

  it('rechecks a queued task-bound agent-session event after direct-grant revocation', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const observation = await seedAgentSessionObservations(fixture, fixture.taskId);
    const grantId = await grantTaskContribute(fixture);
    const [sessionEvent] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, observation.streamEventId));
    if (!sessionEvent) throw new Error('expected the agent-session event fixture row');
    const { nextFrame } = await openLiveStream(fixture.viewerUserId);

    await publishEvent(observation.streamEventId, [
      { userId: fixture.viewerUserId, reason: 'awaiting_you' },
    ]);
    expect(JSON.parse((await nextFrame()).data)).toMatchObject({ id: observation.streamEventId });

    await db.delete(schema.grant).where(eq(schema.grant.id, grantId));
    // The SSE edge must reject a recipient row that was queued before the task grant disappeared.
    publish(fixture.viewerUserId, toStreamEventOut(sessionEvent, 'awaiting_you'));
    const nonTaskEventId = await seedNonTaskStreamEvent(fixture.orgId, 'Organization event');
    await publishEvent(nonTaskEventId, [{ userId: fixture.viewerUserId, reason: 'owned' }]);

    const afterRevocation = JSON.parse((await nextFrame()).data) as { readonly id: string };
    expect(afterRevocation.id).not.toBe(observation.streamEventId);
    expect(afterRevocation.id).toBe(nonTaskEventId);
  });

  it('restores direct-grant task and task-comment event delivery across organization and Hub feeds', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    await grantTaskContribute(fixture);
    const orgStream = appWithActor(stream, fixture.orgId, [], fixture.viewerActorId);
    const orgActivity = appWithActor(activity, fixture.orgId, [], fixture.viewerActorId);
    const hubApp = appWithSession(hub, fakeSession(fixture.viewerUserId));

    const workspaceStream = await orgStream.request('/');
    expect(
      (
        (await workspaceStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toContain(fixture.streamEventId);
    const workspaceActivity = await orgActivity.request('/');
    expect(
      (
        (await workspaceActivity.json()) as {
          readonly items: readonly { readonly id: string }[];
        }
      ).items.map((item) => item.id),
    ).toEqual(expect.arrayContaining([fixture.taskAuditId, fixture.commentAuditId]));
    const personalStream = await hubApp.request('/stream');
    expect(
      (
        (await personalStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toContain(fixture.streamEventId);
    const personalActivity = await hubApp.request('/activity');
    expect(
      (
        (await personalActivity.json()) as {
          readonly items: readonly { readonly id: string }[];
        }
      ).items.map((item) => item.id),
    ).toEqual(expect.arrayContaining([fixture.taskAuditId, fixture.commentAuditId]));
  });

  it('fails closed when an audit comment can no longer resolve its task subject', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    await db.delete(schema.comment).where(eq(schema.comment.id, fixture.commentId));
    const orgActivity = appWithActor(activity, fixture.orgId, [], fixture.viewerActorId);

    const response = await orgActivity.request('/');
    expect(
      ((await response.json()) as { readonly items: readonly { readonly id: string }[] }).items.map(
        (item) => item.id,
      ),
    ).not.toContain(fixture.commentAuditId);
  });

  it('rechecks a live subscription after task-grant revocation without suppressing a later non-task event', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const grantId = await grantTaskContribute(fixture);
    const [taskEvent] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, fixture.streamEventId));
    if (!taskEvent) throw new Error('expected the task event fixture row');
    const { nextFrame } = await openLiveStream(fixture.viewerUserId);

    await publishEvent(fixture.streamEventId, [{ userId: fixture.viewerUserId, reason: 'owned' }]);
    expect(JSON.parse((await nextFrame()).data)).toMatchObject({ id: fixture.streamEventId });

    await db.delete(schema.grant).where(eq(schema.grant.id, grantId));
    // Simulate an event that was already routed to this recipient before the grant disappeared.
    // The SSE edge, rather than the producer, must reject this stale queued recipient row.
    publish(fixture.viewerUserId, toStreamEventOut(taskEvent, 'owned'));
    const nonTaskEventId = await seedNonTaskStreamEvent(fixture.orgId, 'Organization event');
    await publishEvent(nonTaskEventId, [{ userId: fixture.viewerUserId, reason: 'owned' }]);

    const afterRevocation = JSON.parse((await nextFrame()).data) as { readonly id: string };
    expect(afterRevocation.id).not.toBe(fixture.streamEventId);
    expect(afterRevocation.id).toBe(nonTaskEventId);
  });

  it('retains non-task audit and observation delivery without a task grant', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const nonTaskEventId = await seedNonTaskStreamEvent(fixture.orgId, 'Organization event');
    const nonTaskAuditId = await seedNonTaskAuditEvent(fixture, { setting: 'updated' });
    const project = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: fixture.orgId,
          teamId: fixture.teamId,
          name: 'Visible project discussion',
          statusId: fixture.statusId('project', 'planned'),
          createdBy: fixture.viewerActorId,
        })
        .returning({ id: schema.project.id }),
    );
    const projectComment = one(
      await db
        .insert(schema.comment)
        .values({
          organizationId: fixture.orgId,
          authorId: fixture.viewerActorId,
          createdBy: fixture.viewerActorId,
          subjectType: 'project',
          subjectId: project.id,
          body: 'Project-only audit comment',
        })
        .returning({ id: schema.comment.id }),
    );
    const projectCommentAuditId = one(
      await db
        .insert(schema.auditEvent)
        .values({
          organizationId: fixture.orgId,
          actorId: fixture.viewerActorId,
          subjectType: 'comment',
          subjectId: projectComment.id,
          type: 'commented',
          metadata: { body: 'Project-only audit comment' },
        })
        .returning({ id: schema.auditEvent.id }),
    ).id;
    const orgStream = appWithActor(stream, fixture.orgId, [], fixture.viewerActorId);
    const orgActivity = appWithActor(activity, fixture.orgId, [], fixture.viewerActorId);
    const hubApp = appWithSession(hub, fakeSession(fixture.viewerUserId));

    const workspaceStream = await orgStream.request('/');
    expect(
      (
        (await workspaceStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toContain(nonTaskEventId);
    const workspaceActivity = await orgActivity.request('/');
    expect(
      (
        (await workspaceActivity.json()) as {
          readonly items: readonly { readonly id: string }[];
        }
      ).items.map((item) => item.id),
    ).toEqual(expect.arrayContaining([nonTaskAuditId, projectCommentAuditId]));
    const personalStream = await hubApp.request('/stream');
    expect(
      (
        (await personalStream.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toContain(nonTaskEventId);
    const personalActivity = await hubApp.request('/activity');
    expect(
      (
        (await personalActivity.json()) as {
          readonly items: readonly { readonly id: string }[];
        }
      ).items.map((item) => item.id),
    ).toEqual(expect.arrayContaining([nonTaskAuditId, projectCommentAuditId]));
  });

  it('retains the public non-guest task baseline without an explicit grant', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const publicTaskEvent = await seedTaskStreamEvent(
      fixture,
      'Public task event',
      new Date('2026-08-14T11:00:00.000Z'),
      'public',
    );
    const orgStream = appWithActor(stream, fixture.orgId, [], fixture.viewerActorId);
    const hubApp = appWithSession(hub, fakeSession(fixture.viewerUserId));

    const workspace = await orgStream.request('/');
    expect(
      (
        (await workspace.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).toContain(publicTaskEvent.eventId);
    const personal = await hubApp.request('/stream');
    expect(
      ((await personal.json()) as { readonly items: readonly { readonly id: string }[] }).items.map(
        (item) => item.id,
      ),
    ).toContain(publicTaskEvent.eventId);
  });

  it('keeps a later granted event reachable when a hidden private task sits between stream pages', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const hidden = await seedTaskStreamEvent(
      fixture,
      'Hidden private event',
      new Date('2026-08-14T11:00:00.000Z'),
    );
    const oldestVisible = await seedTaskStreamEvent(
      fixture,
      'Oldest granted event',
      new Date('2026-08-14T10:00:00.000Z'),
    );
    await grantTaskContribute(fixture);
    await grantTaskContribute(fixture, oldestVisible.taskId);
    const orgStream = appWithActor(stream, fixture.orgId, [], fixture.viewerActorId);

    const firstResponse = await orgStream.request('/?limit=1');
    const first = (await firstResponse.json()) as {
      readonly items: readonly { readonly id: string }[];
      readonly nextCursor?: string;
    };
    expect(first.items.map((item) => item.id)).toEqual([fixture.streamEventId]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const secondResponse = await orgStream.request(`/?limit=1&cursor=${first.nextCursor ?? ''}`);
    const second = (await secondResponse.json()) as {
      readonly items: readonly { readonly id: string }[];
      readonly nextCursor?: string;
    };
    expect(second.items.map((item) => item.id)).toEqual([oldestVisible.eventId]);
    expect(second.nextCursor).toBeUndefined();
    expect(second.items.map((item) => item.id)).not.toContain(hidden.eventId);

    const hubApp = appWithSession(hub, fakeSession(fixture.viewerUserId));
    const hubFirstResponse = await hubApp.request('/stream?limit=1');
    const hubFirst = (await hubFirstResponse.json()) as {
      readonly items: readonly { readonly id: string }[];
      readonly nextCursor?: string;
    };
    expect(hubFirst.items.map((item) => item.id)).toEqual([fixture.streamEventId]);
    const hubSecondResponse = await hubApp.request(
      `/stream?limit=1&cursor=${hubFirst.nextCursor ?? ''}`,
    );
    const hubSecond = (await hubSecondResponse.json()) as {
      readonly items: readonly { readonly id: string }[];
    };
    expect(hubSecond.items.map((item) => item.id)).toEqual([oldestVisible.eventId]);
  });

  it('keeps a later granted task audit reachable across Hub activity pages', async () => {
    const fixture = await seedPrivateTaskEventFixture();
    const newestVisible = await seedPrivateTaskAuditEvent(
      fixture,
      'Newest granted audit',
      new Date('2026-08-14T12:00:00.000Z'),
    );
    await seedPrivateTaskAuditEvent(
      fixture,
      'Hidden audit between pages',
      new Date('2026-08-14T11:00:00.000Z'),
    );
    const oldestVisible = await seedPrivateTaskAuditEvent(
      fixture,
      'Oldest granted audit',
      new Date('2026-08-14T10:00:00.000Z'),
    );
    await grantTaskContribute(fixture, newestVisible.taskId);
    await grantTaskContribute(fixture, oldestVisible.taskId);
    const hubApp = appWithSession(hub, fakeSession(fixture.viewerUserId));

    const firstResponse = await hubApp.request('/activity?limit=1');
    const first = (await firstResponse.json()) as {
      readonly items: readonly { readonly id: string }[];
      readonly nextCursor?: string;
    };
    expect(first.items.map((item) => item.id)).toEqual([newestVisible.auditId]);
    expect(first.nextCursor).toBe(newestVisible.auditId);

    const secondResponse = await hubApp.request(
      `/activity?limit=1&cursor=${first.nextCursor ?? ''}`,
    );
    const second = (await secondResponse.json()) as {
      readonly items: readonly { readonly id: string }[];
      readonly nextCursor?: string;
    };
    expect(second.items.map((item) => item.id)).toEqual([oldestVisible.auditId]);
    expect(second.nextCursor).toBeUndefined();
  });
});
