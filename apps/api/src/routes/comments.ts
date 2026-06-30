/**
 * `@docket/api` — comments router (mounted at `/v1/orgs/:orgId/comments`).
 *
 * @remarks
 * Comments attach to a polymorphic subject (`task | project | program | initiative |
 * cycle`) and support single-level threading via `parentCommentId`. Every query is
 * scoped by `actorCtx.orgId`; the author is always the calling actor (agents post as
 * their Actor — this is how a Session's response/elicitation reaches the comment
 * stream, per api-rpc-contract §3.8). A reply's parent MUST be an existing comment in
 * the same org on the same subject, so a thread never spans subjects or tenants.
 */
import { comment, db } from '@docket/db';
import {
  CommentCreate,
  CommentListQuery,
  CommentOut,
  CommentRemoved,
  CommentUpdate,
  pageOf,
} from '@docket/types';
import { type Capability, satisfies } from '@docket/authz';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { CapabilityError, NotFoundError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { emitEvent } from './event-emit';

type CommentRow = typeof comment.$inferSelect;

/** Project a comment row into its wire {@link CommentOut} shape. */
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

/**
 * Load a single org-scoped comment, or throw {@link NotFoundError}.
 *
 * @param orgId - The tenant the comment must belong to.
 * @param id - The comment id.
 * @returns the comment row.
 * @throws {NotFoundError} When no such comment exists in this org.
 */
async function loadComment(orgId: string, id: string): Promise<CommentRow> {
  const rows = await db
    .select()
    .from(comment)
    .where(and(eq(comment.id, id), eq(comment.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Comment not found');
  return row;
}

/**
 * Assert the caller may mutate (edit/delete) a comment they did not necessarily author.
 *
 * @remarks
 * Per api-rpc-contract §3.8 a comment is editable/deletable by its **author** (the
 * `comment` capability alone is not enough to touch someone else's comment), OR by an
 * actor holding `manage` (a moderator override). The capability check has already run in
 * the route guard; this adds the per-row author gate. We compare the stored `authorId`
 * to the caller's `actorId`; a non-author without `manage` is `403` (the comment's
 * existence is not hidden — tenant isolation already 404s a cross-org id in
 * {@link loadComment}, so reaching here means the row is in-org and the caller can see it).
 *
 * @param row - The org-scoped comment row being mutated.
 * @param actorId - The calling actor's id.
 * @param held - The caller's org-level capabilities.
 * @throws {CapabilityError} When the caller is neither the author nor a `manage` holder.
 */
function assertAuthorOrManage(row: CommentRow, actorId: string, held: readonly Capability[]): void {
  if (row.authorId === actorId) return;
  if (held.some((cap) => satisfies(cap, 'manage'))) return;
  throw new CapabilityError('Only the author can modify this comment');
}

/**
 * Comments router: list-by-subject + create/edit/delete on a polymorphic subject.
 *
 * @remarks
 * Reads require org membership only (no per-route guard, matching the saved-views
 * exemplar); mutations require the `comment` capability. Replies are validated against
 * their parent so threads stay within one subject and tenant.
 */
const comments = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Comments',
      summary: 'List comments',
      response: pageOf(CommentOut),
      description: `List the comments on one polymorphic subject, identified by the required \`subjectType\` (\`task | project | program | initiative | cycle\`) and \`subjectId\` query params. Comments are the discussion thread attached to a work item. Results are ordered ascending by creation time so the client can reconstruct the two-level thread tree in post order — a reply always sorts after the parent it references (\`parentCommentId\`). Scoped to the caller's org. Requires org membership (\`view\`); no per-route capability guard. Returns a page wrapper of {@link CommentOut}.`,
    }),
    zQuery(CommentListQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { subjectType, subjectId } = c.req.valid('query');
      // Ascending by creation so the client can reconstruct threads in post order:
      // a reply always sorts after the parent it references.
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
        .orderBy(asc(comment.createdAt));
      return ok(c, pageOf(CommentOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('comment'),
    apiDoc({
      tag: 'Comments',
      summary: 'Add a comment',
      capability: 'comment',
      response: CommentOut,
      description: `Post a comment on a subject. Requires the \`comment\` capability — distinctly lower than \`contribute\`: a participant may discuss work without being able to edit its content. The author is always the calling actor (taken from context, never the body), which is how an Agent Session's response/elicitation reaches the comment stream — it posts as its own Actor.

Threading is single-level. Omit \`parentCommentId\` for a root comment; supply it to reply. A reply's parent must be an existing comment in the SAME org on the SAME subject (else 422), and the parent must itself be a root comment — replying to a reply is rejected (422), keeping the thread a strict two-level tree. Side effect: emits a \`comment\` observation onto the subject so its owners/followers are notified. Returns the created {@link CommentOut}.`,
    }),
    zJson(CommentCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');

      // Threading: a reply's parent must be an existing comment in this org on the SAME
      // subject. Without this a `parentCommentId` could dangle, point at another tenant's
      // comment, or thread a task comment under a project comment — all of which corrupt
      // the rendered thread tree. Nesting is single-level: a parent must itself be a root
      // comment (replies cannot have replies), keeping the thread a two-level structure.
      if (body.parentCommentId !== undefined) {
        const parent = await loadComment(orgId, body.parentCommentId);
        if (parent.subjectType !== body.subjectType || parent.subjectId !== body.subjectId) {
          throw new ValidationError(
            new z.ZodError([
              {
                code: 'custom',
                path: ['parentCommentId'],
                message: 'Parent comment is on a different subject',
                input: body.parentCommentId,
              },
            ]),
          );
        }
        if (parent.parentCommentId !== null) {
          throw new ValidationError(
            new z.ZodError([
              {
                code: 'custom',
                path: ['parentCommentId'],
                message: 'Cannot reply to a reply; replies are single-level',
                input: body.parentCommentId,
              },
            ]),
          );
        }
      }

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

      // Stream: a comment surfaces to the commented subject's owners/followers.
      await emitEvent({
        organizationId: orgId,
        kind: 'comment',
        actorId,
        title: row.body,
        summary: row.body,
        subject: { type: row.subjectType, id: row.subjectId },
      });
      return ok(c, CommentOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Comments',
      summary: 'Get a comment',
      response: CommentOut,
      description: `Fetch one comment by id. The lookup is org-scoped, so a cross-org or unknown id 404s (\`Comment not found\`) — existence is not leaked across tenants. Requires org membership (\`view\`). Returns {@link CommentOut}, including \`editedAt\` (null until the comment is edited) and \`parentCommentId\` (null for a root comment).`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadComment(orgId, id);
      return ok(c, CommentOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('comment'),
    apiDoc({
      tag: 'Comments',
      summary: 'Update a comment',
      capability: 'comment',
      response: CommentOut,
      description: `Edit a comment's body. Only the \`body\` is mutable (subject and threading are fixed at creation); the edit stamps \`editedAt\` so clients can show an "edited" marker. Requires the \`comment\` capability AND an authorship gate: a \`comment\`-capable member may only edit their OWN comment unless they additionally hold \`manage\` (a moderator override). A non-author without \`manage\` is 403 (\`Only the author can modify this comment\`) — note the comment's existence is not hidden here, because org-scoped tenant isolation already 404s a cross-org id before the author check runs. Returns the updated {@link CommentOut}.`,
    }),
    zParam(idParam),
    zJson(CommentUpdate),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      // Authorship gate: a `comment`-capable member may only edit their OWN comment unless
      // they hold `manage`. Load first (404s a cross-org/unknown id) then check the author.
      const existing = await loadComment(orgId, id);
      assertAuthorOrManage(existing, actorId, capabilities as Capability[]);

      const updated = await db
        .update(comment)
        .set({ body: body.body, editedAt: new Date() })
        .where(and(eq(comment.id, id), eq(comment.organizationId, orgId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: loadComment already proved the row exists */
      if (!row) throw new NotFoundError('Comment not found');
      return ok(c, CommentOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('comment'),
    apiDoc({
      tag: 'Comments',
      summary: 'Delete a comment',
      capability: 'comment',
      response: CommentRemoved,
      description: `Hard-delete a comment. Requires the \`comment\` capability plus the same authorship gate as edit: only the author, or an actor holding \`manage\`, may delete (non-author without \`manage\` → 403). A cross-org/unknown id 404s.

Deleting a root comment must not orphan its replies into a dangling thread. \`parent_comment_id\` carries no foreign key (it is plain text), so within one transaction the handler first re-parents every reply pointing at this comment to null — promoting them to root comments — and then deletes the row, keeping a subsequent list read internally consistent. Returns a {@link CommentRemoved} acknowledgement.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const { id } = c.req.valid('param');

      // Authorship gate (same as PATCH): only the author or a `manage` holder may delete.
      const existing = await loadComment(orgId, id);
      assertAuthorOrManage(existing, actorId, capabilities as Capability[]);

      // Deleting a root comment must not orphan its replies into a dangling thread:
      // `parent_comment_id` carries no FK (it is plain text), so re-parent any replies to
      // null first (promoting them to root comments) inside the same transaction as the
      // delete. This keeps a subsequent list read internally consistent.
      const removed = await db.transaction(async (tx) => {
        await tx
          .update(comment)
          .set({ parentCommentId: null })
          .where(and(eq(comment.parentCommentId, id), eq(comment.organizationId, orgId)));
        const deleted = await tx
          .delete(comment)
          .where(and(eq(comment.id, id), eq(comment.organizationId, orgId)))
          .returning();
        return deleted[0];
      });
      /* v8 ignore next -- @preserve defensive: loadComment already proved the row exists */
      if (!removed) throw new NotFoundError('Comment not found');
      return ok(c, CommentRemoved, { id: removed.id, removed: true });
    },
  );

export default comments;
