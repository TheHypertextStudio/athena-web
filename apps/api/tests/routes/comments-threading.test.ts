import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { CommentOut } from '@docket/types';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';
import type commentsRouter from '../../src/routes/comments';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let comments!: typeof commentsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  comments = (await import('../../src/routes/comments')).default;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Page wrapper returned by the list endpoint. */
interface Page<T> {
  items: T[];
}

/** A fresh org with a real human actor to author comments (authorId FK -> actor). */
async function seedOrg() {
  return seedBaseOrg(db, schema);
}

/** Create a comment on the canonical task subject, returning the parsed body. */
async function createComment(
  app: ReturnType<typeof appWithActor>,
  payload: {
    subjectType?: string;
    subjectId?: string;
    body?: string;
    parentCommentId?: string;
  } = {},
) {
  const res = await app.request('/', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({
      subjectType: payload.subjectType ?? 'task',
      subjectId: payload.subjectId ?? 'task-1',
      body: payload.body ?? 'hello',
      ...(payload.parentCommentId ? { parentCommentId: payload.parentCommentId } : {}),
    }),
  });
  return res;
}

describe('comments router', () => {
  it('lists by subject in ascending creation order, scoped to subjectType + subjectId', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);

    await createComment(w, { subjectId: 'task-A', body: 'first' });
    await createComment(w, { subjectId: 'task-A', body: 'second' });
    // Different subject id — must NOT appear in the task-A listing.
    await createComment(w, { subjectId: 'task-B', body: 'other' });
    // Different subject type, same id — must NOT appear either.
    await createComment(w, { subjectType: 'project', subjectId: 'task-A', body: 'proj' });

    const res = await w.request('/?subjectType=task&subjectId=task-A');
    expect(res.status).toBe(200);
    const page = await body<Page<CommentOut>>(res);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((c) => c.body)).toEqual(['first', 'second']);
    expect(page.items.every((c) => c.subjectType === 'task' && c.subjectId === 'task-A')).toBe(
      true,
    );
  });

  it('rejects an invalid list query with 422', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);
    // subjectType not in the enum.
    const res = await w.request('/?subjectType=bogus&subjectId=task-1');
    expect(res.status).toBe(422);
  });

  it('creates a comment authored by the calling actor (never the body)', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);
    const res = await createComment(w, { body: 'authored' });
    expect(res.status).toBe(200);
    const created = await body<CommentOut>(res);
    expect(created.authorId).toBe(humanActorId);
    expect(created.organizationId).toBe(orgId);
    expect(created.parentCommentId).toBeNull();
    expect(created.editedAt).toBeNull();
  });

  it('threads a reply under a root comment and returns parentCommentId', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);

    const root = await body<CommentOut>(await createComment(w, { body: 'root' }));
    const replyRes = await createComment(w, { body: 'reply', parentCommentId: root.id });
    expect(replyRes.status).toBe(200);
    const reply = await body<CommentOut>(replyRes);
    expect(reply.parentCommentId).toBe(root.id);

    // The reply is returned in the subject listing carrying its parent link.
    const page = await body<Page<CommentOut>>(
      await w.request('/?subjectType=task&subjectId=task-1'),
    );
    const found = page.items.find((c) => c.id === reply.id);
    expect(found?.parentCommentId).toBe(root.id);
  });

  it('rejects a reply whose parent is on a different subject (422)', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);
    const root = await body<CommentOut>(
      await createComment(w, { subjectId: 'task-X', body: 'root' }),
    );
    const res = await createComment(w, {
      subjectId: 'task-Y',
      body: 'cross-subject reply',
      parentCommentId: root.id,
    });
    expect(res.status).toBe(422);
  });

  it('rejects replying to a reply (single-level threading, 422)', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);
    const root = await body<CommentOut>(await createComment(w, { body: 'root' }));
    const reply = await body<CommentOut>(
      await createComment(w, { body: 'reply', parentCommentId: root.id }),
    );
    const res = await createComment(w, {
      body: 'nested reply',
      parentCommentId: reply.id,
    });
    expect(res.status).toBe(422);
  });

  it('returns 404 when the parent comment does not exist', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);
    const res = await createComment(w, { body: 'orphan', parentCommentId: MISSING });
    expect(res.status).toBe(404);
  });

  it('GET /:id returns a comment and 404s for a missing one', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);
    const created = await body<CommentOut>(await createComment(w, { body: 'fetchme' }));

    const got = await w.request(`/${created.id}`);
    expect(got.status).toBe(200);
    expect((await body<CommentOut>(got)).id).toBe(created.id);

    expect((await w.request(`/${MISSING}`)).status).toBe(404);
  });

  it('PATCH edits the body and stamps editedAt; 404 for missing', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);
    const created = await body<CommentOut>(await createComment(w, { body: 'before' }));

    const patched = await w.request(`/${created.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ body: 'after' }),
    });
    expect(patched.status).toBe(200);
    const updated = await body<CommentOut>(patched);
    expect(updated.body).toBe('after');
    expect(updated.editedAt).not.toBeNull();

    expect(
      (
        await w.request(`/${MISSING}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ body: 'x' }),
        })
      ).status,
    ).toBe(404);
  });

  it('rejects a PATCH with an empty body (422)', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);
    const created = await body<CommentOut>(await createComment(w, { body: 'x' }));
    const res = await w.request(`/${created.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ body: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('DELETE returns { id, removed: true } and re-parents replies to null', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);
    const root = await body<CommentOut>(await createComment(w, { body: 'root' }));
    const reply = await body<CommentOut>(
      await createComment(w, { body: 'reply', parentCommentId: root.id }),
    );

    const del = await w.request(`/${root.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await body<{ id: string; removed: boolean }>(del)).toEqual({
      id: root.id,
      removed: true,
    });

    // The reply survives but is promoted to a root comment (parentCommentId cleared).
    const orphan = await db
      .select({ parentCommentId: schema.comment.parentCommentId })
      .from(schema.comment)
      .where(eq(schema.comment.id, reply.id))
      .limit(1);
    expect(orphan[0]?.parentCommentId).toBeNull();

    // Deleting again 404s.
    expect((await w.request(`/${root.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('enforces the `comment` capability on all mutations (403)', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const writer = appWithActor(comments, orgId, ['comment'], humanActorId);
    const created = await body<CommentOut>(await createComment(writer, { body: 'x' }));

    // A view-only actor cannot create, edit, or delete.
    const viewer = appWithActor(comments, orgId, ['view'], humanActorId);
    expect((await createComment(viewer, { body: 'nope' })).status).toBe(403);
    expect(
      (
        await viewer.request(`/${created.id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ body: 'nope' }),
        })
      ).status,
    ).toBe(403);
    expect((await viewer.request(`/${created.id}`, { method: 'DELETE' })).status).toBe(403);

    // But a view-only actor CAN read (list + detail).
    expect((await viewer.request('/?subjectType=task&subjectId=task-1')).status).toBe(200);
    expect((await viewer.request(`/${created.id}`)).status).toBe(200);
  });

  it('isolates comments by tenant: another org cannot read/edit/delete', async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    const wa = appWithActor(comments, a.orgId, ['comment'], a.humanActorId);
    const created = await body<CommentOut>(await createComment(wa, { body: 'tenant-a' }));

    // Org B (a different tenant) sees none of org A's comments and cannot touch them.
    const wb = appWithActor(comments, b.orgId, ['comment'], b.humanActorId);
    const page = await body<Page<CommentOut>>(
      await wb.request('/?subjectType=task&subjectId=task-1'),
    );
    expect(page.items).toHaveLength(0);
    expect((await wb.request(`/${created.id}`)).status).toBe(404);
    expect(
      (
        await wb.request(`/${created.id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ body: 'hijack' }),
        })
      ).status,
    ).toBe(404);
    expect((await wb.request(`/${created.id}`, { method: 'DELETE' })).status).toBe(404);

    // Org A still has its comment intact.
    expect((await wa.request(`/${created.id}`)).status).toBe(200);
  });

  it('rejects an invalid create body (422)', async () => {
    const { orgId, humanActorId } = await seedOrg();
    const w = appWithActor(comments, orgId, ['comment'], humanActorId);
    // Empty body string is invalid (min 1).
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ subjectType: 'task', subjectId: 'task-1', body: '' }),
    });
    expect(res.status).toBe(422);
  });
});
