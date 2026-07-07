import { createHmac, timingSafeEqual } from 'node:crypto';

import { db } from '@docket/db';
import { NotificationInboundEventOut } from '@docket/notifications';
import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppEnv } from '../context';
import { env } from '../env';
import {
  normalizeEmailProviderPayload,
  normalizePushProviderPayload,
  normalizeSmsProviderPayload,
  recordNotificationProviderEvent,
  type NormalizedNotificationProviderEvent,
} from '../services/notifications/inbound';

type Normalizer = (payload: Record<string, unknown>) => NormalizedNotificationProviderEvent;

/** Build internal provider callback routes for normalized notification events and replies. */
export function createInternalNotificationRoutes(secret = env.BETTER_AUTH_SECRET) {
  return new Hono<AppEnv>()
    .post('/events/email', (c) =>
      handleNotificationCallback(c, secret, normalizeEmailProviderPayload),
    )
    .post('/events/sms', (c) => handleNotificationCallback(c, secret, normalizeSmsProviderPayload))
    .post('/events/push', (c) =>
      handleNotificationCallback(c, secret, normalizePushProviderPayload),
    )
    .post('/inbound/email', (c) =>
      handleNotificationCallback(c, secret, (payload) =>
        normalizeEmailProviderPayload({ ...payload, event: payload['event'] ?? 'replied' }),
      ),
    )
    .post('/inbound/sms', (c) =>
      handleNotificationCallback(c, secret, (payload) =>
        normalizeSmsProviderPayload({ ...payload, event: payload['event'] ?? 'replied' }),
      ),
    );
}

const internalNotifications = createInternalNotificationRoutes();

export default internalNotifications;

async function handleNotificationCallback(
  c: Context<AppEnv>,
  secret: string,
  normalize: Normalizer,
): Promise<Response> {
  const rawBody = await c.req.text();
  if (!verifySignature(secret, rawBody, c.req.header('x-docket-signature'))) {
    return c.json({ error: 'signature verification failed' }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (!isRecord(payload)) return c.json({ error: 'invalid payload' }, 400);

  const event = await recordNotificationProviderEvent(db, normalize(payload));
  return c.json(NotificationInboundEventOut.parse(event));
}

function verifySignature(secret: string, rawBody: string, presented: string | undefined): boolean {
  if (!secret || !presented) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const actual = presented.startsWith('sha256=') ? presented.slice('sha256='.length) : presented;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
