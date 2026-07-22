import { z } from 'zod';

import { Id, OrganizationId } from '@docket/types';
import { NotificationAudience } from './audience';
import { NotificationContent } from './content';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationIntentStatus,
  NotificationPriority,
  NotificationReplyPolicy,
  NotificationSenderType,
} from './enums';
import { NotificationInstant } from './shared';

/** Create/send body for a notification intent. */
export const NotificationIntentCreate = z
  .object({
    senderType: NotificationSenderType,
    senderId: z.string().min(1).optional(),
    organizationId: OrganizationId.optional(),
    category: NotificationCategory,
    priority: NotificationPriority,
    audience: NotificationAudience,
    channels: z.array(NotificationChannel).min(1),
    subject: z.string().trim().min(1),
    body: NotificationContent,
    scheduledAt: NotificationInstant.optional(),
    replyPolicy: NotificationReplyPolicy.default('none'),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .meta({ id: 'NotificationIntentCreate', description: 'Create a notification intent.' });
/** Notification-intent-create value. */
export type NotificationIntentCreate = z.infer<typeof NotificationIntentCreate>;

/** Full notification intent representation. */
export const NotificationIntentOut = z
  .object({
    id: Id,
    senderType: NotificationSenderType,
    senderId: z.string().nullable(),
    organizationId: OrganizationId.nullable(),
    category: NotificationCategory,
    priority: NotificationPriority,
    audience: NotificationAudience,
    channels: z.array(NotificationChannel),
    subject: z.string(),
    body: NotificationContent,
    replyPolicy: NotificationReplyPolicy,
    status: NotificationIntentStatus,
    scheduledAt: NotificationInstant.nullable(),
    createdAt: NotificationInstant,
    createdBy: z.string().min(1),
  })
  .meta({ id: 'NotificationIntentOut', description: 'A durable notification intent.' });
/** Notification-intent representation value. */
export type NotificationIntentOut = z.infer<typeof NotificationIntentOut>;
