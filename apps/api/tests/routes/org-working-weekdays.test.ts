import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  WorkspaceSettingsUpdate,
  type WorkspaceSettingsOut,
} from '../../src/contracts/organization';
import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let orgsRouter: unknown;
const headers = { 'content-type': 'application/json' };

async function fixture(manager = true) {
  const schema = await getDb();
  const userId = await seedUserWithHub(schema.db, schema, 'WorkingCalendar');
  const orgId = await seedOrg(schema.db, schema);
  const actorId = await addMember(schema.db, schema, orgId, userId, manager ? 'owner' : 'member');
  const [member] = await schema.db.select().from(schema.actor).where(eq(schema.actor.id, actorId));
  if (manager && member?.roleId) {
    await schema.db
      .update(schema.role)
      .set({ capabilities: ['manage'] })
      .where(eq(schema.role.id, member.roleId));
  }
  return {
    schema,
    orgId,
    app: appWithSession(orgsRouter, fakeSession(userId)),
    path: `/${orgId}/settings/work-structure`,
  };
}

async function savedWeekdays(f: Awaited<ReturnType<typeof fixture>>) {
  const [row] = await f.schema.db
    .select()
    .from(f.schema.organization)
    .where(eq(f.schema.organization.id, f.orgId));
  return row?.workingWeekdays;
}

describe('working-weekday contract', () => {
  it('retains an explicitly chosen calendar at the update boundary', () => {
    expect(WorkspaceSettingsUpdate.parse({ workingWeekdays: [2, 4, 6] })).toEqual({
      workingWeekdays: [2, 4, 6],
    });
  });
  it('rejects an empty calendar at the update boundary', () => {
    expect(WorkspaceSettingsUpdate.safeParse({ workingWeekdays: [] }).success).toBe(false);
  });
  it('does not add a default calendar to an unrelated patch', () => {
    expect(WorkspaceSettingsUpdate.parse({ fiscalYearStartMonth: 6 })).toEqual({
      fiscalYearStartMonth: 6,
    });
  });
});

describe('workspace working weekdays', () => {
  beforeAll(async () => {
    orgsRouter = (await import('../../src/routes/orgs')).default;
  });
  it('reads Monday through Friday by default', async () => {
    const f = await fixture();
    const response = await f.app.request(f.path);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workingWeekdays: [1, 2, 3, 4, 5] });
  });

  it('lets an administrator persist a nonstandard calendar and read it back', async () => {
    const f = await fixture();
    const response = await f.app.request(f.path, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ workingWeekdays: [2, 4, 6] }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workingWeekdays: [2, 4, 6] });
    expect(await savedWeekdays(f)).toEqual([2, 4, 6]);
    expect(await (await f.app.request(f.path)).json()).toMatchObject({
      workingWeekdays: [2, 4, 6],
    });
  });

  it.each([[], [1, 1], [5, 1], [0], [8], [1.5], ['1'], null])(
    'rejects invalid calendar %j without changing it',
    async (workingWeekdays) => {
      const f = await fixture();
      const response = await f.app.request(f.path, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ workingWeekdays }),
      });
      expect(response.status).toBe(422);
      expect(await savedWeekdays(f)).toEqual([1, 2, 3, 4, 5]);
    },
  );

  it('allows members to read the calendar but rejects their edits', async () => {
    const f = await fixture(false);
    expect((await f.app.request(f.path)).status).toBe(200);
    expect(
      (
        await f.app.request(f.path, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ workingWeekdays: [7] }),
        })
      ).status,
    ).toBe(403);
    expect(await savedWeekdays(f)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not disclose or change another workspace calendar', async () => {
    const f = await fixture();
    const otherOrgId = await seedOrg(f.schema.db, f.schema);
    const path = `/${otherOrgId}/settings/work-structure`;
    expect((await f.app.request(path)).status).toBe(404);
    expect(
      (
        await f.app.request(path, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ workingWeekdays: [7] }),
        })
      ).status,
    ).toBe(404);
  });

  it('preserves the calendar when another workspace setting changes', async () => {
    const f = await fixture();
    await f.schema.db
      .update(f.schema.organization)
      .set({ workingWeekdays: [2, 4] })
      .where(eq(f.schema.organization.id, f.orgId));
    const response = await f.app.request(f.path, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fiscalYearStartMonth: 6 }),
    });
    expect(response.status).toBe(200);
    const settings = (await response.json()) as WorkspaceSettingsOut;
    expect(settings).toMatchObject({ workingWeekdays: [2, 4], fiscalYearStartMonth: 6 });
    expect(await savedWeekdays(f)).toEqual([2, 4]);
  });
});
