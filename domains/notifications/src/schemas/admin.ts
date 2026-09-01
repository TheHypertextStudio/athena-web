import { z } from 'zod';

import {
  NotificationChannel,
  NotificationReplyPolicy,
  NotificationSuppressionReason,
} from './enums';

/** Per-channel delivery estimate for a not-yet-sent notification intent. */
export const NotificationChannelEstimate = z
  .object({
    send: z.number().int().nonnegative(),
    delay: z.number().int().nonnegative(),
    suppress: z.number().int().nonnegative(),
  })
  .meta({
    id: 'NotificationChannelEstimate',
    description: 'Delivery eligibility counts for one notification channel.',
  });
/** Per-channel delivery estimate value. */
export type NotificationChannelEstimate = z.infer<typeof NotificationChannelEstimate>;

/** Aggregated suppression estimate for a notification audience/channel pair. */
export const NotificationSuppressionEstimate = z
  .object({
    channel: NotificationChannel.optional(),
    reason: NotificationSuppressionReason,
    count: z.number().int().nonnegative(),
  })
  .meta({
    id: 'NotificationSuppressionEstimate',
    description: 'Aggregated suppression count for staff notification review.',
  });
/** Notification-suppression-estimate value. */
export type NotificationSuppressionEstimate = z.infer<typeof NotificationSuppressionEstimate>;

/** Audience and delivery estimate shown before staff sends a notification. */
export const NotificationAudienceEstimateOut = z
  .object({
    recipientCount: z.number().int().nonnegative(),
    channelCounts: z.object({
      web: NotificationChannelEstimate,
      email: NotificationChannelEstimate,
      sms: NotificationChannelEstimate,
      push: NotificationChannelEstimate,
    }),
    suppressions: z.array(NotificationSuppressionEstimate),
    approvalRequired: z.boolean(),
    approvalReasons: z.array(z.enum(['sms_multi_recipient'])),
  })
  .meta({
    id: 'NotificationAudienceEstimateOut',
    description: 'Staff-facing audience estimate for a notification intent.',
  });
/** Notification-audience-estimate value. */
export type NotificationAudienceEstimateOut = z.infer<typeof NotificationAudienceEstimateOut>;

/** Staff preview for channel-specific notification rendering. */
export const NotificationPreviewOut = z
  .object({
    subject: z.string(),
    replyPolicy: NotificationReplyPolicy,
    web: z
      .object({
        title: z.string(),
        body: z.string(),
      })
      .optional(),
    email: z
      .object({
        subject: z.string(),
        text: z.string().optional(),
        html: z.string().optional(),
      })
      .optional(),
    sms: z
      .object({
        text: z.string(),
      })
      .optional(),
    push: z
      .object({
        title: z.string(),
        body: z.string(),
      })
      .optional(),
  })
  .meta({
    id: 'NotificationPreviewOut',
    description: 'Staff-facing channel previews for a notification intent.',
  });
/** Notification-preview value. */
export type NotificationPreviewOut = z.infer<typeof NotificationPreviewOut>;
