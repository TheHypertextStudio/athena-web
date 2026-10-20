/** Signed provider identity and delivery callbacks, recoverable before send acknowledgement. */
import { athenaMailOutbox, athenaMailProviderEvent, db } from '@docket/db';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';

/** Provider acceptance and terminal delivery events supported by the mail channel. */
export type MailProviderEventKind = 'sent' | 'delivered' | 'bounced';

function messageIdentity(value: string | undefined): string | null {
  return value && value.length <= 998 && /^<[^<>\s]+>$/.test(value) ? value : null;
}

/**
 * Retain an authenticated callback and apply its provider-assigned reply identity.
 * @param providerId Provider acceptance identifier, distinct from the RFC Message-ID.
 * @param type Provider acceptance or delivery outcome.
 * @param eventId Stable authenticated callback identifier for replay protection.
 * @param rfc822MessageId Actual Message-ID assigned by the sending provider.
 */
export async function recordMailProviderEvent(
  providerId: string,
  type: MailProviderEventKind,
  eventId = `${providerId}:${type}`,
  rfc822MessageId?: string,
): Promise<void> {
  const [receipt] = await db
    .insert(athenaMailProviderEvent)
    .values({
      id: eventId,
      providerMessageId: providerId,
      kind: type,
      rfc822MessageId: messageIdentity(rfc822MessageId),
    })
    .onConflictDoUpdate({
      target: athenaMailProviderEvent.id,
      set: {
        rfc822MessageId: sql<
          string | null
        >`coalesce(${athenaMailProviderEvent.rfc822MessageId}, ${messageIdentity(rfc822MessageId)})`,
      },
      setWhere: sql<boolean>`${athenaMailProviderEvent.providerMessageId} = ${providerId} AND ${athenaMailProviderEvent.kind} = ${type}`,
    })
    .returning();
  if (!receipt) return;
  const identity = receipt.rfc822MessageId;
  if (identity) {
    await db
      .update(athenaMailOutbox)
      .set({
        headers: sql<
          Record<string, string>
        >`${athenaMailOutbox.headers} || jsonb_build_object('Message-ID', ${identity}::text)`,
      })
      .where(
        and(
          eq(athenaMailOutbox.providerMessageId, providerId),
          sql<boolean>`${athenaMailOutbox.headers}->>'Message-ID' is distinct from ${identity}`,
        ),
      );
  }
  if (type === 'sent') return;
  await db
    .update(athenaMailOutbox)
    .set({
      status: type,
      errorCode: type === 'bounced' ? 'recipient_bounced' : null,
    })
    .where(
      and(
        eq(athenaMailOutbox.providerMessageId, providerId),
        type === 'delivered'
          ? inArray(athenaMailOutbox.status, ['sent', 'uncertain'])
          : inArray(athenaMailOutbox.status, ['sent', 'delivered', 'uncertain']),
      ),
    );
}

/** Reconcile signed identities and delivery outcomes that preceded the send acknowledgement. */
export async function reconcileMailProviderEvents(): Promise<void> {
  const rows = await db
    .select({ event: athenaMailProviderEvent })
    .from(athenaMailProviderEvent)
    .innerJoin(
      athenaMailOutbox,
      and(
        eq(athenaMailOutbox.providerMessageId, athenaMailProviderEvent.providerMessageId),
        or(
          and(
            isNotNull(athenaMailProviderEvent.rfc822MessageId),
            sql<boolean>`${athenaMailOutbox.headers}->>'Message-ID' is distinct from ${athenaMailProviderEvent.rfc822MessageId}`,
          ),
          and(
            eq(athenaMailProviderEvent.kind, 'delivered'),
            inArray(athenaMailOutbox.status, ['sent', 'uncertain']),
          ),
          and(
            eq(athenaMailProviderEvent.kind, 'bounced'),
            inArray(athenaMailOutbox.status, ['sent', 'uncertain', 'delivered']),
          ),
        ),
      ),
    )
    .limit(100);
  for (const { event } of rows) {
    if (event.kind === 'sent' || event.kind === 'bounced' || event.kind === 'delivered') {
      await recordMailProviderEvent(
        event.providerMessageId,
        event.kind,
        event.id,
        event.rfc822MessageId ?? undefined,
      );
    }
  }
}
