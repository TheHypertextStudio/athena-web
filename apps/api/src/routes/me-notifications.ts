/**
 * `@docket/api` — signed-in user's long-term notification inbox surface.
 */
import type { NotificationInboxService } from '../services/notifications/inbox';
import { createNotificationInboxRoutes } from './notification-inbox-routes';

/** Build the `/v1/me/notifications` route group from a directly injected inbox service. */
export function createMeNotificationsRoutes(inbox: NotificationInboxService) {
  return createNotificationInboxRoutes(inbox, {
    tag: 'Me Notifications',
    includeDetail: true,
  });
}

export default createMeNotificationsRoutes;
