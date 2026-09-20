import {
  NotificationPreferenceOut,
  NotificationPreferencePatch,
} from '@docket/notifications/schemas';
import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson } from '../lib/validate';
import type { NotificationPreferenceService } from '../services/notifications/preference-service';

/** Build the signed-in user's notification preference routes. */
export function createNotificationPreferenceRoutes(preferences: NotificationPreferenceService) {
  return new Hono<AppEnv>()
    .get(
      '/',
      apiDoc({
        tag: 'Notifications',
        summary: 'Get notification preferences',
        response: NotificationPreferenceOut,
        description:
          "Return the caller's notification preferences. Missing category and channel choices appear with their defaults. Security and account categories remain locked.",
      }),
      async (c) => {
        const userId = requireUserId(c);
        return ok(c, NotificationPreferenceOut, await preferences.get(userId));
      },
    )
    .patch(
      '/',
      apiDoc({
        tag: 'Notifications',
        summary: 'Update notification preferences',
        response: NotificationPreferenceOut,
        description:
          'Patch mutable category/channel preferences, quiet hours, timezone, and org-scoped overrides for the signed-in user.',
      }),
      zJson(NotificationPreferencePatch),
      async (c) => {
        const userId = requireUserId(c);
        return ok(
          c,
          NotificationPreferenceOut,
          await preferences.patch(userId, c.req.valid('json')),
        );
      },
    );
}

function requireUserId(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session.user.id;
}

export default createNotificationPreferenceRoutes;
