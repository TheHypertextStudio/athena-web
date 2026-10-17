import {
  snapshotMailAttachment,
  sameMailAttachmentRefs,
} from '../services/athena-mail/attachments';
/** Outbound email is a reviewed external effect, never an ambient inbox permission. */
import { agentSession, athenaMailbox, athenaMailOutbox, db, sessionActivity } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { McpRegistrar } from './catalog';
import type { McpContext } from './auth';
import { runTool, jsonResult, scopedActor } from './result';
import { CapabilityError, ConflictError } from '../error';
import { mailboxAddress } from '../routes/athena-mail-store';
import { mailChannelAuthority } from '../services/athena-mail/channel';

const sendEmailInput = {
  orgId: z.string().min(1),
  to: z.email(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50000),
  attachments: z
    .array(
      z.object({
        messageId: z.string().min(1),
        id: z.string().min(1),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        filename: z.string().min(1).max(180),
        contentType: z.enum(['text/plain', 'text/markdown', 'text/csv']),
        size: z.number().int().min(0).max(65536),
      }),
    )
    .max(5)
    .optional(),
};

/** Register sending only through a persisted, explicitly approved Athena action snapshot. */
export function registerAthenaMailTools(
  server: McpRegistrar,
  ctx: McpContext,
  sessionId: string | null,
): void {
  server.registerTool(
    'send_email',
    {
      title: 'Send email as Athena',
      description:
        'Send this exact message from Athena after the owner reviews its recipient, subject and complete body in signed-in Docket. Never treats an email reply as approval. Attach only received owner files by messageId, attachment id and SHA-256 digest; the exact file list is part of approval.',
      inputSchema: sendEmailInput,
      outputSchema: { id: z.string(), status: z.literal('queued') },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(async () => {
        if (ctx.principal.kind !== 'user' || !sessionId) throw new CapabilityError();
        await scopedActor(ctx, input.orgId, 'work:write');
        const [session] = await db
          .select()
          .from(agentSession)
          .where(
            and(eq(agentSession.id, sessionId), eq(agentSession.ownerUserId, ctx.principal.userId)),
          );
        if (!session) throw new CapabilityError();
        const approved = await approvedEmailAction(sessionId, input);
        if (!approved) throw new CapabilityError();
        const [mailbox] = await db
          .select()
          .from(athenaMailbox)
          .where(eq(athenaMailbox.ownerUserId, ctx.principal.userId));
        const authority = mailbox ? await mailChannelAuthority(mailbox.id) : null;
        if (authority?.organizationId !== input.orgId)
          throw new ConflictError('Email channel is unavailable');
        const attachments = [];
        for (const ref of input.attachments ?? []) {
          const snapshot = await snapshotMailAttachment(
            ctx.principal.userId,
            authority.id,
            authority.revision,
            ref,
          );
          if (!sameMailAttachmentRefs([ref], [snapshot]))
            throw new ConflictError('Attachment content changed');
          attachments.push(snapshot);
        }
        const id = `email-action-${approved.id}`;
        await db
          .insert(athenaMailOutbox)
          .values({
            id,
            ownerUserId: ctx.principal.userId,
            mailboxId: authority.id,
            sessionId,
            channelRevision: authority.revision,
            toAddress: input.to.toLowerCase(),
            subject: input.subject,
            bodyText: input.body,
            externalRecipient: true,
            attachments,
            headers: {
              'Message-ID': `<${id}@${mailboxAddress(authority)?.split('@')[1]}>`,
              'Auto-Submitted': 'auto-generated',
            },
          })
          .onConflictDoNothing({ target: athenaMailOutbox.id });
        return jsonResult({ id, status: 'queued' });
      }),
  );
}

async function approvedEmailAction(
  sessionId: string,
  input: {
    orgId: string;
    to: string;
    subject: string;
    body: string;
    attachments?:
      | {
          messageId: string;
          id: string;
          digest: string;
          filename: string;
          contentType: string;
          size: number;
        }[]
      | undefined;
  },
) {
  const actions = await db
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'action'),
        eq(sessionActivity.approvalStatus, 'executing'),
      ),
    );
  return actions.find((action) => {
    const call = action.body.action?.toolCall;
    if (call?.tool !== 'send_email' || !call.input || typeof call.input !== 'object') return false;
    const snapshot = call.input as Record<string, unknown>;
    return (
      snapshot['orgId'] === input.orgId &&
      snapshot['to'] === input.to &&
      snapshot['subject'] === input.subject &&
      snapshot['body'] === input.body &&
      sameMailAttachmentRefs(snapshot['attachments'], input.attachments ?? [])
    );
  });
}
