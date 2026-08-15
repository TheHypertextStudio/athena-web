/**
 * `@docket/api` — the browser voice HTTP surface (`/v1/me/athena/voice`).
 *
 * @remarks
 * `voice-channel-parity.test.ts` proves the underlying session service and engine directly. This
 * file proves the route layer: starting a session mints a mock-transport credential and the
 * caller's canonical conversation id, relaying events drives the same engine, and ownership is
 * enforced (another caller's session id is a 404, not a 403).
 */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type { createVoiceRoutes as CreateVoiceRoutes } from '../../src/routes/voice-sessions';
import { MockRealtimeProvider } from '../../src/routes/voice-provider';
import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let createVoiceRoutes!: typeof CreateVoiceRoutes;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ createVoiceRoutes } = await import('../../src/routes/voice-sessions'));
});

const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let seq = 0;

/** An entitled personal workspace with a team, ready to start a voice session. */
async function seedPerson(name = 'VoiceRoute') {
  seq += 1;
  const userId = await seedUserWithHub(db, schema, `${name}${String(seq)}`);
  const orgId = await seedOrg(db, schema, true);
  await db
    .update(schema.organization)
    .set({ lifecycleState: 'active' })
    .where(eq(schema.organization.id, orgId));
  await addMember(db, schema, orgId, userId, 'owner');
  await db.insert(schema.team).values({
    organizationId: orgId,
    name: 'Personal',
    key: `T${Math.random().toString(36).slice(2, 6)}`,
  });
  return { userId, orgId };
}

/** An entitled shared workspace, deliberately without a member unless the test adds one. */
async function seedEntitledWorkspace(): Promise<string> {
  const orgId = await seedOrg(db, schema);
  await db
    .update(schema.organization)
    .set({ lifecycleState: 'active' })
    .where(eq(schema.organization.id, orgId));
  await db.insert(schema.team).values({
    organizationId: orgId,
    name: 'Shared',
    key: `S${Math.random().toString(36).slice(2, 6)}`,
  });
  return orgId;
}

interface VoiceSessionWire {
  readonly id: string;
  readonly conversationId: string;
  readonly channel: string;
  readonly credential: { transport: string };
}

describe('browser voice routes', () => {
  it('requires a signed-in caller for every route', async () => {
    const routes = createVoiceRoutes(() => new MockRealtimeProvider());
    const app = appWithSession(routes, null);
    expect(
      (await app.request('/', { method: 'POST', headers: J, body: JSON.stringify({}) })).status,
    ).toBe(401);
    expect((await app.request('/transcript')).status).toBe(401);
    expect((await app.request('/some-id', { method: 'DELETE' })).status).toBe(401);
  });

  it('starts a session on the caller’s canonical conversation with a mock credential', async () => {
    const { userId, orgId } = await seedPerson('VoiceStart');
    const routes = createVoiceRoutes(() => new MockRealtimeProvider());
    const app = appWithSession(routes, fakeSession(userId));

    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ workspaceId: orgId }),
    });
    expect(res.status).toBe(200);
    const started = await body<VoiceSessionWire>(res);
    expect(started.channel).toBe('web');
    expect(started.credential.transport).toBe('mock');

    const [row] = await db
      .select()
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.id, started.id));
    expect(row?.conversationId).toBe(started.conversationId);
    expect(row?.userId).toBe(userId);
  });

  it('refuses a browser workspace focus without an active, unarchived human membership', async () => {
    const person = await seedPerson('VoiceWorkspaceGate');
    const nonmemberOrgId = await seedEntitledWorkspace();
    const suspendedOrgId = await seedEntitledWorkspace();
    await addMember(db, schema, suspendedOrgId, person.userId, 'member', 'suspended');
    const archivedOrgId = await seedEntitledWorkspace();
    const archivedActorId = await addMember(db, schema, archivedOrgId, person.userId, 'member');
    await db
      .update(schema.actor)
      .set({ archivedAt: new Date() })
      .where(eq(schema.actor.id, archivedActorId));

    const routes = createVoiceRoutes(() => new MockRealtimeProvider());
    const app = appWithSession(routes, fakeSession(person.userId));
    const before = await db
      .select({ id: schema.voiceSession.id })
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.userId, person.userId));

    for (const workspaceId of [nonmemberOrgId, suspendedOrgId, archivedOrgId]) {
      const res = await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ workspaceId }),
      });
      expect(res.status).toBe(404);
    }

    const after = await db
      .select({ id: schema.voiceSession.id })
      .from(schema.voiceSession)
      .where(eq(schema.voiceSession.userId, person.userId));
    expect(after).toEqual(before);
  });

  it('reads back recent transcript lines from the caller’s conversation', async () => {
    const { userId, orgId } = await seedPerson('VoiceTranscript');
    const routes = createVoiceRoutes(() => new MockRealtimeProvider());
    const app = appWithSession(routes, fakeSession(userId));

    const started = await body<VoiceSessionWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ workspaceId: orgId }),
      }),
    );
    await db.insert(schema.sessionActivity).values({
      sessionId: started.conversationId,
      organizationId: null,
      type: 'response',
      body: { text: 'Remember to water the plants.', author: 'user' },
    });

    const transcript = await body<{ items: { text: string }[] }>(await app.request('/transcript'));
    expect(transcript.items.map((t) => t.text)).toContain('Remember to water the plants.');
  });

  it('relays a spoken turn into the session engine and returns its trace', async () => {
    const { userId, orgId } = await seedPerson('VoiceEvents');
    const routes = createVoiceRoutes(() => new MockRealtimeProvider());
    const app = appWithSession(routes, fakeSession(userId));
    const started = await body<VoiceSessionWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ workspaceId: orgId }),
      }),
    );

    const res = await app.request(`/${started.id}/events`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        events: [{ type: 'user.transcript', text: 'What is on my plate today?', final: true }],
      }),
    });
    expect(res.status).toBe(200);
    const ack = await body<{ state: string; turns: unknown[] }>(res);
    expect(ack.turns.length).toBeGreaterThan(0);
  });

  it('hides another caller’s voice session behind 404', async () => {
    const me = await seedPerson('VoiceOwnerMe');
    const them = await seedPerson('VoiceOwnerThem');
    const routes = createVoiceRoutes(() => new MockRealtimeProvider());
    const theirApp = appWithSession(routes, fakeSession(them.userId));
    const theirs = await body<VoiceSessionWire>(
      await theirApp.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ workspaceId: them.orgId }),
      }),
    );

    const myApp = appWithSession(routes, fakeSession(me.userId));
    expect(
      (
        await myApp.request(`/${theirs.id}/events`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ events: [{ type: 'user.transcript', text: 'hi', final: true }] }),
        })
      ).status,
    ).toBe(404);
    expect((await myApp.request(`/${theirs.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('closes a live session on request', async () => {
    const { userId, orgId } = await seedPerson('VoiceClose');
    const routes = createVoiceRoutes(() => new MockRealtimeProvider());
    const app = appWithSession(routes, fakeSession(userId));
    const started = await body<VoiceSessionWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ workspaceId: orgId }),
      }),
    );

    const res = await app.request(`/${started.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await body<{ ended: boolean }>(res)).toEqual({ ended: true });

    // Already released: a second close attempt cannot find the (now not-live) session.
    expect((await app.request(`/${started.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});
