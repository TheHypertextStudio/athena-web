import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { resolveNotificationPreferences } from '../../src/services/notifications/preferences';
import {
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let contactPoints!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const { NotificationContactPointService } =
    await import('../../src/services/notifications/contact-point-service');
  const { createContactPointRoutes } = await import('../../src/routes/contact-points');
  contactPoints = createContactPointRoutes(new NotificationContactPointService(db));
});

const J = { 'content-type': 'application/json' };
const TEST_CODE = '000000';

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('contact point routes', () => {
  it('requires a signed-in user', async () => {
    const app = appWithSession(contactPoints, null);

    expect((await app.request('/')).status).toBe(401);
    expect(
      (
        await app.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ type: 'phone', value: '+17025550123' }),
        })
      ).status,
    ).toBe(401);
  });

  it('materializes the primary account email once and returns contact points newest-first', async () => {
    const userId = await seedUserWithHub(db, schema, 'ContactPointAccountEmail');
    const app = appWithSession(contactPoints, fakeSession(userId));

    const first = await body<{ items: ContactPointWire[] }>(await app.request('/'));
    const second = await body<{ items: ContactPointWire[] }>(await app.request('/'));

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      userId,
      type: 'email',
      status: 'active',
      primary: true,
      verifiedAt: expect.any(String),
    });
    expect(first.items[0]?.valueMasked).toContain('@x.test');

    const rows = await db
      .select()
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('creates a pending phone contact point and verifies it with the test verification code', async () => {
    const userId = await seedUserWithHub(db, schema, 'ContactPointPhone');
    const app = appWithSession(contactPoints, fakeSession(userId));

    const createdRes = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        type: 'phone',
        value: '+1 (702) 555-0123',
        purpose: 'sms_notifications',
      }),
    });
    expect(createdRes.status).toBe(200);
    const created = await body<ContactPointWire>(createdRes);
    expect(created).toMatchObject({
      userId,
      type: 'phone',
      valueMasked: expect.stringContaining('0123'),
      status: 'pending',
      primary: false,
      verifiedAt: null,
    });

    const wrongCode = await app.request(`/${created.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: '111111' }),
    });
    expect(wrongCode.status).toBe(409);

    const verified = await app.request(`/${created.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: TEST_CODE }),
    });
    expect(verified.status).toBe(200);
    expect(await body<ContactPointWire>(verified)).toMatchObject({
      id: created.id,
      status: 'active',
      primary: true,
      verifiedAt: expect.any(String),
    });
  });

  it('makes an active contact point primary within its type and disables contact points', async () => {
    const userId = await seedUserWithHub(db, schema, 'ContactPointPrimary');
    const first = await seedPhone(userId, '+17025550111', true);
    const second = await seedPhone(userId, '+17025550222', false);
    const app = appWithSession(contactPoints, fakeSession(userId));

    const primaryRes = await app.request(`/${second.id}/make-primary`, { method: 'POST' });
    expect(primaryRes.status).toBe(200);
    expect(await body<ContactPointWire>(primaryRes)).toMatchObject({
      id: second.id,
      primary: true,
    });

    const rows = await db
      .select({ id: schema.contactPoint.id, primary: schema.contactPoint.primary })
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.userId, userId));
    expect(rows.find((row) => row.id === first.id)?.primary).toBe(false);
    expect(rows.find((row) => row.id === second.id)?.primary).toBe(true);

    const disabledRes = await app.request(`/${second.id}`, { method: 'DELETE' });
    expect(disabledRes.status).toBe(200);
    expect(await body<ContactPointWire>(disabledRes)).toMatchObject({
      id: second.id,
      status: 'disabled',
      primary: false,
      disabledAt: expect.any(String),
    });
  });

  it('hides another user contact point behind 404', async () => {
    const me = await seedUserWithHub(db, schema, 'ContactPointMe');
    const them = await seedUserWithHub(db, schema, 'ContactPointThem');
    const theirs = await seedPhone(them, '+17025550333', true);
    const app = appWithSession(contactPoints, fakeSession(me));

    expect((await app.request(`/${theirs.id}/make-primary`, { method: 'POST' })).status).toBe(404);
    expect((await app.request(`/${theirs.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('shows bounced contact points and keeps them suppressing external delivery', async () => {
    const userId = await seedUserWithHub(db, schema, 'ContactPointBounced');
    const account = one(
      await db
        .select({ email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, userId)),
    );
    const email = one(
      await db
        .insert(schema.contactPoint)
        .values({
          userId,
          type: 'email',
          value: account.email,
          valueNormalized: account.email.toLowerCase(),
          valueMasked: `${account.email.slice(0, 1).toLowerCase()}***@x.test`,
          status: 'bounced',
          primary: true,
          verifiedAt: new Date('2026-07-07T17:00:00.000Z'),
        })
        .returning({ id: schema.contactPoint.id }),
    );
    const app = appWithSession(contactPoints, fakeSession(userId));

    const listed = await body<{ items: ContactPointWire[] }>(await app.request('/'));
    expect(listed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: email.id, status: 'bounced', primary: true }),
      ]),
    );

    const decisions = await resolveNotificationPreferences(db, {
      userId,
      category: 'service_announcement',
      priority: 'normal',
      channels: ['email'],
      now: new Date('2026-07-07T17:00:00.000Z'),
    });
    expect(decisions).toEqual([
      {
        channel: 'email',
        decision: 'suppress',
        destination: {
          type: 'email',
          contactPointId: email.id,
          valueMasked: `${account.email.slice(0, 1).toLowerCase()}***@x.test`,
        },
        suppression: { reason: 'contact_point_bounced', channel: 'email' },
      },
    ]);
  });
});

interface ContactPointWire {
  readonly id: string;
  readonly userId: string;
  readonly type: string;
  readonly valueMasked: string;
  readonly status: string;
  readonly primary: boolean;
  readonly verifiedAt: string | null;
  readonly disabledAt: string | null;
  readonly createdAt: string;
}

async function seedPhone(
  userId: string,
  value: string,
  primary: boolean,
): Promise<{ readonly id: string }> {
  return one(
    await db
      .insert(schema.contactPoint)
      .values({
        userId,
        type: 'phone',
        value,
        valueNormalized: value,
        valueMasked: `***${value.slice(-4)}`,
        status: 'active',
        primary,
        verifiedAt: new Date('2026-07-07T17:00:00.000Z'),
      })
      .returning({ id: schema.contactPoint.id }),
  );
}
