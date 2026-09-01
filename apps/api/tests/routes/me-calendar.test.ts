/**
 * `@docket/api` — `src/routes/me-calendar.ts` gaps left by the other calendar route test files.
 *
 * @remarks
 * `calendar-agenda.test.ts`, `calendar-items.test.ts`, `calendar-write-back.test.ts`,
 * `calendar-task-links.test.ts`, and `calendar-collaboration.test.ts` already exercise this
 * router's happy paths. This file closes the branches those leave untouched: the two
 * visibility-PATCH 404s, `resolveTaskTarget`'s workspace/team-not-found and membership/capability
 * boundaries, its `workflowStates[0]?.key ?? 'backlog'` fallback, and the create-task dual-write's
 * silent skip when no matching `calendar_item` row exists yet.
 */
import { genId } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarSettingsOut } from '@docket/planning/calendar-contract';
import type { TaskOut } from '@docket/work/task-model';

import {
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedBaseOrg,
  seedGoogleAccount,
  seedUserWithHub,
} from '../support/routes-harness';

let calendarRouter: unknown;

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function jsonHeaders() {
  return { 'content-type': 'application/json' };
}

beforeAll(async () => {
  calendarRouter = (await import('../../src/routes/me-calendar')).default;
});

describe('PATCH /calendars/:id — not found', () => {
  it('404s when the calendar id does not belong to the caller', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'CalNotFound');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request('/calendars/does-not-exist', {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ selected: false }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /layers/:id — not found', () => {
  it('404s when the layer id does not belong to the caller', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'LayerNotFound');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request('/layers/does-not-exist', {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ selected: false }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /events/:id/create-task — resolveTaskTarget branches', () => {
  async function seedEvent(label: string) {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, label);
    const base = await seedBaseOrg(schema.db, schema);
    const contributorRole = one(
      await schema.db
        .insert(schema.role)
        .values({
          organizationId: base.orgId,
          key: 'calendar-contributor',
          name: 'Calendar contributor',
          capabilities: ['contribute'],
        })
        .returning({ id: schema.role.id }),
    );
    await schema.db
      .update(schema.actor)
      .set({ userId, roleId: contributorRole.id })
      .where(eq(schema.actor.id, base.humanActorId));
    await seedGoogleAccount(schema.db, schema, userId, `${label}-sub`);
    const connection = one(
      await schema.db
        .insert(schema.calendarConnection)
        .values({
          userId,
          externalAccountId: `${label}-sub`,
          accountEmail: `${label}@example.com`,
          accountName: label,
          status: 'connected',
        })
        .returning({ id: schema.calendarConnection.id }),
    );
    const calendar = one(
      await schema.db
        .insert(schema.calendarList)
        .values({
          userId,
          connectionId: connection.id,
          externalCalendarId: 'primary',
          title: 'Primary',
        })
        .returning({ id: schema.calendarList.id }),
    );
    const event = one(
      await schema.db
        .insert(schema.calendarEvent)
        .values({
          userId,
          connectionId: connection.id,
          calendarId: calendar.id,
          externalCalendarId: 'primary',
          externalEventId: `${label}-evt`,
          title: 'Board meeting',
          startsAt: new Date('2026-07-01T10:00:00.000Z'),
          endsAt: new Date('2026-07-01T11:00:00.000Z'),
        })
        .returning({ id: schema.calendarEvent.id }),
    );
    return { schema, userId, base, event };
  }

  async function expectNoCreatedTaskOrAttachment(
    schema: Awaited<ReturnType<typeof getDb>>,
    organizationId: string,
  ) {
    const [tasks, attachments] = await Promise.all([
      schema.db
        .select({ id: schema.task.id })
        .from(schema.task)
        .where(eq(schema.task.organizationId, organizationId)),
      schema.db
        .select({ id: schema.attachment.id })
        .from(schema.attachment)
        .where(eq(schema.attachment.organizationId, organizationId)),
    ]);

    expect(tasks).toEqual([]);
    expect(attachments).toEqual([]);
  }

  it('404s when the caller has no actor in the requested organization', async () => {
    const { schema, userId, event } = await seedEvent('NoWorkspace');
    const otherOrg = await seedBaseOrg(schema.db, schema);
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request(`/events/${event.id}/create-task`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ organizationId: otherOrg.orgId }),
    });
    expect(res.status).toBe(404);
    const body = await json<{ code: string }>(res);
    expect(body.code).toBe('not_found');
  });

  it('404s without creating a task or attachment for a suspended member', async () => {
    const { schema, userId, base, event } = await seedEvent('SuspendedMembership');
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, base.humanActorId));
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request(`/events/${event.id}/create-task`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ organizationId: base.orgId, teamId: base.teamId }),
    });

    expect(res.status).toBe(404);
    await expectNoCreatedTaskOrAttachment(schema, base.orgId);
  });

  it('requires contribute from active Guest and roleless members before creating task artifacts', async () => {
    for (const membership of ['guest', 'roleless'] as const) {
      const { schema, userId, base, event } = await seedEvent(`NoContribute${membership}`);
      if (membership === 'guest') {
        const guestRole = one(
          await schema.db
            .insert(schema.role)
            .values({
              organizationId: base.orgId,
              key: 'guest',
              name: 'Guest',
              capabilities: [],
            })
            .returning({ id: schema.role.id }),
        );
        await schema.db
          .update(schema.actor)
          .set({ roleId: guestRole.id })
          .where(eq(schema.actor.id, base.humanActorId));
      } else {
        await schema.db
          .update(schema.actor)
          .set({ roleId: null })
          .where(eq(schema.actor.id, base.humanActorId));
      }
      const app = appWithSession(calendarRouter, fakeSession(userId));

      const res = await app.request(`/events/${event.id}/create-task`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ organizationId: base.orgId, teamId: base.teamId }),
      });

      expect(res.status, `${membership} member status`).toBe(403);
      await expectNoCreatedTaskOrAttachment(schema, base.orgId);
    }
  });

  it('404s when the requested team does not belong to the resolved workspace', async () => {
    const { userId, base, event } = await seedEvent('NoTeam');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request(`/events/${event.id}/create-task`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ organizationId: base.orgId, teamId: genId() }),
    });
    expect(res.status).toBe(404);
    const body = await json<{ code: string }>(res);
    expect(body.code).toBe('not_found');
  });

  it('falls back to the "backlog" state when the target team has no workflow states', async () => {
    const { schema, userId, base, event } = await seedEvent('NoWorkflowStates');
    await schema.db
      .update(schema.team)
      .set({ workflowStates: [] })
      .where(eq(schema.team.id, base.teamId));
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request(`/events/${event.id}/create-task`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ organizationId: base.orgId, teamId: base.teamId }),
    });
    expect(res.status).toBe(200);
    const created = await json<TaskOut>(res);
    expect(created.state).toBe('backlog');
  });

  it('resolves the default workspace and team when neither is specified in the body', async () => {
    const { userId, event } = await seedEvent('DefaultTarget');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request(`/events/${event.id}/create-task`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const created = await json<TaskOut>(res);
    expect(created.title).toBe('Board meeting');
  });

  it('skips the calendar_item task-link dual-write silently when no matching item row exists', async () => {
    const { schema, userId, base, event } = await seedEvent('NoDualWriteRow');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    // Deliberately no `calendar_item` row shares this event's id — pre-dual-write legacy data.
    const res = await app.request(`/events/${event.id}/create-task`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ organizationId: base.orgId, teamId: base.teamId }),
    });
    expect(res.status).toBe(200);
    const created = await json<TaskOut>(res);

    const links = await schema.db
      .select()
      .from(schema.calendarItemTaskLink)
      .where(eq(schema.calendarItemTaskLink.taskId, created.id));
    expect(links).toEqual([]);

    // The attachment (the legacy source of truth) is still created regardless.
    const attachments = await schema.db
      .select()
      .from(schema.attachment)
      .where(
        and(
          eq(schema.attachment.subjectId, created.id),
          eq(schema.attachment.kind, 'calendar_event'),
        ),
      );
    expect(attachments).toHaveLength(1);
  });

  it.each([
    ['free', null, 'product_required'],
    ['canceled', 'canceled', 'product_required'],
    ['expired grace', 'past_due', 'billing_grace_expired'],
  ] as const)(
    'does not create task artifacts in a shared %s workspace',
    async (_label, status, expectedCode) => {
      const { schema, userId, base, event } = await seedEvent(`ReadOnly${_label}`);
      await schema.db
        .delete(schema.organizationProductEntitlement)
        .where(eq(schema.organizationProductEntitlement.organizationId, base.orgId));
      if (status !== null) {
        await schema.db.insert(schema.organizationProductEntitlement).values({
          organizationId: base.orgId,
          productKey: 'docket_pro',
          status,
          source: 'stripe',
          ...(status === 'past_due' ? { graceEndsAt: new Date('2000-01-01T00:00:00.000Z') } : {}),
        });
      }
      const app = appWithSession(calendarRouter, fakeSession(userId));

      const res = await app.request(`/events/${event.id}/create-task`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ organizationId: base.orgId, teamId: base.teamId }),
      });

      expect(res.status).toBe(402);
      expect(await json<{ code: string }>(res)).toMatchObject({ code: expectedCode });
      await expectNoCreatedTaskOrAttachment(schema, base.orgId);
    },
  );

  it('creates a task in a free personal workspace', async () => {
    const { schema, userId, base, event } = await seedEvent('PersonalBaseline');
    await Promise.all([
      schema.db
        .delete(schema.organizationProductEntitlement)
        .where(eq(schema.organizationProductEntitlement.organizationId, base.orgId)),
      schema.db
        .update(schema.organization)
        .set({ isPersonal: true })
        .where(eq(schema.organization.id, base.orgId)),
    ]);
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request(`/events/${event.id}/create-task`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ organizationId: base.orgId, teamId: base.teamId }),
    });

    expect(res.status).toBe(200);
  });
});

describe('GET / — settings passthrough', () => {
  it('returns an empty settings payload for a caller with no linked calendars', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'EmptySettings');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await json<CalendarSettingsOut>(res);
    expect(body.connections).toEqual([]);
    expect(body.calendars).toEqual([]);
  });
});
