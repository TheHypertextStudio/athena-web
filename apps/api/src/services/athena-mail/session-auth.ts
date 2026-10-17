/** Live authorization for isolated native email sessions. */
import { athenaInboundMessage, db } from '@docket/db';
import { eq } from 'drizzle-orm';
import { mailChannelAuthority } from './channel';
/** Email-origin jobs are isolated child invocations, never a second canonical conversation. */
export function isMailSession(session: { externalRunRef: string | null }): boolean {
  return session.externalRunRef?.startsWith('athena-mail:') === true;
}
/** Recheck consent and current owner identity before every email-origin generation. */
export async function mailSessionAuthorized(session: {
  externalRunRef: string | null;
  id: string;
}): Promise<boolean> {
  if (!isMailSession(session)) return true;
  const [message] = await db
    .select()
    .from(athenaInboundMessage)
    .where(eq(athenaInboundMessage.id, session.externalRunRef?.slice('athena-mail:'.length) ?? ''));
  return Boolean(
    message && (await mailChannelAuthority(message.mailboxId, message.channelRevision ?? -1)),
  );
}
