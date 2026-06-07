/**
 * `@docket/api` — comments router (mounted at `/v1/orgs/:orgId/comments`).
 */
import { comment, db } from '@docket/db';
import { CommentCreate, CommentListQuery, CommentOut, CommentUpdate, pageOf } from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type CommentRow = typeof comment.$inferSelect;

function toOut(c: CommentRow): z.input<typeof CommentOut> {
  return {
    id: c.id,
    organizationId: c.organizationId,
    authorId: c.authorId,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    body: c.body,
    parentCommentId: c.parentCommentId,
    editedAt: c.editedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Comments router: list-by-subject + create/edit/delete on a polymorphic subject; `comment` to post. */
const comments = new Hono<AppEnv>()
  .get('/', zQuery(CommentListQuery), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { subjectType, subjectId } = c.req.valid('query');
    const rows = await db
      .select()
      .from(comment)
      .where(
        and(
          eq(comment.organizationId, orgId),
          eq(comment.subjectType, subjectType),
          eq(comment.subjectId, subjectId),
        ),
      )
      .orderBy(desc(comment.createdAt));
    return ok(c, pageOf(CommentOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('comment'), zJson(CommentCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');
    const inserted = await db
      .insert(comment)
      .values({
        organizationId: orgId,
        authorId: actorId,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        body: body.body,
        parentCommentId: body.parentCommentId,
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('comment insert returned no row');
    return ok(c, CommentOut, toOut(row));
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const rows = await db
      .select()
      .from(comment)
      .where(and(eq(comment.id, id), eq(comment.organizationId, orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Comment not found');
    return ok(c, CommentOut, toOut(row));
  })
  .patch('/:id', capabilityGuard('comment'), zParam(idParam), zJson(CommentUpdate), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const updated = await db
      .update(comment)
      .set({ body: body.body, editedAt: new Date() })
      .where(and(eq(comment.id, id), eq(comment.organizationId, orgId)))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Comment not found');
    return ok(c, CommentOut, toOut(row));
  })
  .delete('/:id', capabilityGuard('comment'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const deleted = await db
      .delete(comment)
      .where(and(eq(comment.id, id), eq(comment.organizationId, orgId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new NotFoundError('Comment not found');
    return ok(c, CommentOut, toOut(row));
  });

export default comments;
