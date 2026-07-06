import { ContactPointCreate, ContactPointOut, ContactPointVerify } from '@docket/notifications';
import { pageOf } from '@docket/types';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import type { NotificationContactPointService } from '../services/notifications/contact-point-service';

const idParam = z.object({ id: z.string() });

/** Build the signed-in user's notification contact-point routes. */
export function createContactPointRoutes(contactPoints: NotificationContactPointService) {
  return new Hono<AppEnv>()
    .get(
      '/',
      apiDoc({
        tag: 'Me Contact Points',
        summary: 'List notification contact points',
        response: pageOf(ContactPointOut),
        description:
          'List caller-owned email, phone, and push-token contact points. The primary account email is materialized as an active contact point when absent.',
      }),
      async (c) => {
        const userId = requireUserId(c);
        return ok(c, pageOf(ContactPointOut), await contactPoints.list(userId));
      },
    )
    .post(
      '/',
      apiDoc({
        tag: 'Me Contact Points',
        summary: 'Create a notification contact point',
        response: ContactPointOut,
        description:
          'Create a pending caller-owned destination for notification delivery. Phone contact points are verified before SMS delivery can use them.',
      }),
      zJson(ContactPointCreate),
      async (c) => {
        const userId = requireUserId(c);
        return ok(c, ContactPointOut, await contactPoints.create(userId, c.req.valid('json')));
      },
    )
    .post(
      '/:id/verify',
      apiDoc({
        tag: 'Me Contact Points',
        summary: 'Verify a contact point',
        response: ContactPointOut,
        description:
          'Verify one pending caller-owned contact point with its short-lived verification code.',
      }),
      zParam(idParam),
      zJson(ContactPointVerify),
      async (c) => {
        const userId = requireUserId(c);
        return ok(
          c,
          ContactPointOut,
          await contactPoints.verify(userId, c.req.valid('param').id, c.req.valid('json')),
        );
      },
    )
    .post(
      '/:id/make-primary',
      apiDoc({
        tag: 'Me Contact Points',
        summary: 'Make a contact point primary',
        response: ContactPointOut,
        description:
          'Make one active verified caller-owned contact point primary within its destination type.',
      }),
      zParam(idParam),
      async (c) => {
        const userId = requireUserId(c);
        return ok(
          c,
          ContactPointOut,
          await contactPoints.makePrimary(userId, c.req.valid('param').id),
        );
      },
    )
    .delete(
      '/:id',
      apiDoc({
        tag: 'Me Contact Points',
        summary: 'Disable a contact point',
        response: ContactPointOut,
        description:
          'Disable one caller-owned contact point without deleting delivery history that may reference it.',
      }),
      zParam(idParam),
      async (c) => {
        const userId = requireUserId(c);
        return ok(c, ContactPointOut, await contactPoints.disable(userId, c.req.valid('param').id));
      },
    );
}

function requireUserId(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session.user.id;
}

export default createContactPointRoutes;
