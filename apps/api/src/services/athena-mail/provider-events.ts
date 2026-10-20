/** Authenticate Resend delivery receipts independently of inbound-message parsing. */
import { verifySvixSignature } from '@docket/mail';
import { z } from 'zod';
import { env } from '../../env';
import { recordMailProviderEvent } from './outbox';
const ProviderEvent = z.object({
  type: z.string(),
  data: z.object({ email_id: z.string().min(1).max(256), message_id: z.unknown().optional() }),
});

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
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const parsed = ProviderEvent.safeParse(payload);
  if (!parsed.success) return false;
  const event = parsed.data;
  const kind =
    event.type === 'email.sent'
      ? 'sent'
      : event.type === 'email.delivered'
        ? 'delivered'
        : event.type === 'email.bounced'
          ? 'bounced'
          : null;
  if (kind)
    await recordMailProviderEvent(
      event.data.email_id,
      kind,
      headers['svix-id'],
      typeof event.data.message_id === 'string' ? event.data.message_id : undefined,
    );
  return true;
}
