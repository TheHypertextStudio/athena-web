import { createHmac } from 'node:crypto';

import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import { dispatchSystemUserNotification } from '../../src/services/notifications/system';
import { getDb, one, seedUserWithHub } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

const SECRET = 'notification-callback-test-secret';

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('internal notification callback routes', () => {
  it('rejects provider callbacks without a signature', async () => {
    const app = await buildApp();

    const res = await app.request('/internal/notifications/events/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: 'missing-signature', event: 'delivered' }),
    });

    expect(res.status).toBe(401);
  });

  it('accepts a signed email provider event and updates delivery state', async () => {
    const app = await buildApp();
    const { deliveryId } = await seedEmailDelivery('InternalNotificationEmail');
    const body = JSON.stringify({
      eventId: `internal-email-delivered-${deliveryId}`,
      event: 'delivered',
      deliveryId,
    });

    const res = await signedPost(app, '/internal/notifications/events/email', body);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      channel: 'email',
      kind: 'delivered',
      deliveryId,
    });
    const [delivery] = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.id, deliveryId));
    expect(delivery).toMatchObject({ status: 'delivered' });
  });

  it('is not exposed under the public /v1 API namespace', async () => {
    const app = await buildApp();

    const res = await app.request('/v1/notifications/events/email', { method: 'POST' });

    expect(res.status).toBe(404);
  });

  it('returns the existing normalized event for duplicate provider callbacks', async () => {
    const app = await buildApp();
    const { deliveryId } = await seedEmailDelivery('InternalNotificationDuplicate');
    const body = JSON.stringify({
      eventId: `internal-email-opened-${deliveryId}`,
      event: 'opened',
      deliveryId,
    });

    const first = await signedPost(app, '/internal/notifications/events/email', body);
    const second = await signedPost(app, '/internal/notifications/events/email', body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { id: string };
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).toBe(firstBody.id);
    const rows = await db
      .select()
      .from(schema.notificationInboundEvent)
      .where(eq(schema.notificationInboundEvent.deliveryId, deliveryId));
    expect(rows.filter((row) => row.kind === 'opened')).toHaveLength(1);
  });
});

async function buildApp(): Promise<Hono<AppEnv>> {
  const { createInternalNotificationRoutes } =
    await import('../../src/routes/internal-notifications');
  const app = new Hono<AppEnv>();
  app.route('/internal/notifications', createInternalNotificationRoutes(SECRET));
  app.onError(onError);
  return app;
}

async function signedPost(app: Hono<AppEnv>, path: string, body: string): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-docket-signature': sign(body),
    },
    body,
  });
}

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

async function seedEmailDelivery(name: string): Promise<{ readonly deliveryId: string }> {
  const userId = await seedUserWithHub(db, schema, name);
  const value = `${name.toLowerCase()}@example.test`;
  await db.insert(schema.contactPoint).values({
    userId,
    type: 'email',
    value,
    valueNormalized: value,
    valueMasked: `${name.slice(0, 1).toLowerCase()}***@example.test`,
    status: 'active',
    primary: true,
    verifiedAt: new Date('2026-07-07T17:00:00.000Z'),
  });
  const result = await dispatchSystemUserNotification(db, {
    userId,
    email: value,
    category: 'account',
    priority: 'normal',
    channels: ['email'],
    subject: `${name} subject`,
    body: { text: `${name} body` },
  });
  return { deliveryId: one(result.deliveries.filter((row) => row.channel === 'email')).id };
}
