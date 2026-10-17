/** Authenticate Resend delivery receipts independently of inbound-message parsing. */
import { verifySvixSignature } from '@docket/mail';
import { env } from '../../env';
import { recordMailProviderEvent } from './outbox';
/** Only signed provider events may change email delivery state. */
export async function receiveMailProviderEvent(
  rawBody: string,
  headers: Record<string, string>,
): Promise<boolean> {
  if (!env.RESEND_INBOUND_WEBHOOK_SECRET) return false;
  const verified = verifySvixSignature({
    secret: env.RESEND_INBOUND_WEBHOOK_SECRET,
    now: new Date(),
    id: headers['svix-id'],
    timestamp: headers['svix-timestamp'],
    signature: headers['svix-signature'],
    payload: rawBody,
  });
  if (!verified.ok) return false;
  const payload: unknown = JSON.parse(rawBody);
  if (!payload || typeof payload !== 'object') return false;
  const event = payload as { type?: unknown; data?: { email_id?: unknown } };
  if (typeof event.data?.email_id !== 'string') return false;
  if (event.type === 'email.delivered')
    await recordMailProviderEvent(event.data.email_id, 'delivered', headers['svix-id']);
  else if (event.type === 'email.bounced')
    await recordMailProviderEvent(event.data.email_id, 'bounced', headers['svix-id']);
  return true;
}
