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
} from '@docket/work/comment-contract';
import { pageOf } from '../contracts/pagination';
import { type Capability, satisfies } from '@docket/authz';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { CapabilityError, NotFoundError, ValidationError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { assertSharedWorkWritable } from '../product-capability';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import { emitEvent } from './event-emit';
import { assertTaskCapability, buildTaskViewFilter, loadTask } from './task-helpers';

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
 * Require the caller to see the active task that owns a task-bound comment.
 *
 * @remarks
 * A comment is not an independent disclosure unit when its subject is a task: its body, thread
 * ids, and even existence inherit the canonical task delivery boundary. Non-task comments keep
 * their established organization-scoped rules at their route call sites.
 */
async function assertTaskCommentVisible(
  orgId: string,
  actorId: string,
  taskId: string,
): Promise<void> {
  const target = await loadTask(orgId, taskId);
  const canViewTask = await buildTaskViewFilter(orgId, actorId);
  if (!canViewTask(target)) throw new NotFoundError('Comment not found');
}

/** Require task-level contribution authority before writing a task-bound comment. */
async function assertTaskCommentContribution(
  orgId: string,
  actorId: string,
  taskId: string,
): Promise<void> {
  const target = await loadTask(orgId, taskId);
  await assertTaskCapability(orgId, actorId, target, 'contribute');
}

/** Preserve the existing generic-comment capability rule for non-task subjects. */
function assertCommentCapability(held: readonly Capability[]): void {
  if (held.some((capability) => satisfies(capability, 'comment'))) return;
  throw new CapabilityError('Comment capability required');
}

/**
 * Preserve the generic comment guard's pre-validation behavior while admitting task contributors.
 *
 * @remarks
 * `zJson` runs after route middleware. A blanket generic guard would reject a caller who has a
 * direct task `contribute` grant but no organization-wide `comment` capability; moving every
 * check into the handler would instead turn an existing non-task 403 into a validation 422. The
 * raw request clone lets this narrow boundary retain both contracts without consuming the body the
 * validated handler needs.
 */
function taskAwareCreateGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const held = c.get('actorCtx').capabilities as Capability[];
    if (held.some((capability) => satisfies(capability, 'comment'))) {
      await assertSharedWorkWritable(c.get('actorCtx').orgId, c.get('actorCtx').isPersonal);
      await next();
      return;
    }
    const raw = await c.req.raw
      .clone()
      .json()
      .catch((): unknown => null);
    const isTaskCreate =
      raw !== null &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      (raw as Record<string, unknown>)['subjectType'] === 'task';
    if (!isTaskCreate) {
      throw new CapabilityError();
    }
    await next();
  };
}

/**
 * Assert the caller may mutate (edit/delete) a comment they did not necessarily author.
 *
 * @remarks
 * Per api-rpc-contract §3.8 a comment is editable/deletable by its **author** (the
 * `comment` capability alone is not enough to touch someone else's comment), OR by an
 * actor holding `manage` (a moderator override). The subject-specific capability check has
 * already run before this gate. We compare the stored `authorId`
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
 * Reads of non-task comments require org membership only, while task comments require current
 * canonical task visibility. Non-task mutations retain the `comment` capability; task mutations
 * require `contribute` on that specific task. Replies are validated against their parent so
 * threads stay within one subject and tenant.
 */
const comments = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Comments',
      summary: 'List comments',
      response: pageOf(CommentOut),
      description: `List the comments on one polymorphic subject, identified by the required \`subjectType\` (\`task | project | program | initiative | cycle\`) and \`subjectId\` query params. Comments are the discussion thread attached to a work item. Results are ordered ascending by creation time so the client can reconstruct the two-level thread tree in post order — a reply always sorts after the parent it references (\`parentCommentId\`). Task comments require current canonical task visibility; non-task comments retain the organization-scoped read rule. Returns a page wrapper of {@link CommentOut}.`,
    }),
    zQuery(CommentListQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { subjectType, subjectId } = c.req.valid('query');
      if (subjectType === 'task') await assertTaskCommentVisible(orgId, actorId, subjectId);
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
    taskAwareCreateGuard(),
    apiDoc({
      status: 201,
      tag: 'Comments',
      summary: 'Add a comment',
      response: CommentOut,
      description: `Post a comment on a subject. Task comments require \`contribute\` on the current task; non-task comments retain the \`comment\` capability, distinctly lower than \`contribute\`. The author is always the calling actor (taken from context, never the body), which is how an Agent Session's response/elicitation reaches the comment stream — it posts as its own Actor.

Threading is single-level. Omit \`parentCommentId\` for a root comment; supply it to reply. A reply's parent must be an existing comment in the SAME org on the SAME subject (else 422), and the parent must itself be a root comment — replying to a reply is rejected (422), keeping the thread a strict two-level tree. Side effect: emits a \`comment\` observation onto the subject so its owners/followers are notified. Returns the created {@link CommentOut}.`,
    }),
    zJson(CommentCreate),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const body = c.req.valid('json');

      if (body.subjectType === 'task') {
        await assertTaskCommentContribution(orgId, actorId, body.subjectId);
      } else {
        assertCommentCapability(capabilities as Capability[]);
      }

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
      await enqueueSearchUpsert(orgId, 'comment', row.id);
      return created(c, CommentOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Comments',
      summary: 'Get a comment',
      response: CommentOut,
      description: `Fetch one comment by id. The lookup is org-scoped, so a cross-org or unknown id 404s (\`Comment not found\`) — existence is not leaked across tenants. A task comment additionally requires current canonical visibility of its task. Returns {@link CommentOut}, including \`editedAt\` (null until the comment is edited) and \`parentCommentId\` (null for a root comment).`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadComment(orgId, id);
      if (row.subjectType === 'task') {
        await assertTaskCommentVisible(orgId, actorId, row.subjectId);
      }
      return ok(c, CommentOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    apiDoc({
      tag: 'Comments',
      summary: 'Update a comment',
      response: CommentOut,
      description: `Edit a comment's body. Only the \`body\` is mutable (subject and threading are fixed at creation); the edit stamps \`editedAt\` so clients can show an "edited" marker. A task comment requires \`contribute\` on its current task; a non-task comment requires \`comment\`. Both keep the authorship gate: only the author may edit unless they additionally hold \`manage\` (a moderator override). A non-author without \`manage\` is 403 (\`Only the author can modify this comment\`). Returns the updated {@link CommentOut}.`,
    }),
    zParam(idParam),
    zJson(CommentUpdate),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      // Task comments carry task-level disclosure and contribution semantics; all other subjects
      // retain the existing generic comment capability. Load first to resolve which rule applies.
      const existing = await loadComment(orgId, id);
      if (existing.subjectType === 'task') {
        await assertTaskCommentContribution(orgId, actorId, existing.subjectId);
      } else {
        assertCommentCapability(capabilities as Capability[]);
      }
      assertAuthorOrManage(existing, actorId, capabilities as Capability[]);
      await assertSharedWorkWritable(orgId, c.get('actorCtx').isPersonal);

      const updated = await db
        .update(comment)
        .set({ body: body.body, editedAt: new Date() })
        .where(and(eq(comment.id, id), eq(comment.organizationId, orgId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: loadComment already proved the row exists */
      if (!row) throw new NotFoundError('Comment not found');
      await enqueueSearchUpsert(orgId, 'comment', row.id);
      return ok(c, CommentOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    apiDoc({
      tag: 'Comments',
      summary: 'Delete a comment',
      response: CommentRemoved,
      description: `Hard-delete a comment. A task comment requires \`contribute\` on its current task; a non-task comment requires \`comment\`. Both retain the same authorship gate as edit: only the author, or an actor holding \`manage\`, may delete (non-author without \`manage\` → 403). A cross-org/unknown id 404s.

Deleting a root comment must not orphan its replies into a dangling thread. \`parent_comment_id\` carries no foreign key (it is plain text), so within one transaction the handler first re-parents every reply pointing at this comment to null — promoting them to root comments — and then deletes the row, keeping a subsequent list read internally consistent. Returns a {@link CommentRemoved} acknowledgement.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const { id } = c.req.valid('param');

      // Task comments require task-level contribution; non-task comments retain the generic
      // comment rule. The authorship gate below remains unchanged for both subject classes.
      const existing = await loadComment(orgId, id);
      if (existing.subjectType === 'task') {
        await assertTaskCommentContribution(orgId, actorId, existing.subjectId);
      } else {
        assertCommentCapability(capabilities as Capability[]);
      }
      assertAuthorOrManage(existing, actorId, capabilities as Capability[]);
      await assertSharedWorkWritable(orgId, c.get('actorCtx').isPersonal);

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
      await enqueueSearchDelete(orgId, 'comment', removed.id);
      return ok(c, CommentRemoved, { id: removed.id, removed: true });
    },
  );

export default comments;
