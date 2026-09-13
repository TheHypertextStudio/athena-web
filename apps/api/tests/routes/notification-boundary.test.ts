import type * as DbModule from '@docket/db';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as Application from '../../src/app';

import {
  appWithSession,
  fakeSession,
  getDb,
  seedStaffUser,
  seedUserWithHub,
} from '../support/routes-harness';

let schema: typeof DbModule;
let application: typeof Application;

const staffOperations = [
  'GET /admin/notifications',
  'POST /admin/notifications',
  'GET /admin/notifications/:id',
  'GET /admin/notifications/:id/recipients',
  'GET /admin/notifications/:id/deliveries',
  'POST /admin/notifications/:id/test',
  'POST /admin/notifications/:id/send',
  'POST /admin/notifications/:id/cancel',
  'GET /admin/notifications/:id/estimate',
  'GET /admin/notifications/:id/preview',
  'PUT /admin/notifications/:id/decision',
  'GET /admin/notifications/:id/audit',
  'GET /admin/notifications/:id/inbound-events',
];
const personalOperations = [
  'GET /v1/me/notifications',
  'GET /v1/me/notifications/count',
  'GET /v1/me/notifications/:id',
  'POST /v1/me/notifications/read-all',
  'POST /v1/me/notifications/:id/read',
  'POST /v1/me/notifications/:id/act',
  'GET /v1/me/notifications/preferences',
  'PATCH /v1/me/notifications/preferences',
];
const retiredOperations = [
  'GET /v1/notifications',
  'POST /v1/notifications',
  'GET /v1/notifications/count',
  'GET /v1/notifications/:id',
  'POST /v1/notifications/read-all',
  'POST /v1/notifications/:id/read',
  'POST /v1/notifications/:id/act',
  'GET /v1/notifications/:id/recipients',
  'GET /v1/notifications/:id/deliveries',
  'POST /v1/notifications/:id/test',
  'POST /v1/notifications/:id/send',
  'POST /v1/notifications/:id/cancel',
  'GET /v1/me/notification-preferences',
  'PATCH /v1/me/notification-preferences',
];

beforeAll(async () => {
  schema = await getDb();
  application = await import('../../src/app');
});

function notificationOperations(routes: readonly { method: string; path: string }[]): string[] {
  return [
    ...new Set(
      routes
        .filter(
          ({ method, path }) =>
            method !== 'ALL' && !path.includes('*') && path.includes('/notifications'),
        )
        .map(({ method, path }) => `${method} ${path}`),
    ),
  ].sort();
}

function requestFor(operation: string): [string, RequestInit] {
  const [method, template] = operation.split(' ');
  if (!method || !template) throw new Error('Expected a method and path');
  return [
    template.replace(':id', '01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    {
      method,
      ...(method === 'GET'
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'acknowledge', decision: 'approved' }),
          }),
    },
  ];
}

describe('notification HTTP ownership', () => {
  it('registers only the staff and personal notification families', () => {
    expect(notificationOperations(application.app.routes)).toEqual([...personalOperations].sort());
    expect(notificationOperations(application.adminApp.routes)).toEqual(
      [...staffOperations].sort(),
    );
    expect(
      application.app.routes.some(({ path }) => path === '/v1/me/notification-preferences'),
    ).toBe(false);
  });

  it('returns 404 for every retired method to a signed-in staff caller', async () => {
    const staff = await seedStaffUser(schema.db, schema, 'support', 'NotificationRetiredRoutes');
    const app = appWithSession(application.app, fakeSession(staff.userId));
    for (const operation of retiredOperations) {
      const response = await app.request(...requestFor(operation));
      expect(response.status, operation).toBe(404);
      expect(response.headers.get('location'), operation).toBeNull();
    }
  });

  it('gates every staff operation before notification validation or access', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'NotificationNonStaff');
    for (const [session, status] of [
      [null, 401],
      [fakeSession(userId), 403],
    ] as const) {
      const app = appWithSession(application.adminApp, session);
      for (const operation of staffOperations) {
        expect((await app.request(...requestFor(operation))).status, operation).toBe(status);
      }
    }
  });

  it('resolves personal preferences before notification detail', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'NotificationPreferenceBoundary');
    const app = appWithSession(application.app, fakeSession(userId));
    const response = await app.request('/v1/me/notifications/preferences');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ userId, timezone: 'UTC' });
  });

  it('publishes the same separated notification operations in both OpenAPI documents', async () => {
    const { openapiDocument } = await import('../../src/openapi');
    for (const [surface, expected] of [
      ['v1', personalOperations],
      ['admin', staffOperations],
    ] as const) {
      const doc = (await openapiDocument(application.app, application.adminApp, surface)) as {
        paths: Record<string, Record<string, { tags?: string[] }>>;
      };
      const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
        Object.entries(methods)
          .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
          .map(([method, operation]) => ({
            method: method.toUpperCase(),
            path: path.replace('{id}', ':id'),
            operation,
          })),
      );
      expect(notificationOperations(operations)).toEqual([...expected].sort());
      const notificationDocs = operations.filter(({ path }) => path.includes('/notifications'));
      for (const { operation } of notificationDocs) {
        expect(operation.tags).toEqual([
          surface === 'v1' ? 'Notifications' : 'Admin Notifications',
        ]);
      }
      if (surface === 'v1') {
        expect(JSON.stringify(doc)).not.toContain('Notification Intents');
        expect(Object.keys(doc.paths)).not.toContain('/v1/me/notification-preferences');
      }
    }
  });
});
