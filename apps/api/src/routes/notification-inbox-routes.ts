import {
  NotificationAct,
  NotificationCount,
  NotificationListQuery,
  NotificationOut,
  NotificationReadAll,
  NotificationReadAllResult,
  pageOf,
} from '@docket/types';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import type { NotificationInboxUseCases } from '../services/notifications/inbox';

const idParam = z.object({ id: z.string() });

/** Options for building a user-owned inbox route group. */
export interface NotificationInboxRouteOptions {
  /** OpenAPI tag attached to the route group. */
  readonly tag: string;
  /** Whether to expose `GET /:id` for a single inbox item. */
  readonly includeDetail?: boolean;
}

/** Dependencies consumed by the notification inbox route factory. */
export interface NotificationInboxRouteDependencies {
  /** Signed-in user inbox use cases. */
  readonly inbox: NotificationInboxUseCases;
}

/** Build the signed-in user's notification inbox HTTP routes. */
export function createNotificationInboxRoutes(deps: NotificationInboxRouteDependencies) {
  return (options: NotificationInboxRouteOptions) => {
    const router = new Hono<AppEnv>()
      .get(
        '/',
        apiDoc({
          tag: options.tag,
          summary: 'List notifications',
          response: pageOf(NotificationOut),
          description:
            'List the signed-in user notifications across every organization they belong to, newest first. Optional filters only narrow within the caller-owned inbox.',
        }),
        zQuery(NotificationListQuery),
        async (c) => {
          const session = c.get('session');
          if (!session?.user) throw new AuthError();
          const page = await deps.inbox.list(session.user.id, c.req.valid('query'));
          return ok(c, pageOf(NotificationOut), page);
        },
      )
      .get(
        '/count',
        apiDoc({
          tag: options.tag,
          summary: 'Get notification counts',
          response: NotificationCount,
          description:
            'Return unread and pending approval counts for the signed-in user notification inbox.',
        }),
        async (c) => {
          const session = c.get('session');
          if (!session?.user) throw new AuthError();
          return ok(c, NotificationCount, await deps.inbox.count(session.user.id));
        },
      )
      .post(
        '/read-all',
        apiDoc({
          tag: options.tag,
          summary: 'Mark notifications read',
          response: NotificationReadAllResult,
          description:
            'Bulk-mark unread caller-owned notifications read, optionally narrowed by organization or type.',
        }),
        zJson(NotificationReadAll),
        async (c) => {
          const session = c.get('session');
          if (!session?.user) throw new AuthError();
          const result = await deps.inbox.readAll(session.user.id, c.req.valid('json'));
          return ok(c, NotificationReadAllResult, result);
        },
      );

    if (options.includeDetail) {
      router.get(
        '/:id',
        apiDoc({
          tag: options.tag,
          summary: 'Get a notification',
          response: NotificationOut,
          description:
            'Return one caller-owned notification. Missing or another-user notifications are hidden behind 404.',
        }),
        zParam(idParam),
        async (c) => {
          const session = c.get('session');
          if (!session?.user) throw new AuthError();
          const notification = await deps.inbox.get(session.user.id, c.req.valid('param').id);
          if (!notification) throw new NotFoundError('Notification not found');
          return ok(c, NotificationOut, notification);
        },
      );
    }

    return router
      .post(
        '/:id/read',
        apiDoc({
          tag: options.tag,
          summary: 'Mark a notification read',
          response: NotificationOut,
          description:
            'Mark one caller-owned notification read. Missing or another-user notifications are hidden behind 404.',
        }),
        zParam(idParam),
        async (c) => {
          const session = c.get('session');
          if (!session?.user) throw new AuthError();
          const notification = await deps.inbox.markRead(session.user.id, c.req.valid('param').id);
          if (!notification) throw new NotFoundError('Notification not found');
          return ok(c, NotificationOut, notification);
        },
      )
      .post(
        '/:id/act',
        apiDoc({
          tag: options.tag,
          summary: 'Act on a notification',
          response: NotificationOut,
          description:
            'Apply a low-risk inline action to one caller-owned notification. The current persisted model records handled items as read.',
        }),
        zParam(idParam),
        zJson(NotificationAct),
        async (c) => {
          const session = c.get('session');
          if (!session?.user) throw new AuthError();
          const notification = await deps.inbox.act(
            session.user.id,
            c.req.valid('param').id,
            c.req.valid('json').action,
          );
          if (!notification) throw new NotFoundError('Notification not found');
          return ok(c, NotificationOut, notification);
        },
      );
  };
}
