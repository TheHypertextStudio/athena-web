/** Enrollment, revocation and current authority for Athena's owner email channel. */
import { actor, agentSession, athenaMailbox, athenaMailOutbox, db, user } from '@docket/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AthenaMailChannelOut } from '@docket/athena/athena-mail-contract';
import type { AthenaMailChannelUpdate } from '@docket/athena/athena-mail-contract';
import { env } from '../../env';
import { ConflictError, NotFoundError } from '../../error';
import { athenaMailHost, ensureMailbox, mailboxAddress } from '../../routes/athena-mail-store';

/** Read settings without enabling execution or granting email authority. */
export async function readMailChannel(
  ownerUserId: string,
): Promise<z.infer<typeof AthenaMailChannelOut>> {
  const mailbox = await ensureMailbox(ownerUserId);
  const [account] = await db.select().from(user).where(eq(user.id, ownerUserId));
  return AthenaMailChannelOut.parse({
    enabled: mailbox.enabled,
    ownerRepliesEnabled: mailbox.ownerRepliesEnabled,
    organizationId: mailbox.organizationId,
    ownerAddress: account?.emailVerified ? account.email : null,
    address: mailboxAddress(mailbox),
    configured: mailChannelConfigured(),
  });
}
/** Require live mailbox consent, unchanged account identity and workspace membership. */
export async function mailChannelAuthority(
  mailboxId: string,
  revision?: number,
): Promise<typeof athenaMailbox.$inferSelect | null> {
  const [mailbox] = await db.select().from(athenaMailbox).where(eq(athenaMailbox.id, mailboxId));
  if (
    !mailbox?.enabled ||
    !mailbox.ownerRepliesEnabled ||
    !mailbox.organizationId ||
    (revision !== undefined && mailbox.revision !== revision)
  )
    return null;
  const [account] = await db.select().from(user).where(eq(user.id, mailbox.ownerUserId));
  if (!account?.emailVerified || account.email.toLowerCase() !== mailbox.ownerAddress) return null;
  const [member] = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, mailbox.ownerUserId),
        eq(actor.organizationId, mailbox.organizationId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
        eq(actor.kind, 'human'),
      ),
    );
  return member ? mailbox : null;
}
/** Explicitly enroll the verified account email; changes revoke all earlier queued authority. */
export async function configureMailChannel(
  ownerUserId: string,
  input: z.infer<typeof AthenaMailChannelUpdate>,
): Promise<z.infer<typeof AthenaMailChannelOut>> {
  if (input.enabled && !input.organizationId)
    throw new ConflictError('Choose a workspace before enabling email.');
  if (input.enabled && !mailChannelConfigured())
    throw new ConflictError('Email channel is not configured');
  const mailbox = await ensureMailbox(ownerUserId);
  const [account] = await db.select().from(user).where(eq(user.id, ownerUserId));
  if (input.enabled && (!account?.emailVerified || !input.ownerRepliesEnabled))
    throw new ConflictError('Verify your account email and enable owner replies first.');
  const [member] = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, ownerUserId),
        eq(actor.organizationId, input.organizationId ?? ''),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
        eq(actor.kind, 'human'),
      ),
    );
  if (input.enabled && !member) throw new NotFoundError('Workspace not found');
  await db.transaction(async (tx) => {
    await tx
      .update(athenaMailbox)
      .set({
        enabled: input.enabled,
        ownerRepliesEnabled: input.ownerRepliesEnabled,
        organizationId: member ? input.organizationId : null,
        ownerAddress: account?.emailVerified ? account.email.toLowerCase() : null,
        revision: sql`${athenaMailbox.revision}+1`,
      })
      .where(eq(athenaMailbox.id, mailbox.id));
    await tx
      .update(athenaMailOutbox)
      .set({
        // Attempts cannot prove a send was rejected: an HTTP response may have been lost.
        // Keep a live sender's lease so its eventual provider receipt can still be recorded.
        status: sql`case
          when ${athenaMailOutbox.status} = 'queued' and ${athenaMailOutbox.attempts} = 0 then 'canceled'
          when ${athenaMailOutbox.status} = 'sending' and ${athenaMailOutbox.leaseExpiresAt} > now() then 'sending'
          else 'uncertain' end`,
        errorCode: 'channel_changed',
      })
      .where(
        and(
          eq(athenaMailOutbox.mailboxId, mailbox.id),
          inArray(athenaMailOutbox.status, ['queued', 'sending']),
        ),
      );
    await tx
      .update(agentSession)
      .set({ status: 'canceled', interruptedAt: new Date() })
      .where(
        and(
          eq(agentSession.ownerUserId, ownerUserId),
          sql`${agentSession.externalRunRef} LIKE 'athena-mail:%'`,
          inArray(agentSession.status, [
            'pending',
            'running',
            'awaiting_input',
            'awaiting_approval',
          ]),
        ),
      );
  });
  return readMailChannel(ownerUserId);
}

/** Runtime configuration is necessary for receiving and sending; DNS acceptance is checked operationally. */
export function mailChannelConfigured(): boolean {
  if (!athenaMailHost()) return false;
  if (env.APP_MODE === 'local' || env.APP_MODE === 'test') return true;
  return Boolean(
    (env.RESEND_RECEIVING_API_KEY ?? env.RESEND_API_KEY) &&
    env.RESEND_API_KEY &&
    env.RESEND_INBOUND_WEBHOOK_SECRET &&
    env.MAIL_FROM,
  );
}
