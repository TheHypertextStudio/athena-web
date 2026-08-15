/**
 * `@docket/api` — registered agent-session task delivery access.
 *
 * @remarks
 * A registered session may carry a task id and transcript bodies. These real-DB regressions keep
 * that delivery boundary aligned with the canonical task view predicate: org membership alone
 * cannot disclose a private task's session, while a direct task grant can and a revoked grant
 * removes access again. Taskless registered sessions retain their established org-membership
 * policy.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type agentSessionsRouter from '../../src/routes/agent-sessions';
import { appWithActor, fakeSession, getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let agentSessions!: typeof agentSessionsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  agentSessions = (await import('../../src/routes/agent-sessions')).default;
});

interface RegisteredFixture {
  readonly orgId: string;
  readonly teamId: string;
  readonly humanActorId: string;
  readonly sessionId: string;
  readonly taskId: string | null;
  readonly activityId: string;
}

/** Seed a terminal registered session, optionally bound to a private task. */
async function seedRegisteredFixture(taskBound: boolean): Promise<RegisteredFixture> {
  const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
  const agentActorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'agent', displayName: 'Registered runner' })
      .returning({ id: schema.actor.id }),
  ).id;
  const agentId = one(
    await db
      .insert(schema.agent)
      .values({ organizationId: orgId, actorId: agentActorId, createdBy: humanActorId })
      .returning({ id: schema.agent.id }),
  ).id;
  const taskId = taskBound
    ? one(
        await db
          .insert(schema.task)
          .values({
            organizationId: orgId,
            teamId,
            title: 'Private delegated work',
            state: 'todo',
            visibility: 'private',
          })
          .returning({ id: schema.task.id }),
      ).id
    : null;
  const sessionId = one(
    await db
      .insert(schema.agentSession)
      .values({
        organizationId: orgId,
        agentId,
        taskId,
        trigger: 'assignment',
        status: 'completed',
        initiatorId: humanActorId,
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
  const activityId = one(
    await db
      .insert(schema.sessionActivity)
      .values({
        organizationId: orgId,
        sessionId,
        type: 'response',
        body: { text: 'Private agent transcript body' },
      })
      .returning({ id: schema.sessionActivity.id }),
  ).id;
  return { orgId, teamId, humanActorId, sessionId, taskId, activityId };
}

/** Mount the registered-session delivery route as the active seeded human actor. */
function sessionApp(fixture: RegisteredFixture) {
  return appWithActor(
    agentSessions,
    fixture.orgId,
    [],
    fixture.humanActorId,
    fakeSession(`user_${fixture.humanActorId}`),
    null,
  );
}

/** Grant direct task access and return the persisted grant id for later revocation. */
async function grantTaskContribute(fixture: RegisteredFixture): Promise<string> {
  if (fixture.taskId === null) throw new Error('direct task grant requires a task-bound fixture');
  return one(
    await db
      .insert(schema.grant)
      .values({
        organizationId: fixture.orgId,
        subjectKind: 'actor',
        subjectId: fixture.humanActorId,
        resourceKind: 'task',
        resourceId: fixture.taskId,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: false,
      })
      .returning({ id: schema.grant.id }),
  ).id;
}

describe('registered task-bound session delivery', () => {
  it('requires task visibility and hides all delivery paths again after direct-grant revocation', async () => {
    const fixture = await seedRegisteredFixture(true);
    const app = sessionApp(fixture);

    const hiddenList = await app.request('/');
    expect(hiddenList.status).toBe(200);
    expect(
      (
        (await hiddenList.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).not.toContain(fixture.sessionId);
    for (const path of [
      `/${fixture.sessionId}`,
      `/${fixture.sessionId}/activity`,
      `/${fixture.sessionId}/stream`,
    ]) {
      expect((await app.request(path)).status).toBe(404);
    }

    const grantId = await grantTaskContribute(fixture);

    const grantedList = await app.request('/');
    expect(
      (
        (await grantedList.json()) as {
          readonly items: readonly { readonly id: string; readonly taskId: string | null }[];
        }
      ).items,
    ).toContainEqual(expect.objectContaining({ id: fixture.sessionId, taskId: fixture.taskId }));
    const grantedDetail = await app.request(`/${fixture.sessionId}`);
    expect(grantedDetail.status).toBe(200);
    expect(JSON.stringify(await grantedDetail.json())).toContain('Private agent transcript body');
    const grantedActivity = await app.request(`/${fixture.sessionId}/activity`);
    expect(grantedActivity.status).toBe(200);
    expect(JSON.stringify(await grantedActivity.json())).toContain('Private agent transcript body');
    const grantedStream = await app.request(`/${fixture.sessionId}/stream`);
    expect(grantedStream.status).toBe(200);
    expect(await grantedStream.text()).toContain('Private agent transcript body');

    await db.delete(schema.grant).where(eq(schema.grant.id, grantId));

    const revokedList = await app.request('/');
    expect(
      (
        (await revokedList.json()) as { readonly items: readonly { readonly id: string }[] }
      ).items.map((item) => item.id),
    ).not.toContain(fixture.sessionId);
    for (const path of [
      `/${fixture.sessionId}`,
      `/${fixture.sessionId}/activity`,
      `/${fixture.sessionId}/stream`,
    ]) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it('retains org-membership delivery for taskless registered sessions', async () => {
    const fixture = await seedRegisteredFixture(false);
    const app = sessionApp(fixture);

    const list = await app.request('/');
    expect(
      ((await list.json()) as { readonly items: readonly { readonly id: string }[] }).items.map(
        (item) => item.id,
      ),
    ).toContain(fixture.sessionId);
    expect((await app.request(`/${fixture.sessionId}`)).status).toBe(200);
    expect((await app.request(`/${fixture.sessionId}/activity`)).status).toBe(200);
    const stream = await app.request(`/${fixture.sessionId}/stream`);
    expect(stream.status).toBe(200);
    expect(await stream.text()).toContain('Private agent transcript body');
  });

  it('stops an already-open stream before an activity written after task-grant revocation', async () => {
    const fixture = await seedRegisteredFixture(true);
    const app = sessionApp(fixture);
    const grantId = await grantTaskContribute(fixture);
    await db
      .delete(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, fixture.activityId));
    await db
      .update(schema.agentSession)
      .set({ status: 'running' })
      .where(eq(schema.agentSession.id, fixture.sessionId));

    const stream = await app.request(`/${fixture.sessionId}/stream`);
    expect(stream.status).toBe(200);

    await db.delete(schema.grant).where(eq(schema.grant.id, grantId));
    await db.insert(schema.sessionActivity).values({
      organizationId: fixture.orgId,
      sessionId: fixture.sessionId,
      type: 'response',
      body: { text: 'Do not deliver after task-grant revocation' },
    });
    await db
      .update(schema.agentSession)
      .set({ status: 'completed' })
      .where(eq(schema.agentSession.id, fixture.sessionId));

    expect(await stream.text()).not.toContain('Do not deliver after task-grant revocation');
  });
});
