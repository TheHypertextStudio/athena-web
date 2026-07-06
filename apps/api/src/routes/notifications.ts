/**
 * `@docket/api` — top-level notification route composition.
 *
 * @remarks
 * `/v1/notifications` keeps the existing personal inbox endpoints for compatibility and
 * adds the staff-owned notification-intent surface used by the service-wide notification
 * system. The actual behavior lives in focused route modules.
 */
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import type { NotificationInboxService } from '../services/notifications/inbox';
import type { NotificationIntentService } from '../services/notifications/intent-service';
import { createNotificationInboxRoutes } from './notification-inbox-routes';
import { createNotificationIntentRoutes } from './notification-intent-routes';

/** Build the `/v1/notifications` route group from directly injected services. */
export function createNotificationsRoutes(
  inbox: NotificationInboxService,
  intents: NotificationIntentService,
) {
  return new Hono<AppEnv>()
    .route('/', createNotificationInboxRoutes(inbox, { tag: 'Notifications' }))
    .route('/', createNotificationIntentRoutes(intents));
}

export default createNotificationsRoutes;
