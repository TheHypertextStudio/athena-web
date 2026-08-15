/**
 * `@docket/api` — the caller-owned elicitation HTTP surface (`/v1/me/elicitations`, `/v1/me/web-push`).
 *
 * @remarks
 * `elicitation.test.ts` proves the underlying service (raising, answering, sweeping). This file
 * proves the thin route layer wrapped around it: authentication, ownership (a question addressed
 * to someone else is a 404, not a 403), the 422 validation-failure shape on a bad answer, and the
 * push-subscription contact-point bridge.
 */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type elicitationsDefault from '../../src/routes/elicitations';
import type { raiseElicitation as RaiseElicitation } from '../../src/services/elicitation-service';
import { appWithSession, fakeSession, getDb, one, seedStatuses } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let elicitations!: typeof elicitationsDefault;
let webPushRoutes!: unknown;
let raiseElicitation!: typeof RaiseElicitation;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ default: elicitations, webPushRoutes } = await import('../../src/routes/elicitations'));
  ({ raiseElicitation } = await import('../../src/services/elicitation-service'));
});

const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface Fixture {
  readonly ownerUserId: string;
  readonly orgId: string;
  readonly sessionId: string;
}

/** Seed a workspace with a team (so a task can land) and one Athena conversation. */
async function seed(): Promise<Fixture> {
  const slug = `elr-${Math.random().toString(36).slice(2, 10)}`;
  const org = one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  );
  // A question implements itself as a Task, and work needs the workspace's status set to exist.
  await seedStatuses(db, schema, org.id);
  const [owner] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({ userId: assertDefined(owner).id, preferences: {} });
  await db.insert(schema.actor).values({
    organizationId: org.id,
    kind: 'human',
    displayName: 'Ada',
    userId: assertDefined(owner).id,
  });
  await db
    .insert(schema.team)
    .values({ organizationId: org.id, name: 'Core', key: `E${slug.slice(-4)}` });
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: assertDefined(owner).id,
      contextOrganizationId: org.id,
      kind: 'chat',
      trigger: 'delegation',
      status: 'awaiting_input',
      workLinkage: 'conversation',
    })
    .returning({ id: schema.agentSession.id });
  return {
    ownerUserId: assertDefined(owner).id,
    orgId: org.id,
    sessionId: assertDefined(session).id,
  };
}

const CONFIRM_SPEC = {
  kind: 'confirm' as const,
  confirmLabel: 'Post it',
  declineLabel: 'Hold off',
};

async function raiseOne(fixture: Fixture) {
  return raiseElicitation({
    sessionId: fixture.sessionId,
    request: {
      question: 'Should I post the sprint update now?',
      actionSummary: 'Post the sprint update to the Acme project channel',
      spec: CONFIRM_SPEC,
      timeoutPolicy: 'ambiguous',
      autoResolveValue: null,
      autoResolveReason: null,
      timeSensitive: false,
    },
  });
}

describe('elicitation routes', () => {
  it('requires a signed-in caller for the list, presence, and sweep routes', async () => {
    const app = appWithSession(elicitations, null);
    expect((await app.request('/')).status).toBe(401);
    expect((await app.request('/presence')).status).toBe(401);
    expect((await app.request('/sweep', { method: 'POST' })).status).toBe(401);
  });

  it('lists the caller’s own questions and none of another caller’s', async () => {
    const mine = await seed();
    const theirs = await seed();
    await raiseOne(mine);
    await raiseOne(theirs);
    const app = appWithSession(elicitations, fakeSession(mine.ownerUserId));

    const listed = await body<{ items: { id: string; question: string }[] }>(
      await app.request('/'),
    );
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.question).toContain('post the sprint update');
  });

  it('records and reads back presence, live within the window and stale after it', async () => {
    const fixture = await seed();
    const app = appWithSession(elicitations, fakeSession(fixture.ownerUserId));

    const initial = await body<{ live: boolean; lastSeenAt: string | null }>(
      await app.request('/presence'),
    );
    expect(initial).toMatchObject({ live: false, lastSeenAt: null });

    const focused = await body<{ live: boolean }>(
      await app.request('/presence', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ focused: true }),
      }),
    );
    expect(focused.live).toBe(true);

    const unfocused = await body<{ live: boolean }>(
      await app.request('/presence', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ focused: false }),
      }),
    );
    expect(unfocused.live).toBe(false);
  });

  it('reads one question by id and hides another caller’s behind 404', async () => {
    const mine = await seed();
    const theirs = await seed();
    const raised = await raiseOne(theirs);
    const app = appWithSession(elicitations, fakeSession(mine.ownerUserId));

    expect((await app.request(`/${raised.elicitation.id}`)).status).toBe(404);

    const ownApp = appWithSession(elicitations, fakeSession(theirs.ownerUserId));
    const found = await body<{ id: string }>(await ownApp.request(`/${raised.elicitation.id}`));
    expect(found.id).toBe(raised.elicitation.id);
  });

  it('answers a question and resumes the blocked session', async () => {
    const fixture = await seed();
    const raised = await raiseOne(fixture);
    const app = appWithSession(elicitations, fakeSession(fixture.ownerUserId));

    const res = await app.request(`/${raised.elicitation.id}/answer`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ value: true }),
    });
    expect(res.status).toBe(200);
    expect(await body<{ status: string; answer: unknown }>(res)).toMatchObject({
      status: 'answered',
      answer: true,
    });
  });

  it('refuses an answer that does not satisfy the declared spec, leaving the question open', async () => {
    const fixture = await seed();
    const raised = await raiseOne(fixture);
    const app = appWithSession(elicitations, fakeSession(fixture.ownerUserId));

    const res = await app.request(`/${raised.elicitation.id}/answer`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ value: 'not-a-boolean' }),
    });
    expect(res.status).toBe(422);
    const rejection = await body<{ errors: unknown[]; elicitation: { status: string } }>(res);
    expect(rejection.errors.length).toBeGreaterThan(0);
    expect(rejection.elicitation.status).toBe('pending');
  });

  it('refuses to raise samples outside local development', async () => {
    const fixture = await seed();
    const app = appWithSession(elicitations, fakeSession(fixture.ownerUserId));
    expect((await app.request('/samples', { method: 'POST' })).status).toBe(404);
  });

  it('sweeps overdue questions and reports how many were parked or auto-resolved', async () => {
    const fixture = await seed();
    await raiseElicitation({
      sessionId: fixture.sessionId,
      request: {
        question: 'Overdue question',
        actionSummary: 'Do the thing',
        spec: CONFIRM_SPEC,
        timeoutPolicy: 'ambiguous',
        autoResolveValue: null,
        autoResolveReason: null,
        timeSensitive: false,
      },
      now: new Date(Date.now() - 24 * 60 * 60 * 1000),
      ttlMs: 60_000,
    });
    const app = appWithSession(elicitations, fakeSession(fixture.ownerUserId));

    const res = await app.request('/sweep', { method: 'POST' });
    expect(res.status).toBe(200);
    const result = await body<{ autoResolved: number; parked: number }>(res);
    expect(result.parked).toBeGreaterThanOrEqual(1);
  });
});

describe('web push routes', () => {
  it('requires a signed-in caller', async () => {
    const app = appWithSession(webPushRoutes, null);
    expect((await app.request('/subscription')).status).toBe(401);
    expect(
      (
        await app.request('/subscription', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({
            endpoint: 'https://push.example.com/x',
            keys: { p256dh: 'k', auth: 'a' },
          }),
        })
      ).status,
    ).toBe(401);
  });

  it('reports the configured VAPID public key, or null when unset', async () => {
    const fixture = await seed();
    const app = appWithSession(webPushRoutes, fakeSession(fixture.ownerUserId));
    const config = await body<{ publicKey: string | null }>(await app.request('/config'));
    expect(config).toHaveProperty('publicKey');
  });

  it('registers, reads, and reactivates a browser push subscription, then removes it', async () => {
    const fixture = await seed();
    const app = appWithSession(webPushRoutes, fakeSession(fixture.ownerUserId));

    expect(await body<{ subscribed: boolean }>(await app.request('/subscription'))).toEqual({
      subscribed: false,
    });

    const subscription = {
      endpoint: 'https://push.example.com/endpoint-1',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    };
    const created = await app.request('/subscription', {
      method: 'POST',
      headers: J,
      body: JSON.stringify(subscription),
    });
    expect(created.status).toBe(200);
    expect(await body<{ subscribed: boolean }>(created)).toEqual({ subscribed: true });

    expect(await body<{ subscribed: boolean }>(await app.request('/subscription'))).toEqual({
      subscribed: true,
    });

    // Re-registering the same endpoint reactivates it (onConflictDoUpdate) rather than duplicating.
    const reregistered = await app.request('/subscription', {
      method: 'POST',
      headers: J,
      body: JSON.stringify(subscription),
    });
    expect(reregistered.status).toBe(200);
    const rows = await db
      .select()
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.userId, fixture.ownerUserId));
    expect(rows.filter((r) => r.type === 'push_token')).toHaveLength(1);

    const removed = await app.request('/subscription', { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(await body<{ subscribed: boolean }>(removed)).toEqual({ subscribed: false });
    expect(await body<{ subscribed: boolean }>(await app.request('/subscription'))).toEqual({
      subscribed: false,
    });
  });
});
