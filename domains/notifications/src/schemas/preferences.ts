import { z } from 'zod';

import { NotificationInstant } from './shared';

/** Per-category channel preferences. */
export const NotificationChannelPreference = z
  .object({
    web: z.boolean().optional(),
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    push: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .meta({ id: 'NotificationChannelPreference', description: 'Per-channel preference values.' });
/** Notification-channel-preference value. */
export type NotificationChannelPreference = z.infer<typeof NotificationChannelPreference>;

/** Quiet-hours preference. */
export const NotificationQuietHours = z
  .object({
    enabled: z.boolean(),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).min(1),
    allowUrgent: z.boolean().optional(),
  })
  .meta({ id: 'NotificationQuietHours', description: 'Quiet-hours preference window.' });
/** Notification-quiet-hours value. */
export type NotificationQuietHours = z.infer<typeof NotificationQuietHours>;

/** Category preference map keyed by category name. */
export const NotificationCategoryPreferences = z.record(z.string(), NotificationChannelPreference);
/** Notification-category-preferences value. */
export type NotificationCategoryPreferences = z.infer<typeof NotificationCategoryPreferences>;

/** Per-org category preference map. */
export const NotificationOrganizationPreferences = z.record(
  z.string(),
  NotificationCategoryPreferences,
);
/** Notification-organization-preferences value. */
export type NotificationOrganizationPreferences = z.infer<
  typeof NotificationOrganizationPreferences
>;

/** Patch body for the caller's notification preferences. */
export const NotificationPreferencePatch = z
  .object({
    timezone: z.string().min(1).optional(),
    quietHours: NotificationQuietHours.optional(),
    categories: NotificationCategoryPreferences.optional(),
    organizations: NotificationOrganizationPreferences.optional(),
  })
  .meta({
    id: 'NotificationPreferencePatch',
    description: 'Patch the caller notification preferences.',
  });
/** Notification-preference-patch value. */
export type NotificationPreferencePatch = z.infer<typeof NotificationPreferencePatch>;

/** Full user notification preference representation. */
export const NotificationPreferenceOut = z
  .object({
    userId: z.string().min(1),
    timezone: z.string().min(1),
    quietHours: NotificationQuietHours.nullable(),
    categories: NotificationCategoryPreferences,
    organizations: NotificationOrganizationPreferences,
    updatedAt: NotificationInstant,
  })
  .meta({ id: 'NotificationPreferenceOut', description: 'User notification preferences.' });
/** Notification-preference representation value. */
export type NotificationPreferenceOut = z.infer<typeof NotificationPreferenceOut>;
