import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type agentSessionsRoute from '../../src/routes/agent-sessions';
import { getMigratedDb } from '../support/db';
import { fakeSession } from '../support/routes-harness';

let schema: typeof DbModule;
let agentSessions: typeof agentSessionsRoute;

beforeAll(async () => {
  schema = await getMigratedDb();
  agentSessions = (await import('../../src/routes/agent-sessions')).default;
});

function appFor(ownerUserId: string, organizationId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(ownerUserId));
    const actorCtx: ActorCtx = {
      orgId: organizationId,
      actorId: 'actor_stream_test',
      roleId: 'role_stream_test',
      capabilities: ['view'],
    };
    c.set('actorCtx', actorCtx);
    await next();
  });
  app.route('/', agentSessions);
  app.onError(onError);
  return app;
}

async function seedTerminalSession(): Promise<{
  readonly app: ReturnType<typeof appFor>;
  readonly sessionId: string;
}> {
  const suffix = Math.random().toString(36).slice(2, 9);
  const [owner] = await schema.db
    .insert(schema.user)
    .values({ name: 'Stream owner', email: `stream-${suffix}@example.com` })
    .returning({ id: schema.user.id });
  const [organization] = await schema.db
    .insert(schema.organization)
    .values({ name: `Stream ${suffix}`, slug: `stream-${suffix}`, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: assertDefined(owner).id,
      contextOrganizationId: assertDefined(organization).id,
      trigger: 'delegation',
      status: 'completed',
    })
    .returning({ id: schema.agentSession.id });
  return {
    app: appFor(assertDefined(owner).id, assertDefined(organization).id),
    sessionId: assertDefined(session).id,
  };
}

describe('organization session activity stream', () => {
  it('rejects an unknown Last-Event-ID before opening the stream', async () => {
    const { app, sessionId } = await seedTerminalSession();

    const response = await app.request(`/${sessionId}/stream`, {
      headers: { 'last-event-id': 'activity_never_persisted' },
    });

    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'validation_error', status: 422 });
  });

  it('orders timestamp ties by id and resumes from the exact compound position', async () => {
    const { app, sessionId } = await seedTerminalSession();
    const createdAt = new Date('2026-09-13T12:00:00.000Z');
    const first = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const second = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
    await schema.db.insert(schema.sessionActivity).values([
      { id: second, sessionId, type: 'response', body: { text: 'Second' }, createdAt },
      { id: first, sessionId, type: 'response', body: { text: 'First' }, createdAt },
    ]);

    const initial = await (await app.request(`/${sessionId}/stream`)).text();
    expect(initial.indexOf(`id: ${first}`)).toBeLessThan(initial.indexOf(`id: ${second}`));

    const resumed = await app.request(`/${sessionId}/stream`, {
      headers: { 'last-event-id': first },
    });
    expect(resumed.status).toBe(200);
    const replay = await resumed.text();
    expect(replay).not.toContain(`id: ${first}`);
    expect(replay).toContain(`id: ${second}`);
  });
});
