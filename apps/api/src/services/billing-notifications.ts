/** Essential customer notices for payment, access, discounts, and complimentary grants. */
import type { Database } from '@docket/db';
import { dispatchNotificationIntent } from '@docket/notifications/dispatch';
import { OrganizationId } from '@docket/identity-access/ids';

/** Input for one organization-wide billing notice. */
export interface EssentialBillingNotice {
  /** Organization whose members receive the notice. */
  readonly organizationId: string;
  /** Stable event identity that suppresses duplicate deliveries. */
  readonly idempotencyKey: string;
  /** Customer-facing subject and in-app title. */
  readonly subject: string;
  /** Customer-facing body text. */
  readonly text: string;
  /** Whether access is at immediate risk. */
  readonly urgent?: boolean;
}

/**
 * Send a payment or product-access notice even when optional billing messages are disabled.
 *
 * @param database - Docket database.
 * @param notice - Organization, copy, urgency, and stable delivery identity.
 */
export async function dispatchEssentialBillingNotice(
  database: Database,
  notice: EssentialBillingNotice,
): Promise<void> {
  const organizationId = OrganizationId.parse(notice.organizationId);
  await dispatchNotificationIntent(database, {
    senderType: 'system',
    organizationId,
    category: 'billing',
    priority: notice.urgent ? 'high' : 'normal',
    audience: { type: 'organization', organizationId },
    channels: ['web', 'email'],
    subject: notice.subject,
    body: { text: notice.text },
    replyPolicy: 'none',
    createdBy: 'system',
    webUrl: `/orgs/${encodeURIComponent(notice.organizationId)}/settings/billing`,
    idempotencyKey: notice.idempotencyKey,
    preferenceMode: 'skip_user_preferences',
  });
}
