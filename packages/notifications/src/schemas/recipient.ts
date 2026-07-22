import { z } from 'zod';

import { Id, OrganizationId } from '@docket/types';
import {
  NotificationChannel,
  NotificationRecipientReason,
  NotificationSuppressionReason,
} from './enums';
import { NotificationInstant } from './shared';

/** One suppression attached to a recipient or delivery. */
export const NotificationSuppression = z
  .object({
    reason: NotificationSuppressionReason,
    channel: NotificationChannel.optional(),
    detail: z.string().optional(),
  })
  .meta({ id: 'NotificationSuppression', description: 'A notification suppression reason.' });
/** Notification-suppression value. */
export type NotificationSuppression = z.infer<typeof NotificationSuppression>;

/** Recipient snapshot representation. */
export const NotificationRecipientOut = z
  .object({
    id: Id,
    notificationId: Id,
    userId: z.string().min(1),
    organizationId: OrganizationId.nullable(),
    reason: NotificationRecipientReason,
    suppressions: z.array(NotificationSuppression).default([]),
    createdAt: NotificationInstant,
  })
  .meta({ id: 'NotificationRecipientOut', description: 'One immutable notification recipient.' });
/** Notification-recipient representation value. */
export type NotificationRecipientOut = z.infer<typeof NotificationRecipientOut>;
