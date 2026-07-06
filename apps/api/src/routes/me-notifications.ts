/**
 * `@docket/api` — signed-in user's long-term notification inbox surface.
 */
import type { NotificationInboxUseCases } from '../services/notifications/inbox';
import { createNotificationInboxRoutes } from './notification-inbox-routes';

/** Build the `/v1/me/notifications` route group from injected inbox use cases. */
export function createMeNotificationsRoutes(deps: { readonly inbox: NotificationInboxUseCases }) {
  return createNotificationInboxRoutes(deps)({
    tag: 'Me Notifications',
    includeDetail: true,
  });
}

export default createMeNotificationsRoutes;
