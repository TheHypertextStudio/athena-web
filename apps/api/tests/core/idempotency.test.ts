import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { ConflictError, onError } from '../../src/error';
import { idempotency } from '../../src/lib/idempotency';
import {
  appWithActor,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedInitiative,
  seedProject,
  seedTask,
} from '../support/routes-harness';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** A promise that a test can settle after a concurrent request reaches a known point. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Build a test app with a real idempotency store and one authenticated caller. */
function idempotentApp(userId: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(userId));
    await next();
  });
  app.use('*', idempotency);
  app.onError(onError);
  return app;
}

beforeAll(async () => {
  await getDb();
});

describe('idempotency retry guidance', () => {
  it('leases an in-progress object command briefly and retains its completed receipt for 48 hours', async () => {
    const database = await getDb();
    const userId = `idempotency-object-retention-${crypto.randomUUID()}`;
    const app = idempotentApp(userId);
    const entered = deferred();
    const release = deferred();
    app.post('/v1/orgs/org-1/object-commands', async (c) => {
      entered.resolve();
      await release.promise;
      return c.json({ id: 'created' }, 201);
    });
    const key = `new-object-command-${crypto.randomUUID()}`;

    const pending = app.request('/v1/orgs/org-1/object-commands', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body: JSON.stringify({ commandId: key }),
    });
    await entered.promise;
    const claimRows = await database.db
      .select()
      .from(database.idempotencyKey)
      .where(and(eq(database.idempotencyKey.userId, userId), eq(database.idempotencyKey.key, key)))
      .limit(1);
    expect(claimRows[0]?.status).toBe('in_progress');
    expect(
      (claimRows[0]?.expiresAt.getTime() ?? 0) - (claimRows[0]?.createdAt.getTime() ?? 0),
    ).toBeGreaterThan(4 * 60 * 1000);
    expect(
      (claimRows[0]?.expiresAt.getTime() ?? 0) - (claimRows[0]?.createdAt.getTime() ?? 0),
    ).toBeLessThan(6 * 60 * 1000);

    release.resolve();
    const response = await pending;
    const completedRows = await database.db
      .select()
      .from(database.idempotencyKey)
      .where(and(eq(database.idempotencyKey.userId, userId), eq(database.idempotencyKey.key, key)))
      .limit(1);

    expect(response.status).toBe(201);
    expect(completedRows[0]?.status).toBe('completed');
    expect(
      (completedRows[0]?.expiresAt.getTime() ?? 0) - (completedRows[0]?.createdAt.getTime() ?? 0),
    ).toBeGreaterThan(47 * 60 * 60 * 1000);
  });

  it('reclaims a pre-deploy object-command claim after the crash-recovery lease', async () => {
    const database = await getDb();
    const userId = `idempotency-object-margin-${crypto.randomUUID()}`;
    const app = idempotentApp(userId);
    let handlerCalls = 0;
    app.post('/v1/orgs/org-1/object-commands', (c) => {
      handlerCalls += 1;
      return c.json({ id: 'created-after-crash' }, 201);
    });
    const key = `old-object-command-${crypto.randomUUID()}`;
    const body = JSON.stringify({ commandId: key });
    const path = '/v1/orgs/org-1/object-commands';
    const requestHash = createHash('sha256').update(`POST\n${path}\n${body}`).digest('base64url');
    const now = Date.now();
    await database.db.insert(database.idempotencyKey).values({
      userId,
      key,
      method: 'POST',
      path,
      requestHash,
      status: 'in_progress',
      createdAt: new Date(now - 6 * 60 * 1000),
      expiresAt: new Date(now + 48 * 60 * 60 * 1000),
    });

    const response = await app.request(path, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body,
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('Retry-After')).toBeNull();
    expect(handlerCalls).toBe(1);
  });

  it('marks a same-request in-progress conflict with a one-second Retry-After', async () => {
    const entered = deferred();
    const release = deferred();
    const app = idempotentApp(`idempotency-in-progress-${crypto.randomUUID()}`);
    let handlerCalls = 0;
    app.post('/creates', async (c) => {
      handlerCalls += 1;
      if (handlerCalls === 1) {
        entered.resolve();
        await release.promise;
      }
      return c.json({ id: 'created' }, 201);
    });
    const key = `concurrent-${crypto.randomUUID()}`;
    const request = () =>
      app.request('/creates', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body: JSON.stringify({ title: 'One request' }),
      });

    const firstPending = request();
    await entered.promise;
    const retry = await request();
    release.resolve();
    const first = await firstPending;

    expect(first.status).toBe(201);
    expect(retry.status).toBe(409);
    expect(retry.headers.get('Retry-After')).toBe('1');
    expect(handlerCalls).toBe(1);
  });

  it('reclaims an expired in-progress claim while concurrent reclaimers still execute once', async () => {
    const database = await getDb();
    const entered = deferred();
    const release = deferred();
    const userId = `idempotency-expired-${crypto.randomUUID()}`;
    const app = idempotentApp(userId);
    let handlerCalls = 0;
    app.post('/creates', async (c) => {
      handlerCalls += 1;
      entered.resolve();
      await release.promise;
      return c.json({ id: 'created-after-reclaim' }, 201);
    });
    const key = `expired-${crypto.randomUUID()}`;
    await database.db.insert(database.idempotencyKey).values({
      userId,
      key,
      method: 'POST',
      path: '/creates',
      requestHash: 'expired-request-hash',
      status: 'in_progress',
      expiresAt: new Date(Date.now() - 1),
    });
    const request = () =>
      app.request('/creates', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body: JSON.stringify({ title: 'Reclaimed request' }),
      });

    const pending = [Promise.resolve(request()), Promise.resolve(request())] as const;
    await entered.promise;
    await Promise.resolve();
    release.resolve();
    const responses = await Promise.all(pending);

    expect(handlerCalls).toBe(1);
    expect(responses.every((response) => response.status === 201 || response.status === 409)).toBe(
      true,
    );
    expect(responses.some((response) => response.status === 201)).toBe(true);
    expect(
      responses.filter(
        (response) =>
          response.headers.get('Retry-After') === '1' ||
          response.headers.get('Idempotency-Replayed') === 'true',
      ),
    ).toHaveLength(1);
  });

  it('does not attach Retry-After to a domain conflict', async () => {
    const app = idempotentApp(`idempotency-domain-conflict-${crypto.randomUUID()}`);
    app.post('/conflict', () => {
      throw new ConflictError('The domain state conflicts with this request');
    });

    const response = await app.request('/conflict', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: 'Conflicting request' }),
    });

    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBeNull();
  });

  it('refuses a cached object-command response after workspace membership is removed', async () => {
    const database = await getDb();
    const base = await seedBaseOrg(database.db, database);
    const [user] = await database.db
      .insert(database.user)
      .values({
        name: 'Removed replay member',
        email: `removed-replay-${crypto.randomUUID()}@x.test`,
      })
      .returning({ id: database.user.id });
    if (!user) throw new Error('replay test user was not created');
    await database.db
      .update(database.actor)
      .set({ userId: user.id })
      .where(eq(database.actor.id, base.humanActorId));
    const target = await seedTask(database.db, database, base.statusId, {
      organizationId: base.orgId,
      teamId: base.teamId,
      title: 'Replay membership target',
      state: 'todo',
      priority: 'medium',
    });
    await database.db.insert(database.grant).values({
      organizationId: base.orgId,
      subjectKind: 'actor',
      subjectId: base.humanActorId,
      resourceKind: 'task',
      resourceId: target.id,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: false,
    });
    const key = `membership-replay-${crypto.randomUUID()}`;
    const path = `/v1/orgs/${base.orgId}/object-commands`;
    const body = JSON.stringify({ commandId: key });
    const responseBody = {
      appliedIds: [target.id],
      conflictingIds: [],
      deniedIds: [],
      receipt: {
        commandId: key,
        objectKind: 'task',
        action: 'replace_property',
        entries: [
          {
            kind: 'object',
            objectId: target.id,
            property: 'priority',
            before: 'medium',
            after: 'high',
          },
        ],
      },
    };
    await database.db.insert(database.idempotencyKey).values({
      userId: user.id,
      key,
      organizationId: base.orgId,
      method: 'POST',
      path,
      requestHash: createHash('sha256').update(`POST\n${path}\n${body}`).digest('base64url'),
      responseStatus: 200,
      responseBody,
      status: 'completed',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const app = idempotentApp(user.id);
    let handlerCalls = 0;
    app.post(path, (c) => {
      handlerCalls += 1;
      return c.json({ id: 'must-not-execute' });
    });
    const request = () =>
      app.request(path, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body,
      });

    const authorized = await request();
    await database.db
      .update(database.actor)
      .set({ archivedAt: new Date() })
      .where(eq(database.actor.id, base.humanActorId));
    const removed = await request();

    expect(authorized.status).toBe(200);
    expect(authorized.headers.get('Idempotency-Replayed')).toBe('true');
    expect(removed.status).toBe(404);
    expect(removed.headers.get('Idempotency-Replayed')).toBeNull();
    expect(handlerCalls).toBe(0);
  });

  it('requires current contribute access before replaying a cached object command', async () => {
    const database = await getDb();
    const base = await seedBaseOrg(database.db, database);
    const [user] = await database.db
      .insert(database.user)
      .values({
        name: 'Revoked replay viewer',
        email: `revoked-replay-${crypto.randomUUID()}@x.test`,
      })
      .returning({ id: database.user.id });
    if (!user) throw new Error('replay visibility user was not created');
    await database.db
      .update(database.actor)
      .set({ userId: user.id })
      .where(eq(database.actor.id, base.humanActorId));
    const target = await seedTask(database.db, database, base.statusId, {
      organizationId: base.orgId,
      teamId: base.teamId,
      title: 'Private replay target',
      state: 'todo',
      priority: 'medium',
      visibility: 'private',
    });
    await database.db.insert(database.grant).values({
      organizationId: base.orgId,
      subjectKind: 'actor',
      subjectId: base.humanActorId,
      resourceKind: 'task',
      resourceId: target.id,
      capabilities: ['view'],
      effect: 'allow',
      cascades: false,
    });
    const key = `visibility-replay-${crypto.randomUUID()}`;
    const path = `/v1/orgs/${base.orgId}/object-commands`;
    const body = JSON.stringify({ commandId: key });
    await database.db.insert(database.idempotencyKey).values({
      userId: user.id,
      key,
      organizationId: base.orgId,
      method: 'POST',
      path,
      requestHash: createHash('sha256').update(`POST\n${path}\n${body}`).digest('base64url'),
      responseStatus: 200,
      responseBody: {
        appliedIds: [target.id],
        conflictingIds: [],
        deniedIds: [],
        receipt: {
          commandId: key,
          objectKind: 'task',
          action: 'replace_property',
          entries: [
            {
              kind: 'object',
              objectId: target.id,
              property: 'priority',
              before: 'medium',
              after: 'high',
            },
          ],
        },
      },
      status: 'completed',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const app = idempotentApp(user.id);
    app.post(path, (c) => c.json({ id: 'must-not-execute' }));
    const request = () =>
      app.request(path, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body,
      });

    const downgraded = await request();
    await database.db
      .update(database.grant)
      .set({ capabilities: ['contribute'] })
      .where(
        and(
          eq(database.grant.organizationId, base.orgId),
          eq(database.grant.subjectId, base.humanActorId),
          eq(database.grant.resourceId, target.id),
        ),
      );
    const authorized = await request();
    await database.db
      .delete(database.grant)
      .where(
        and(
          eq(database.grant.organizationId, base.orgId),
          eq(database.grant.subjectId, base.humanActorId),
          eq(database.grant.resourceId, target.id),
        ),
      );
    const revoked = await request();

    expect(downgraded.status).toBe(403);
    expect(authorized.status).toBe(200);
    expect(revoked.status).toBe(404);
  });

  it.each([
    { objectKind: 'task' as const, property: 'assigneeId', required: 'assign' as const },
    { objectKind: 'project' as const, property: 'archivedAt', required: 'manage' as const },
  ])(
    'requires current $required access for a cached $objectKind command',
    async ({ objectKind, property, required }) => {
      const database = await getDb();
      const base = await seedBaseOrg(database.db, database);
      const [user] = await database.db
        .insert(database.user)
        .values({
          name: `${required} replay viewer`,
          email: `${required}-replay-${crypto.randomUUID()}@x.test`,
        })
        .returning({ id: database.user.id });
      if (!user) throw new Error('ranked replay user was not created');
      await database.db
        .update(database.actor)
        .set({ userId: user.id })
        .where(eq(database.actor.id, base.humanActorId));
      const target =
        objectKind === 'task'
          ? await seedTask(database.db, database, base.statusId, {
              organizationId: base.orgId,
              teamId: base.teamId,
              title: 'Ranked replay Task',
              state: 'todo',
              visibility: 'private',
            })
          : await seedProject(database.db, database, base.statusId, {
              organizationId: base.orgId,
              teamId: base.teamId,
              name: 'Ranked replay Project',
              visibility: 'private',
              createdBy: base.humanActorId,
            });
      await database.db.insert(database.grant).values({
        organizationId: base.orgId,
        subjectKind: 'actor',
        subjectId: base.humanActorId,
        resourceKind: objectKind,
        resourceId: target.id,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: false,
      });
      const key = `${required}-result-${crypto.randomUUID()}`;
      const path = `/v1/orgs/${base.orgId}/object-commands`;
      const body = JSON.stringify({ commandId: key });
      await database.db.insert(database.idempotencyKey).values({
        userId: user.id,
        key,
        organizationId: base.orgId,
        method: 'POST',
        path,
        requestHash: createHash('sha256').update(`POST\n${path}\n${body}`).digest('base64url'),
        responseStatus: 200,
        responseBody: {
          appliedIds: [target.id],
          conflictingIds: [],
          deniedIds: [],
          receipt: {
            commandId: key,
            objectKind,
            action: objectKind === 'project' ? 'trash' : 'replace_property',
            entries: [
              {
                kind: 'object',
                objectId: target.id,
                property,
                before: null,
                after:
                  objectKind === 'task'
                    ? base.humanActorId
                    : new Date('2026-08-29T12:00:00.000Z').toISOString(),
              },
            ],
          },
        },
        status: 'completed',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const app = idempotentApp(user.id);
      app.post(path, (c) => c.json({ id: 'must-not-execute' }));
      const request = () =>
        app.request(path, {
          method: 'POST',
          headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
          body,
        });

      expect((await request()).status).toBe(403);
      await database.db
        .update(database.grant)
        .set({ capabilities: [required] })
        .where(
          and(
            eq(database.grant.organizationId, base.orgId),
            eq(database.grant.subjectId, base.humanActorId),
            eq(database.grant.resourceKind, objectKind),
            eq(database.grant.resourceId, target.id),
          ),
        );
      expect((await request()).status).toBe(200);
    },
  );

  it('does not require Cycle contribute access that the live command does not require', async () => {
    const database = await getDb();
    const base = await seedBaseOrg(database.db, database);
    const [user] = await database.db
      .insert(database.user)
      .values({
        name: 'Cycle replay viewer',
        email: `cycle-replay-${crypto.randomUUID()}@x.test`,
      })
      .returning({ id: database.user.id });
    if (!user) throw new Error('cycle replay user was not created');
    await database.db
      .update(database.actor)
      .set({ userId: user.id })
      .where(eq(database.actor.id, base.humanActorId));
    const target = await seedTask(database.db, database, base.statusId, {
      organizationId: base.orgId,
      teamId: base.teamId,
      title: 'Cycle replay Task',
      state: 'todo',
      visibility: 'private',
    });
    const [cycle] = await database.db
      .insert(database.cycle)
      .values({
        organizationId: base.orgId,
        teamId: base.teamId,
        number: 1,
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-15T00:00:00.000Z'),
        createdBy: base.humanActorId,
      })
      .returning({ id: database.cycle.id });
    if (!cycle) throw new Error('cycle replay Cycle was not created');
    await database.db.insert(database.grant).values({
      organizationId: base.orgId,
      subjectKind: 'actor',
      subjectId: base.humanActorId,
      resourceKind: 'task',
      resourceId: target.id,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: false,
    });
    const key = `cycle-result-${crypto.randomUUID()}`;
    const command = {
      commandId: key,
      objectKind: 'task',
      objectIds: [target.id],
      operation: { type: 'replace_property', property: 'cycleId', value: cycle.id },
    } as const;
    const path = `/v1/orgs/${base.orgId}/object-commands`;
    const wrapped = new Hono<AppEnv>();
    wrapped.use('*', idempotency);
    wrapped.route(path, (await import('../../src/routes/object-commands')).default);
    const app = appWithActor(
      wrapped,
      base.orgId,
      ['contribute'],
      base.humanActorId,
      fakeSession(user.id),
    );
    const request = () =>
      app.request(path, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body: JSON.stringify(command),
      });

    const live = await request();
    const liveBody = await live.json();
    const cached = await request();

    expect(live.status).toBe(200);
    expect(cached.status).toBe(200);
    expect(cached.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await cached.json()).toEqual(liveBody);
  });

  it.each(['appliedIds', 'conflictingIds', 'deniedIds'] as const)(
    'refuses a cached object-command response when an empty receipt leaves a revoked id only in %s',
    async (resultField) => {
      const database = await getDb();
      const base = await seedBaseOrg(database.db, database);
      const [user] = await database.db
        .insert(database.user)
        .values({
          name: `Result-only ${resultField} viewer`,
          email: `result-only-${resultField}-${crypto.randomUUID()}@x.test`,
        })
        .returning({ id: database.user.id });
      if (!user) throw new Error('result-only replay user was not created');
      await database.db
        .update(database.actor)
        .set({ userId: user.id })
        .where(eq(database.actor.id, base.humanActorId));
      const target = await seedTask(database.db, database, base.statusId, {
        organizationId: base.orgId,
        teamId: base.teamId,
        title: `Result-only ${resultField} target`,
        state: 'todo',
        priority: 'medium',
        visibility: 'private',
      });
      await database.db.insert(database.grant).values({
        organizationId: base.orgId,
        subjectKind: 'actor',
        subjectId: base.humanActorId,
        resourceKind: 'task',
        resourceId: target.id,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: false,
      });
      const key = `result-only-${resultField}-${crypto.randomUUID()}`;
      const path = `/v1/orgs/${base.orgId}/object-commands`;
      const body = JSON.stringify({ commandId: key });
      const resultIds = {
        appliedIds: [] as string[],
        conflictingIds: [] as string[],
        deniedIds: [] as string[],
      };
      resultIds[resultField] = [target.id];
      await database.db.insert(database.idempotencyKey).values({
        userId: user.id,
        key,
        organizationId: base.orgId,
        method: 'POST',
        path,
        requestHash: createHash('sha256').update(`POST\n${path}\n${body}`).digest('base64url'),
        responseStatus: 200,
        responseBody: {
          ...resultIds,
          receipt: {
            commandId: key,
            objectKind: 'task',
            action: 'replace_property',
            entries: [],
          },
        },
        status: 'completed',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const app = idempotentApp(user.id);
      app.post(path, (c) => c.json({ id: 'must-not-execute' }));
      const request = () =>
        app.request(path, {
          method: 'POST',
          headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
          body,
        });

      expect((await request()).status).toBe(200);
      await database.db
        .delete(database.grant)
        .where(
          and(
            eq(database.grant.organizationId, base.orgId),
            eq(database.grant.subjectId, base.humanActorId),
            eq(database.grant.resourceId, target.id),
          ),
        );

      expect((await request()).status).toBe(404);
    },
  );

  it('checks every result bucket and both dependency endpoints in one cached mixed result', async () => {
    const database = await getDb();
    const base = await seedBaseOrg(database.db, database);
    const [user] = await database.db
      .insert(database.user)
      .values({
        name: 'Mixed replay viewer',
        email: `mixed-replay-${crypto.randomUUID()}@x.test`,
      })
      .returning({ id: database.user.id });
    if (!user) throw new Error('mixed replay user was not created');
    await database.db
      .update(database.actor)
      .set({ userId: user.id })
      .where(eq(database.actor.id, base.humanActorId));
    const targets = await Promise.all(
      [
        'Applied only',
        'Conflicting only',
        'Denied only',
        'Dependency source',
        'Dependency target',
      ].map((title) =>
        seedTask(database.db, database, base.statusId, {
          organizationId: base.orgId,
          teamId: base.teamId,
          title,
          state: 'todo',
          priority: 'medium',
          visibility: 'private',
        }),
      ),
    );
    const [appliedOnly, conflictingOnly, deniedOnly, dependencySource, dependencyTarget] = targets;
    if (!appliedOnly || !conflictingOnly || !deniedOnly || !dependencySource || !dependencyTarget) {
      throw new Error('mixed replay targets were not created');
    }
    const grantValues = targets.map((target) => ({
      organizationId: base.orgId,
      subjectKind: 'actor' as const,
      subjectId: base.humanActorId,
      resourceKind: 'task' as const,
      resourceId: target.id,
      capabilities: ['contribute'] as 'contribute'[],
      effect: 'allow' as const,
      cascades: false,
    }));
    await database.db.insert(database.grant).values(grantValues);
    const key = `mixed-result-${crypto.randomUUID()}`;
    const path = `/v1/orgs/${base.orgId}/object-commands`;
    const body = JSON.stringify({ commandId: key });
    await database.db.insert(database.idempotencyKey).values({
      userId: user.id,
      key,
      organizationId: base.orgId,
      method: 'POST',
      path,
      requestHash: createHash('sha256').update(`POST\n${path}\n${body}`).digest('base64url'),
      responseStatus: 200,
      responseBody: {
        appliedIds: [appliedOnly.id, dependencySource.id],
        conflictingIds: [conflictingOnly.id],
        deniedIds: [deniedOnly.id],
        receipt: {
          commandId: key,
          objectKind: 'task',
          action: 'add_dependency',
          entries: [
            {
              kind: 'relation',
              objectId: dependencySource.id,
              relation: 'dependency',
              relatedId: dependencyTarget.id,
              before: false,
              after: true,
            },
          ],
        },
      },
      status: 'completed',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const app = idempotentApp(user.id);
    app.post(path, (c) => c.json({ id: 'must-not-execute' }));
    const request = () =>
      app.request(path, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body,
      });

    expect((await request()).status).toBe(200);
    for (const [index, target] of targets.entries()) {
      await database.db
        .delete(database.grant)
        .where(
          and(
            eq(database.grant.organizationId, base.orgId),
            eq(database.grant.subjectId, base.humanActorId),
            eq(database.grant.resourceId, target.id),
          ),
        );
      expect((await request()).status, `revoked mixed target ${index}`).toBe(404);
      const grant = grantValues[index];
      if (!grant) throw new Error('mixed replay grant was not created');
      await database.db.insert(database.grant).values(grant);
      expect((await request()).status, `restored mixed target ${index}`).toBe(200);
    }
  });

  it('checks both object references carried by a cached property receipt', async () => {
    const database = await getDb();
    const base = await seedBaseOrg(database.db, database);
    const [user] = await database.db
      .insert(database.user)
      .values({
        name: 'Reference replay viewer',
        email: `reference-replay-${crypto.randomUUID()}@x.test`,
      })
      .returning({ id: database.user.id });
    if (!user) throw new Error('reference replay user was not created');
    await database.db
      .update(database.actor)
      .set({ userId: user.id })
      .where(eq(database.actor.id, base.humanActorId));
    const task = await seedTask(database.db, database, base.statusId, {
      organizationId: base.orgId,
      teamId: base.teamId,
      title: 'Reference receipt task',
      state: 'todo',
      visibility: 'private',
    });
    const projects = await Promise.all(
      ['Previous private Project', 'Next private Project'].map((name) =>
        seedProject(database.db, database, base.statusId, {
          organizationId: base.orgId,
          teamId: base.teamId,
          createdBy: base.humanActorId,
          name,
          visibility: 'private',
        }),
      ),
    );
    const [previousProject, nextProject] = projects;
    if (!previousProject || !nextProject) throw new Error('reference Projects were not created');
    const grants = [
      { resourceKind: 'task' as const, resourceId: task.id, capability: 'contribute' as const },
      ...projects.map((project) => ({
        resourceKind: 'project' as const,
        resourceId: project.id,
        capability: 'view' as const,
      })),
    ].map((resource) => ({
      organizationId: base.orgId,
      subjectKind: 'actor' as const,
      subjectId: base.humanActorId,
      ...resource,
      capabilities: [resource.capability],
      effect: 'allow' as const,
      cascades: false,
    }));
    await database.db.insert(database.grant).values(grants);
    const key = `reference-result-${crypto.randomUUID()}`;
    const path = `/v1/orgs/${base.orgId}/object-commands`;
    const body = JSON.stringify({ commandId: key });
    await database.db.insert(database.idempotencyKey).values({
      userId: user.id,
      key,
      organizationId: base.orgId,
      method: 'POST',
      path,
      requestHash: createHash('sha256').update(`POST\n${path}\n${body}`).digest('base64url'),
      responseStatus: 200,
      responseBody: {
        appliedIds: [task.id],
        conflictingIds: [],
        deniedIds: [],
        receipt: {
          commandId: key,
          objectKind: 'task',
          action: 'replace_property',
          entries: [
            {
              kind: 'object',
              objectId: task.id,
              property: 'projectId',
              before: previousProject.id,
              after: nextProject.id,
            },
          ],
        },
      },
      status: 'completed',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const app = idempotentApp(user.id);
    app.post(path, (c) => c.json({ id: 'must-not-execute' }));
    const request = () =>
      app.request(path, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body,
      });

    expect((await request()).status).toBe(200);
    for (const project of projects) {
      await database.db
        .delete(database.grant)
        .where(
          and(
            eq(database.grant.organizationId, base.orgId),
            eq(database.grant.subjectId, base.humanActorId),
            eq(database.grant.resourceKind, 'project'),
            eq(database.grant.resourceId, project.id),
          ),
        );
      expect((await request()).status).toBe(404);
      const grant = grants.find(
        (candidate) => candidate.resourceKind === 'project' && candidate.resourceId === project.id,
      );
      if (!grant) throw new Error('reference Project grant was not created');
      await database.db.insert(database.grant).values(grant);
      expect((await request()).status).toBe(200);
    }
  });

  it('refuses a cached association receipt after its Initiative grant is revoked', async () => {
    const database = await getDb();
    const base = await seedBaseOrg(database.db, database);
    const [guestRole] = await database.db
      .insert(database.role)
      .values({
        organizationId: base.orgId,
        key: 'guest',
        name: 'Guest',
        defaultVisibility: 'private',
        isSystem: true,
      })
      .returning({ id: database.role.id });
    const [user] = await database.db
      .insert(database.user)
      .values({
        name: 'Association replay viewer',
        email: `association-replay-${crypto.randomUUID()}@x.test`,
      })
      .returning({ id: database.user.id });
    if (!guestRole || !user) throw new Error('association replay viewer was not created');
    await database.db
      .update(database.actor)
      .set({ roleId: guestRole.id, userId: user.id })
      .where(eq(database.actor.id, base.humanActorId));
    const project = await seedProject(database.db, database, base.statusId, {
      organizationId: base.orgId,
      teamId: base.teamId,
      createdBy: base.humanActorId,
      name: 'Private association project',
      visibility: 'private',
    });
    const initiative = await seedInitiative(database.db, database, base.statusId, {
      organizationId: base.orgId,
      createdBy: base.humanActorId,
      name: 'Granted association Initiative',
    });
    const grants = [
      {
        organizationId: base.orgId,
        subjectKind: 'actor' as const,
        subjectId: base.humanActorId,
        resourceKind: 'project' as const,
        resourceId: project.id,
        capabilities: ['contribute'] as 'contribute'[],
        effect: 'allow' as const,
        cascades: false,
      },
      {
        organizationId: base.orgId,
        subjectKind: 'actor' as const,
        subjectId: base.humanActorId,
        resourceKind: 'initiative' as const,
        resourceId: initiative.id,
        capabilities: ['view'] as 'view'[],
        effect: 'allow' as const,
        cascades: false,
      },
    ];
    await database.db.insert(database.grant).values(grants);
    const key = `association-result-${crypto.randomUUID()}`;
    const path = `/v1/orgs/${base.orgId}/object-commands`;
    const body = JSON.stringify({ commandId: key });
    await database.db.insert(database.idempotencyKey).values({
      userId: user.id,
      key,
      organizationId: base.orgId,
      method: 'POST',
      path,
      requestHash: createHash('sha256').update(`POST\n${path}\n${body}`).digest('base64url'),
      responseStatus: 200,
      responseBody: {
        appliedIds: [project.id],
        conflictingIds: [],
        deniedIds: [],
        receipt: {
          commandId: key,
          objectKind: 'project',
          action: 'add_association',
          entries: [
            {
              kind: 'relation',
              objectId: project.id,
              relation: 'initiative',
              relatedId: initiative.id,
              before: false,
              after: true,
            },
          ],
        },
      },
      status: 'completed',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const app = idempotentApp(user.id);
    app.post(path, (c) => c.json({ id: 'must-not-execute' }));
    const request = () =>
      app.request(path, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body,
      });

    expect((await request()).status).toBe(200);
    await database.db
      .delete(database.grant)
      .where(
        and(
          eq(database.grant.organizationId, base.orgId),
          eq(database.grant.subjectId, base.humanActorId),
          eq(database.grant.resourceKind, 'initiative'),
          eq(database.grant.resourceId, initiative.id),
        ),
      );

    expect((await request()).status).toBe(404);
  });

  it('refuses a cached label-association receipt after the label no longer belongs to the org', async () => {
    const database = await getDb();
    const base = await seedBaseOrg(database.db, database);
    const [user] = await database.db
      .insert(database.user)
      .values({
        name: 'Label replay viewer',
        email: `label-replay-${crypto.randomUUID()}@x.test`,
      })
      .returning({ id: database.user.id });
    if (!user) throw new Error('label replay user was not created');
    await database.db
      .update(database.actor)
      .set({ userId: user.id })
      .where(eq(database.actor.id, base.humanActorId));
    const project = await seedProject(database.db, database, base.statusId, {
      organizationId: base.orgId,
      teamId: base.teamId,
      createdBy: base.humanActorId,
      name: 'Label association project',
      visibility: 'private',
    });
    const [label] = await database.db
      .insert(database.label)
      .values({ organizationId: base.orgId, name: 'Cached label', color: 'blue' })
      .returning({ id: database.label.id });
    if (!label) throw new Error('cached replay label was not created');
    await database.db.insert(database.grant).values({
      organizationId: base.orgId,
      subjectKind: 'actor',
      subjectId: base.humanActorId,
      resourceKind: 'project',
      resourceId: project.id,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: false,
    });
    const key = `label-result-${crypto.randomUUID()}`;
    const path = `/v1/orgs/${base.orgId}/object-commands`;
    const body = JSON.stringify({ commandId: key });
    await database.db.insert(database.idempotencyKey).values({
      userId: user.id,
      key,
      organizationId: base.orgId,
      method: 'POST',
      path,
      requestHash: createHash('sha256').update(`POST\n${path}\n${body}`).digest('base64url'),
      responseStatus: 200,
      responseBody: {
        appliedIds: [project.id],
        conflictingIds: [],
        deniedIds: [],
        receipt: {
          commandId: key,
          objectKind: 'project',
          action: 'add_association',
          entries: [
            {
              kind: 'relation',
              objectId: project.id,
              relation: 'label',
              relatedId: label.id,
              before: false,
              after: true,
            },
          ],
        },
      },
      status: 'completed',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const app = idempotentApp(user.id);
    app.post(path, (c) => c.json({ id: 'must-not-execute' }));
    const request = () =>
      app.request(path, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body,
      });

    expect((await request()).status).toBe(200);
    await database.db.delete(database.label).where(eq(database.label.id, label.id));

    expect((await request()).status).toBe(404);
  });
});
