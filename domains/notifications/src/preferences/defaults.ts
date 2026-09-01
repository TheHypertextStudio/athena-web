import type { NotificationCategory, NotificationChannelPreference } from '../schemas';

const defaultPreferences = {
  security: { web: true, email: true, sms: true, push: true, locked: true },
  account: { web: true, email: true, sms: false, push: false, locked: true },
  service_announcement: { web: true, email: true, sms: false, push: false },
  workflow: { web: true, email: false, sms: false, push: false },
  digest: { web: false, email: false, sms: false, push: false },
  billing: { web: true, email: true, sms: false, push: false },
  marketing: { web: false, email: false, sms: false, push: false },
} as const satisfies Record<NotificationCategory, NotificationChannelPreference>;

/** Returns the default channel preference for a notification category. */
export function defaultNotificationChannelPreference(
  category: NotificationCategory,
): NotificationChannelPreference {
  return { ...defaultPreferences[category] };
}
