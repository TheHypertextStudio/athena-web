/**
 * `@docket/api` — service-admin service-control routes: reading the instance-wide Lattice
 * switches, changing them as a superadmin, the audit rows a change writes, and the refusals.
 *
 * @remarks
 * Mirrors the {@link adminApp} harness used by the other admin route tests: the admin router is
 * mounted behind an injected Better Auth session so `staffMiddleware` resolves the caller's
 * `staff_user` row. The controls are instance-wide, so every test starts from a cleared
 * `service_control` table rather than assuming what a previous test left behind.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithSession, fakeSession, getDb } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let admin!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  admin = (await import('../../src/app')).adminRouter;
});

beforeEach(async () => {
  await db.delete(schema.serviceControl);
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let counter = 0;
/** A unique suffix per call (keeps emails distinct across the shared PGlite db). */
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}sc`;
}

/** Insert a user; returns its id. */
async function makeUser(name = 'User'): Promise<string> {
  const u = uniq();
  const rows = await db
    .insert(schema.user)
    .values({ name: `${name} ${u}`, email: `${name.toLowerCase()}-${u}@example.com` })
    .returning({ id: schema.user.id });
  return assertDefined(rows[0]).id;
}

/** Insert a staff_user keyed to a fresh user; returns { userId, staffUserId }. */
async function makeStaff(
  role: 'support' | 'finance' | 'superadmin',
): Promise<{ userId: string; staffUserId: string }> {
  const userId = await makeUser('Staff');
  const rows = await db
    .insert(schema.staffUser)
    .values({ userId, role })
    .returning({ id: schema.staffUser.id });
  return { userId, staffUserId: assertDefined(rows[0]).id };
}

/** The service-control audit rows one operator wrote for one control key. */
async function auditRowsFor(key: string, staffUserId: string): Promise<unknown[]> {
  const rows = await db.select().from(schema.operatorAuditEvent);
  return rows
    .filter(
      (r) =>
        r.type === 'service_control.updated' &&
        r.subjectType === 'service_control' &&
        r.subjectId === key &&
        r.staffUserId === staffUserId,
    )
    .map((r) => r.metadata);
}

/** PATCH the controls as the given session. */
async function patchControls(userId: string, body: unknown): Promise<Response> {
  return appWithSession(admin, fakeSession(userId)).request('/service-controls', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface ControlsBody {
  latticeSubmissionsEnabled: boolean;
  latticePollingEnabled: boolean;
  serviceProbesEnabled: boolean;
}

describe('service controls — read', () => {
  it('reports both controls enabled for any staff tier when nothing is stored', async () => {
    const support = await makeStaff('support');
    const res = await appWithSession(admin, fakeSession(support.userId)).request(
      '/service-controls',
    );
    expect(res.status).toBe(200);
    expect(await json<ControlsBody>(res)).toEqual({
      latticeSubmissionsEnabled: true,
      latticePollingEnabled: true,
      serviceProbesEnabled: true,
    });
  });

  it('reports a stored value in place of the default', async () => {
    await db
      .insert(schema.serviceControl)
      .values({ key: 'lattice_polling', enabled: false, updatedBy: null });
    const support = await makeStaff('support');
    const res = await appWithSession(admin, fakeSession(support.userId)).request(
      '/service-controls',
    );
    expect(res.status).toBe(200);
    expect(await json<ControlsBody>(res)).toEqual({
      latticeSubmissionsEnabled: true,
      latticePollingEnabled: false,
      serviceProbesEnabled: true,
    });
  });

  it('401s without a session and 403s a signed-in non-operator', async () => {
    expect((await appWithSession(admin, null).request('/service-controls')).status).toBe(401);
    const outsider = await makeUser('Outsider');
    expect(
      (await appWithSession(admin, fakeSession(outsider)).request('/service-controls')).status,
    ).toBe(403);
  });
});

describe('service controls — update', () => {
  it('stores one control, leaves the other, and audits the change', async () => {
    const sup = await makeStaff('superadmin');
    const res = await patchControls(sup.userId, { latticeSubmissionsEnabled: false });
    expect(res.status).toBe(200);
    expect(await json<ControlsBody>(res)).toEqual({
      latticeSubmissionsEnabled: false,
      latticePollingEnabled: true,
      serviceProbesEnabled: true,
    });

    const rows = await db
      .select()
      .from(schema.serviceControl)
      .where(eq(schema.serviceControl.key, 'lattice_submissions'));
    expect(rows.length).toBe(1);
    expect(assertDefined(rows[0]).enabled).toBe(false);
    expect(assertDefined(rows[0]).updatedBy).toBe(sup.staffUserId);

    expect(await auditRowsFor('lattice_submissions', sup.staffUserId)).toEqual([
      { key: 'lattice_submissions', enabled: false },
    ]);
    expect(await auditRowsFor('lattice_polling', sup.staffUserId)).toEqual([]);
  });

  it('changes both controls in one request and audits each', async () => {
    const sup = await makeStaff('superadmin');
    const res = await patchControls(sup.userId, {
      latticeSubmissionsEnabled: false,
      latticePollingEnabled: false,
      serviceProbesEnabled: true,
    });
    expect(res.status).toBe(200);
    expect(await json<ControlsBody>(res)).toEqual({
      latticeSubmissionsEnabled: false,
      latticePollingEnabled: false,
      serviceProbesEnabled: true,
    });
    expect((await auditRowsFor('lattice_submissions', sup.staffUserId)).length).toBe(1);
    expect((await auditRowsFor('lattice_polling', sup.staffUserId)).length).toBe(1);
  });

  it('turns a disabled control back on without adding a second row', async () => {
    const sup = await makeStaff('superadmin');
    expect((await patchControls(sup.userId, { latticePollingEnabled: false })).status).toBe(200);
    const res = await patchControls(sup.userId, { latticePollingEnabled: true });
    expect(res.status).toBe(200);
    expect((await json<ControlsBody>(res)).latticePollingEnabled).toBe(true);

    const rows = await db
      .select()
      .from(schema.serviceControl)
      .where(eq(schema.serviceControl.key, 'lattice_polling'));
    expect(rows.length).toBe(1);
    expect(assertDefined(rows[0]).enabled).toBe(true);
    expect((await auditRowsFor('lattice_polling', sup.staffUserId)).length).toBe(2);
  });

  it('403s a finance operator and stores nothing', async () => {
    const fin = await makeStaff('finance');
    expect((await patchControls(fin.userId, { latticePollingEnabled: false })).status).toBe(403);
    expect((await db.select().from(schema.serviceControl)).length).toBe(0);
  });

  it('401s without a session', async () => {
    const res = await appWithSession(admin, null).request('/service-controls', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ latticePollingEnabled: false }),
    });
    expect(res.status).toBe(401);
  });

  it('422s a non-boolean value, a null value, and an empty change set', async () => {
    const sup = await makeStaff('superadmin');
    expect((await patchControls(sup.userId, { latticePollingEnabled: 'off' })).status).toBe(422);
    expect((await patchControls(sup.userId, { latticeSubmissionsEnabled: null })).status).toBe(422);
    expect((await patchControls(sup.userId, {})).status).toBe(422);
    expect((await db.select().from(schema.serviceControl)).length).toBe(0);
  });
});
