/**
 * A job dispatched through `POST /sessions` on the default mock model proposes a change to a task
 * that exists: the task the person asked from, else the task the work was filed as. Approving the
 * proposal changes that task for real and leaves a change set the personal undo route reverses.
 * An approved change whose tool errors is recorded as failed, and so is the job.
 */
import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type meAthenaRouter from '../../src/routes/me-athena';
import {
  fakeSession,
  getDb,
  grantDocketPro,
  one,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let meAthena!: typeof meAthenaRouter;

const JSON_HEADERS = { 'content-type': 'application/json' };

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  meAthena = (await import('../../src/routes/me-athena')).default;
});

/** One member of a workspace with a team and a backlog task. */
interface Workspace {
  readonly userId: string;
  readonly orgId: string;
  readonly taskId: string;
}

/** What the applied proposal recorded. */
interface AppliedUpdate {
  /** The ids the `update` call was scoped to. */
  readonly scopedIds: readonly string[];
  /** The change set the update wrote, from its tool output. */
  readonly changeSetId: string;
}

/** A workspace the caller contributes to, holding one backlog task. */
async function seedWorkspace(): Promise<Workspace> {
  const suffix = Math.random().toString(36).slice(2, 9);
  const orgId = one(
    await db
      .insert(schema.organization)
      .values({ name: `Subject-${suffix}`, slug: `subject-${suffix}`, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  ).id;
  await grantDocketPro(db, schema, orgId);
  const statusId = await seedStatuses(db, schema, orgId);
  const teamId = one(
    await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Core', key: `S${suffix.slice(-3)}` })
      .returning({ id: schema.team.id }),
  ).id;
  const userId = await seedUserWithHub(db, schema, 'Owner');
  const roleId = one(
    await db
      .insert(schema.role)
      .values({
        organizationId: orgId,
        key: `owner-${suffix}`,
        name: 'Owner',
        capabilities: ['view', 'contribute'],
      })
      .returning({ id: schema.role.id }),
  ).id;
  const actorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Owner', userId, roleId })
      .returning({ id: schema.actor.id }),
  ).id;
  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'role',
    subjectId: roleId,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: ['view', 'contribute'],
    effect: 'allow',
  });
  const taskId = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Draft the launch email',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
        createdBy: actorId,
      })
      .returning({ id: schema.task.id }),
  ).id;
  return { userId, orgId, taskId };
}

/** Mount the personal route with only a Better Auth session. */
function appFor(userId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(userId));
    await next();
  });
  app.route('/', meAthena);
  app.onError(onError);
  return app;
}

/** A task's current state. */
async function taskState(taskId: string): Promise<string | undefined> {
  const rows = await db
    .select({ state: schema.task.state })
    .from(schema.task)
    .where(eq(schema.task.id, taskId));
  return rows[0]?.state;
}

/** Dispatch a job through `POST /sessions` and return its id once it waits on the proposal. */
async function dispatch(userId: string, body: Record<string, unknown>): Promise<string> {
  const created = await appFor(userId).request('/sessions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  expect(created.status).toBe(201);
  const detail = (await created.json()) as { id: string; status: string };
  expect(detail.status).toBe('awaiting_approval');
  return detail.id;
}

/** Approve the job's proposal and read back the one action it applied. */
async function approve(userId: string, sessionId: string): Promise<AppliedUpdate> {
  const approved = await appFor(userId).request(`/sessions/${sessionId}/decision`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ decision: 'approved' }),
  });
  expect(approved.status).toBe(200);
  expect((await approved.json()) as { status: string }).toMatchObject({ status: 'completed' });

  const actions = await db
    .select()
    .from(schema.sessionActivity)
    .where(
      and(
        eq(schema.sessionActivity.sessionId, sessionId),
        eq(schema.sessionActivity.type, 'action'),
      ),
    );
  expect(actions).toHaveLength(1);
  const action = assertDefined(actions[0]);
  expect(action.approvalStatus).toBe('applied');
  const recorded = assertDefined(action.body.action);
  expect(recorded.toolCall?.tool).toBe('update');
  const result = assertDefined(recorded.result);
  expect(result.isError).toBe(false);
  const output = JSON.parse(result.content) as { changed: number; changeSetId: string | null };
  expect(output.changed).toBe(1);
  const input = recorded.toolCall?.input as { scope: { ids: string[] } };
  return { scopedIds: input.scope.ids, changeSetId: assertDefined(output.changeSetId) };
}

/** Undo `changeSetId` through the personal route and expect success. */
async function undo(userId: string, changeSetId: string): Promise<void> {
  const response = await appFor(userId).request(`/changes/${changeSetId}/undo`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ changeSetId, undone: true });
}

describe('a locally dispatched job on the default mock model', () => {
  it('changes the task it was asked from, and the change undoes', async () => {
    const workspace = await seedWorkspace();
    const sessionId = await dispatch(workspace.userId, {
      prompt: 'Start this',
      context: { workspaceId: workspace.orgId, source: { type: 'task', id: workspace.taskId } },
    });

    const applied = await approve(workspace.userId, sessionId);

    expect(applied.scopedIds).toEqual([workspace.taskId]);
    expect(await taskState(workspace.taskId)).toBe('in_progress');
    // The person's own view of the job names the change set its receipt offers to undo.
    const detail = await appFor(workspace.userId).request(`/sessions/${sessionId}`);
    const { activities } = (await detail.json()) as {
      activities: { type: string; body: { action?: { result?: { changeSetId?: string } } } }[];
    };
    const shown = activities.find((activity) => activity.type === 'action');
    expect(shown?.body.action?.result?.changeSetId).toBe(applied.changeSetId);
    await undo(workspace.userId, applied.changeSetId);
    expect(await taskState(workspace.taskId)).toBe('backlog');
  });

  it('changes the task the work was filed as when no task was in view', async () => {
    const workspace = await seedWorkspace();
    const sessionId = await dispatch(workspace.userId, {
      prompt: 'Start the launch prep',
      context: { workspaceId: workspace.orgId },
    });
    const [session] = await db
      .select({ taskId: schema.agentSession.taskId })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    const filedTaskId = assertDefined(session?.taskId);
    const filedStateBefore = await taskState(filedTaskId);

    const applied = await approve(workspace.userId, sessionId);

    expect(applied.scopedIds).toEqual([filedTaskId]);
    expect(await taskState(filedTaskId)).toBe('in_progress');
    expect(await taskState(workspace.taskId)).toBe('backlog');
    await undo(workspace.userId, applied.changeSetId);
    expect(await taskState(filedTaskId)).toBe(filedStateBefore);
  });
});

describe('an approved change whose tool fails', () => {
  it('records the action as failed and the job as failed, not completed', async () => {
    const workspace = await seedWorkspace();
    // With no team the job files no task, so the mock proposes its placeholder `update_task` call,
    // which Docket's toolbox answers with an error result.
    await db.delete(schema.task).where(eq(schema.task.id, workspace.taskId));
    await db.delete(schema.team).where(eq(schema.team.organizationId, workspace.orgId));
    const sessionId = await dispatch(workspace.userId, {
      prompt: 'Start this',
      context: { workspaceId: workspace.orgId },
    });

    const approved = await appFor(workspace.userId).request(`/sessions/${sessionId}/decision`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ decision: 'approved' }),
    });

    expect(approved.status).toBe(200);
    expect((await approved.json()) as { status: string }).toMatchObject({ status: 'failed' });
    const [action] = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, sessionId),
          eq(schema.sessionActivity.type, 'action'),
        ),
      );
    expect(action?.approvalStatus).toBe('failed');
    expect(action?.body.action?.result?.isError).toBe(true);
    const [session] = await db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    expect(session?.status).toBe('failed');

    // The person's own view reports the stop and the failed action, never a finished success.
    const detail = await appFor(workspace.userId).request(`/sessions/${sessionId}`);
    const shown = (await detail.json()) as {
      status: string;
      activities: { type: string; approvalStatus: string | null }[];
    };
    expect(shown.status).toBe('failed');
    expect(shown.activities.find((activity) => activity.type === 'action')?.approvalStatus).toBe(
      'failed',
    );
  });
});
