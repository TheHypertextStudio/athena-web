import type { NotificationCategory } from '../schemas';
import { NotificationDeliveryHint, NotificationWebUrl } from '../schemas';
import type { NotificationWebProjection, NotificationWebProjectionInput } from './types';

/** Renders a notification intent into the existing Hub inbox row shape. */
export function renderNotificationWebProjection(
  input: NotificationWebProjectionInput,
): NotificationWebProjection {
  const persistedUrl = NotificationWebUrl.safeParse(input.body.webUrl);
  const url = input.url ?? (persistedUrl.success ? persistedUrl.data : undefined);
  return {
    type: notificationWebTypeForCategory(input.category),
    body: {
      title: input.subject,
      ...(input.body.text ? { summary: input.body.text } : {}),
      ...(url ? { url } : {}),
      category: input.category,
    },
  };
}

/** Maps notification-service categories into the legacy inbox event taxonomy. */
export function notificationWebTypeForCategory(
  category: NotificationCategory,
): NotificationWebProjection['type'] {
  if (category === 'service_announcement') return 'service_announcement';
  if (category === 'workflow') return 'automation';
  return 'status_change';
}

/** Safely read compact delivery-channel hints from an inbox notification body. */
export function notificationDeliveryHintsFromBody(
  body: Record<string, unknown>,
): readonly NotificationDeliveryHint[] {
  const parsed = NotificationDeliveryHint.array().safeParse(body['deliveryChannels']);
  return parsed.success ? parsed.data : [];
}
