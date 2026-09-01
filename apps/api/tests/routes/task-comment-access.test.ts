/**
 * `@docket/api` — task-comment visibility and contribution regressions.
 *
 * @remarks
 * Comments are polymorphic, but a task comment carries the task's disclosure boundary. These
 * tests deliberately use persisted actor and grant rows (rather than the route harness's
 * injected capabilities) so private-task sharing, direct grants, and revocation exercise the
 * same canonical authorization data as production.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { CommentOut } from '@docket/work/comment-contract';

import type commentsRouter from '../../src/routes/comments';
import {
  appWithActor,
  getDb,
  one,
  seedBaseOrg,
  type StatusIdLookup,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let comments!: typeof commentsRouter;

const JSON_HEADERS = { 'content-type': 'application/json' };

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  comments = (await import('../../src/routes/comments')).default;
});

/** Insert a private task and an existing task-bound comment without granting the caller access. */
async function seedPrivateTaskComment(
  orgId: string,
  teamId: string,
  actorId: string,
  statusId: StatusIdLookup,
): Promise<{
  readonly taskId: string;
  readonly commentId: string;
}> {
  const taskId = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Private comment subject',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'private',
        createdBy: actorId,
      })
      .returning({ id: schema.task.id }),
  ).id;
  const commentId = one(
    await db
      .insert(schema.comment)
      .values({
        organizationId: orgId,
        authorId: actorId,
        subjectType: 'task',
        subjectId: taskId,
        body: 'private comment body',
        createdBy: actorId,
      })
      .returning({ id: schema.comment.id }),
  ).id;
  return { taskId, commentId };
}

/** Give a caller one exact, non-cascading task grant and return the grant id for revocation. */
async function grantTask(
  orgId: string,
  actorId: string,
  taskId: string,
  capabilities: readonly ('view' | 'contribute')[],
): Promise<string> {
  return one(
    await db
      .insert(schema.grant)
      .values({
        organizationId: orgId,
        subjectKind: 'actor',
        subjectId: actorId,
        resourceKind: 'task',
        resourceId: taskId,
        capabilities: [...capabilities],
        effect: 'allow',
        cascades: false,
      })
      .returning({ id: schema.grant.id }),
  ).id;
}

async function postTaskComment(
  app: ReturnType<typeof appWithActor>,
  taskId: string,
  body: string,
  parentCommentId?: string,
): Promise<Response> {
  return app.request('/', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      subjectType: 'task',
      subjectId: taskId,
      body,
      ...(parentCommentId === undefined ? {} : { parentCommentId }),
    }),
  });
}

describe('task comment authorization', () => {
  it('uses canonical task visibility for task comment reads and task-level contribute for writes, including revocation', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const { taskId, commentId } = await seedPrivateTaskComment(
      orgId,
      teamId,
      humanActorId,
      statusId,
    );
    // The generic capability is intentionally present: it must not bypass the task boundary.
    const caller = appWithActor(comments, orgId, ['comment'], humanActorId);

    expect(
      (await caller.request(`/?subjectType=task&subjectId=${taskId}`, { method: 'GET' })).status,
    ).toBe(404);
    expect((await caller.request(`/${commentId}`, { method: 'GET' })).status).toBe(404);
    expect((await postTaskComment(caller, taskId, 'hidden thread reply', commentId)).status).toBe(
      404,
    );
    expect(
      (
        await caller.request(`/${commentId}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ body: 'must stay hidden' }),
        })
      ).status,
    ).toBe(404);
    expect((await caller.request(`/${commentId}`, { method: 'DELETE' })).status).toBe(404);

    const grantId = await grantTask(orgId, humanActorId, taskId, ['view']);
    const visibleList = await caller.request(`/?subjectType=task&subjectId=${taskId}`, {
      method: 'GET',
    });
    expect(visibleList.status).toBe(200);
    expect(
      ((await visibleList.json()) as { readonly items: readonly CommentOut[] }).items.map(
        (item) => item.id,
      ),
    ).toContain(commentId);
    expect((await caller.request(`/${commentId}`, { method: 'GET' })).status).toBe(200);

    // Viewing a shared private task does not let a generic commenter write its discussion.
    expect((await postTaskComment(caller, taskId, 'view cannot contribute')).status).toBe(403);
    expect(
      (
        await caller.request(`/${commentId}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ body: 'view cannot edit' }),
        })
      ).status,
    ).toBe(403);
    expect((await caller.request(`/${commentId}`, { method: 'DELETE' })).status).toBe(403);

    await db
      .update(schema.grant)
      .set({ capabilities: ['contribute'] })
      .where(and(eq(schema.grant.id, grantId), eq(schema.grant.organizationId, orgId)));
    // This route context intentionally has no generic `comment` capability. Its success proves
    // the persisted task grant, rather than injected org capability, authorizes the task write.
    const directContributor = appWithActor(comments, orgId, [], humanActorId);
    const created = await postTaskComment(directContributor, taskId, 'direct contributor comment');
    expect(created.status).toBe(201);
    const createdComment = (await created.json()) as CommentOut;
    const reply = await postTaskComment(directContributor, taskId, 'reply', createdComment.id);
    expect(reply.status).toBe(201);
    const replyComment = (await reply.json()) as CommentOut;
    expect(
      (
        await directContributor.request(`/${createdComment.id}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ body: 'direct contributor edit' }),
        })
      ).status,
    ).toBe(200);
    expect(
      (await directContributor.request(`/${replyComment.id}`, { method: 'DELETE' })).status,
    ).toBe(200);

    await db
      .delete(schema.grant)
      .where(and(eq(schema.grant.id, grantId), eq(schema.grant.organizationId, orgId)));
    expect(
      (await directContributor.request(`/${createdComment.id}`, { method: 'GET' })).status,
    ).toBe(404);
    expect(
      (await caller.request(`/?subjectType=task&subjectId=${taskId}`, { method: 'GET' })).status,
    ).toBe(404);
  });

  it('keeps comments on public tasks readable to an active non-guest member', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const memberRoleId = one(
      await db
        .insert(schema.role)
        .values({
          organizationId: orgId,
          key: `member-${Math.random().toString(36).slice(2, 8)}`,
          name: 'Member',
          defaultVisibility: 'public',
        })
        .returning({ id: schema.role.id }),
    ).id;
    const memberId = one(
      await db
        .insert(schema.actor)
        .values({
          organizationId: orgId,
          kind: 'human',
          displayName: 'Member',
          roleId: memberRoleId,
        })
        .returning({ id: schema.actor.id }),
    ).id;
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Public comment subject',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public',
          createdBy: humanActorId,
        })
        .returning({ id: schema.task.id }),
    ).id;
    const commentId = one(
      await db
        .insert(schema.comment)
        .values({
          organizationId: orgId,
          authorId: humanActorId,
          subjectType: 'task',
          subjectId: taskId,
          body: 'public member readable',
          createdBy: humanActorId,
        })
        .returning({ id: schema.comment.id }),
    ).id;
    const member = appWithActor(comments, orgId, [], memberId, null, memberRoleId);

    expect(
      (await member.request(`/?subjectType=task&subjectId=${taskId}`, { method: 'GET' })).status,
    ).toBe(200);
    expect((await member.request(`/${commentId}`, { method: 'GET' })).status).toBe(200);
  });
});
