/**
 * `@docket/api` — the owner-facing Athena inbox API, mounted at `/v1/me/athena/mail`.
 *
 * @remarks
 * Personal and cross-org, like the rest of `/v1/me/athena`: a mailbox belongs to a *person*, and
 * the messages it receives can be filed into, and attached across, any workspace that person
 * belongs to. Ownership therefore comes from the authenticated session on every route, never from
 * a body or a path — a message id that is not the caller's reads as absent rather than forbidden.
 *
 * Attachment goes through the generic {@link attachment} table (`kind = 'athena_email'`), which is
 * the whole point of modelling a received message as a context object: a task, a project and an
 * initiative all accept one through the same table every other attachable resource uses, so the
 * task attachment list and the project resources list pick these up without a mail-specific path.
 * The tenant check on the attach route is membership in the *target* workspace (an active human
 * actor), which is the same boundary every other personal cross-org surface uses.
 */
import { actor, attachment, athenaInboundMessage, db, initiative, project, task } from '@docket/db';
import {
  AthenaMailAttachBody,
  AthenaMailAttachmentTargetOut,
  AthenaMailboxOut,
  AthenaMailMessageOut,
} from '@docket/athena/athena-mail-contract';
import { AttachmentRemoved, AttachmentSubjectType } from '@docket/work/attachment-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, ConflictError, NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { assertSharedWorkWritable } from '../product-capability';

import {
  ATHENA_MAIL_ATTACHMENT_KIND,
  athenaMailHost,
  countAttachmentTargets,
  ensureMailbox,
  listAttachmentTargetsPage,
  listMessagesAttachedTo,
  listOwnedMessages,
  loadAttachmentTarget,
  loadOwnedMessage,
  mailboxAddress,
  messagePermalink,
  toMailMessageOut,
} from './athena-mail-store';

const idParam = z.object({ id: z.string() });
const attachmentParam = z.object({ id: z.string(), attachmentId: z.string() });
const listQuery = CursorQuery;
const attachedQuery = CursorQuery.extend({
  subjectType: AttachmentSubjectType,
  subjectId: z.string().min(1),
  organizationId: z.string().min(1),
});

/** Return the request-authenticated owner id; bodies never participate in ownership. */
function requestOwner(c: Context<AppEnv>): string {
  const userId = c.get('session')?.user.id;
  if (!userId) throw new AuthError();
  return userId;
}

/**
 * Confirm the caller can act in a workspace, and return the actor to attribute the write to.
 *
 * @remarks
 * Membership *is* the boundary here. An attach writes one row that names an entity the caller
 * already had to know the id of, in a workspace they are an active member of; a non-member's
 * request is a not-found, so it cannot be used to probe which ids exist.
 *
 * @param ownerUserId - The authenticated owner.
 * @param organizationId - The workspace the target entity lives in.
 * @returns the caller's actor id in that workspace.
 * @throws {NotFoundError} When the caller is not an active member of that workspace.
 */
async function requireMembership(ownerUserId: string, organizationId: string): Promise<string> {
  const [row] = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, ownerUserId),
        eq(actor.organizationId, organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Workspace not found');
  return row.id;
}

/**
 * Confirm the attach target exists in the named workspace.
 *
 * @param subjectType - Which kind of entity.
 * @param subjectId - Its id.
 * @param organizationId - The workspace it must belong to.
 * @throws {NotFoundError} When it is not that workspace's.
 */
async function requireSubject(
  subjectType: 'task' | 'project' | 'initiative',
  subjectId: string,
  organizationId: string,
): Promise<void> {
  const table = subjectType === 'task' ? task : subjectType === 'project' ? project : initiative;
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, subjectId), eq(table.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new NotFoundError('Attachment target not found');
}

/** Athena inbox router: the caller's address, their received messages, and what they attach to. */
const athenaMail = new Hono<AppEnv>()
  .get(
    '/address',
    apiDoc({
      tag: 'Athena',
      summary: "Get the caller's Athena inbox address",
      response: AthenaMailboxOut,
      description:
        "Return the address people can email to reach the caller's Athena, creating it on first read. When inbound mail is unavailable, the response reports `configured: false` and a null address instead of returning an address that cannot receive mail.",
    }),
    async (c) => {
      const mailbox = await ensureMailbox(requestOwner(c));
      const host = athenaMailHost();
      return ok(c, AthenaMailboxOut, {
        address: mailboxAddress(mailbox),
        host,
        configured: host !== null,
      });
    },
  )
  .get(
    '/',
    apiDoc({
      tag: 'Athena',
      summary: 'List messages Athena received',
      response: pageOf(AthenaMailMessageOut),
      description:
        "List messages received at the caller's Athena address in `receivedAt DESC, id DESC` order. Pages default to 50 items, accept at most 100, and omit `nextCursor` at exhaustion. Each item includes its attachment count.",
    }),
    zQuery(listQuery),
    async (c) => {
      const { cursor, limit } = c.req.valid('query');
      return ok(
        c,
        pageOf(AthenaMailMessageOut),
        await listOwnedMessages(requestOwner(c), limit, cursor),
      );
    },
  )
  .get(
    '/attached',
    apiDoc({
      tag: 'Athena',
      summary: 'List the Athena messages attached to one entity',
      response: pageOf(AthenaMailMessageOut),
      description:
        'List received messages attached to one task, project, or initiative in receivedAt DESC, id DESC order. Pages default to 50 items, accept at most 100, and omit nextCursor at exhaustion. Reuse a cursor only with the same entity filters.',
    }),
    zQuery(attachedQuery),
    async (c) => {
      const owner = requestOwner(c);
      const q = c.req.valid('query');
      await requireMembership(owner, q.organizationId);
      return ok(
        c,
        pageOf(AthenaMailMessageOut),
        await listMessagesAttachedTo(
          q.subjectType,
          q.subjectId,
          q.organizationId,
          q.limit,
          q.cursor,
        ),
      );
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Athena',
      summary: 'Get one message Athena received',
      response: AthenaMailMessageOut,
      description:
        'Return one received message in full, including its HTML body when it had one. Scoped to the caller: another person’s message id reads as not found.',
    }),
    zParam(idParam),
    async (c) => {
      const owner = requestOwner(c);
      const { id } = c.req.valid('param');
      const row = await loadOwnedMessage(owner, id);
      if (!row) throw new NotFoundError('Message not found');
      return ok(
        c,
        AthenaMailMessageOut,
        toMailMessageOut(row, await countAttachmentTargets(row.id)),
      );
    },
  )
  .get(
    '/:id/attachments',
    apiDoc({
      tag: 'Athena',
      summary: 'List what a received message is attached to',
      response: pageOf(AthenaMailAttachmentTargetOut),
      description:
        'List the Docket entities a received message is attached to in createdAt ASC, attachmentId ASC order. Pages default to 50 items, accept at most 100, and omit nextCursor at exhaustion.',
    }),
    zParam(idParam),
    zQuery(CursorQuery),
    async (c) => {
      const owner = requestOwner(c);
      const { id } = c.req.valid('param');
      const { cursor, limit } = c.req.valid('query');
      const row = await loadOwnedMessage(owner, id);
      if (!row) throw new NotFoundError('Message not found');
      return ok(
        c,
        pageOf(AthenaMailAttachmentTargetOut),
        await listAttachmentTargetsPage(row.id, limit, cursor),
      );
    },
  )
  .post(
    '/:id/attachments',
    apiDoc({
      status: 201,
      tag: 'Athena',
      summary: 'Attach a received message to a Docket entity',
      response: AthenaMailAttachmentTargetOut,
      description:
        'Attach a received message to a task, project, or initiative. The entity’s attachment list then shows the sender and subject and links back to the inbox message. The caller must be an active member of the target workspace, and the target must exist there. Attaching the same message to the same entity twice returns a conflict.',
    }),
    zParam(idParam),
    zJson(AthenaMailAttachBody),
    async (c) => {
      const owner = requestOwner(c);
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const message = await loadOwnedMessage(owner, id);
      if (!message) throw new NotFoundError('Message not found');

      const actorId = await requireMembership(owner, body.organizationId);
      await requireSubject(body.subjectType, body.subjectId, body.organizationId);
      await assertSharedWorkWritable(body.organizationId);

      const [existing] = await db
        .select({ id: attachment.id })
        .from(attachment)
        .where(
          and(
            eq(attachment.kind, ATHENA_MAIL_ATTACHMENT_KIND),
            eq(attachment.externalId, message.id),
            eq(attachment.subjectType, body.subjectType),
            eq(attachment.subjectId, body.subjectId),
          ),
        )
        .limit(1);
      if (existing) throw new ConflictError('This message is already attached to that item');

      const [row] = await db
        .insert(attachment)
        .values({
          organizationId: body.organizationId,
          createdBy: actorId,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          kind: ATHENA_MAIL_ATTACHMENT_KIND,
          title: message.title,
          url: messagePermalink(message.id),
          externalId: message.id,
          metadata: {
            fromAddress: message.fromAddress,
            fromName: message.fromName,
            receivedAt: message.receivedAt.toISOString(),
            snippet: message.snippet,
            streamEventId: message.streamEventId,
          },
        })
        .returning();
      /* v8 ignore next -- @preserve the insert returns its single created row */
      if (!row) throw new Error('attachment insert returned no row');

      const attached = await loadAttachmentTarget(message.id, row.id);
      /* v8 ignore next -- @preserve the row was just written and its subject was just verified */
      if (!attached) throw new Error('attachment target read back empty');
      return created(c, AthenaMailAttachmentTargetOut, attached, null);
    },
  )
  .delete(
    '/:id/attachments/:attachmentId',
    apiDoc({
      tag: 'Athena',
      summary: 'Detach a received message from a Docket entity',
      response: AttachmentRemoved,
      description:
        'Remove one attachment linking a received message to a Docket entity. The message itself is untouched — detaching is not deleting.',
    }),
    zParam(attachmentParam),
    async (c) => {
      const owner = requestOwner(c);
      const { id, attachmentId } = c.req.valid('param');
      const message = await loadOwnedMessage(owner, id);
      if (!message) throw new NotFoundError('Message not found');

      const [target] = await db
        .select({ id: attachment.id, organizationId: attachment.organizationId })
        .from(attachment)
        .where(
          and(
            eq(attachment.id, attachmentId),
            eq(attachment.kind, ATHENA_MAIL_ATTACHMENT_KIND),
            eq(attachment.externalId, message.id),
          ),
        )
        .limit(1);
      if (!target) throw new NotFoundError('Attachment not found');
      await requireMembership(owner, target.organizationId);
      await assertSharedWorkWritable(target.organizationId);

      const [removed] = await db
        .delete(attachment)
        .where(eq(attachment.id, target.id))
        .returning({ id: attachment.id });
      /* v8 ignore next -- @preserve the attachment was selected immediately before deletion */
      if (!removed) throw new NotFoundError('Attachment not found');
      return ok(c, AttachmentRemoved, { id: removed.id, removed: true });
    },
  );

/**
 * How many messages Athena has received for one owner.
 *
 * @remarks
 * Exported for tests that need to assert the separation the requirement names — that receiving an
 * Athena email adds exactly one row *here* and none to the synced-mail tables.
 *
 * @param ownerUserId - The mailbox owner.
 * @returns the number of stored messages.
 */
export async function countOwnedMessages(ownerUserId: string): Promise<number> {
  const rows = await db
    .select({ id: athenaInboundMessage.id })
    .from(athenaInboundMessage)
    .where(eq(athenaInboundMessage.ownerUserId, ownerUserId));
  return rows.length;
}

export default athenaMail;
