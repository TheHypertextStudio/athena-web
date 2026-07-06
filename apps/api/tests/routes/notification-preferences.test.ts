import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { appWithSession, fakeSession, getDb, seedBaseOrg, seedUserWithHub } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let preferences!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const { NotificationPreferenceService } =
    await import('../../src/services/notifications/preference-service');
  const { createNotificationPreferenceRoutes } =
    await import('../../src/routes/notification-preferences');
  preferences = createNotificationPreferenceRoutes(new NotificationPreferenceService(db));
});

const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('notification preference routes', () => {
  it('requires a signed-in user', async () => {
    const app = appWithSession(preferences, null);

    expect((await app.request('/')).status).toBe(401);
    expect(
      (
        await app.request('/', {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ timezone: 'America/Los_Angeles' }),
        })
      ).status,
    ).toBe(401);
  });

  it('returns materialized defaults with locked security/account categories explained by flags', async () => {
    const userId = await seedUserWithHub(db, schema, 'PreferenceRouteDefaults');
    const app = appWithSession(preferences, fakeSession(userId));

    const res = await app.request('/');

    expect(res.status).toBe(200);
    const prefs = await body<{
      userId: string;
      timezone: string;
      quietHours: Record<string, unknown> | null;
      categories: Record<string, Record<string, boolean>>;
      organizations: Record<string, unknown>;
      updatedAt: string;
    }>(res);
    expect(prefs).toMatchObject({
      userId,
      timezone: 'UTC',
      quietHours: null,
      organizations: {},
    });
    expect(prefs.updatedAt).toEqual(expect.any(String));
    expect(prefs.categories['service_announcement']).toMatchObject({ web: true, email: true });
    expect(prefs.categories['workflow']).toMatchObject({ web: true, email: false, push: false });
    expect(prefs.categories['security']).toMatchObject({
      web: true,
      email: true,
      sms: true,
      push: true,
      locked: true,
    });
    expect(prefs.categories['account']).toMatchObject({ web: true, email: true, locked: true });
  });

  it('patches category preferences and quiet hours while preserving locked category defaults', async () => {
    const userId = await seedUserWithHub(db, schema, 'PreferenceRoutePatch');
    const app = appWithSession(preferences, fakeSession(userId));

    const res = await app.request('/', {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        timezone: 'America/Los_Angeles',
        quietHours: {
          enabled: true,
          start: '18:00',
          end: '08:00',
          days: ['mon', 'tue', 'wed', 'thu', 'fri'],
          allowUrgent: true,
        },
        categories: {
          service_announcement: { email: false },
          workflow: { push: true, email: false },
          security: { email: false, sms: false },
        },
      }),
    });

    expect(res.status).toBe(200);
    const prefs = await body<{
      timezone: string;
      quietHours: { enabled: boolean; start: string; end: string; days: string[] };
      categories: Record<string, Record<string, boolean>>;
    }>(res);
    expect(prefs.timezone).toBe('America/Los_Angeles');
    expect(prefs.quietHours).toMatchObject({
      enabled: true,
      start: '18:00',
      end: '08:00',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    });
    expect(prefs.categories['service_announcement']).toMatchObject({ web: true, email: false });
    expect(prefs.categories['workflow']).toMatchObject({ web: true, email: false, push: true });
    expect(prefs.categories['security']).toMatchObject({ email: true, sms: true, locked: true });

    const rows = await db
      .select()
      .from(schema.notificationPreference)
      .where(eq(schema.notificationPreference.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.categories).toMatchObject({
      service_announcement: { email: false },
      workflow: { push: true, email: false },
    });
    expect(rows[0]?.categories).not.toHaveProperty('security');
  });

  it('stores org-scoped overrides used by preference resolution', async () => {
    const userId = await seedUserWithHub(db, schema, 'PreferenceRouteOrg');
    const { orgId } = await seedBaseOrg(db, schema);
    const app = appWithSession(preferences, fakeSession(userId));

    const res = await app.request('/', {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        organizations: {
          [orgId]: {
            workflow: { email: true, push: true },
            security: { email: false },
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const prefs = await body<{ organizations: Record<string, Record<string, unknown>> }>(res);
    expect(prefs.organizations[orgId]).toMatchObject({
      workflow: { email: true, push: true },
    });
    expect(prefs.organizations[orgId]).not.toHaveProperty('security');
  });

  it('rejects invalid quiet-hours input with validation errors', async () => {
    const userId = await seedUserWithHub(db, schema, 'PreferenceRouteInvalid');
    const app = appWithSession(preferences, fakeSession(userId));

    const res = await app.request('/', {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        quietHours: {
          enabled: true,
          start: '6pm',
          end: '08:00',
          days: [],
        },
      }),
    });

    expect(res.status).toBe(422);
  });
});
