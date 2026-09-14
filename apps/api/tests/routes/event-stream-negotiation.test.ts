/**
 * `Accept` negotiation for the Server-Sent Events routes, exercised end to end.
 *
 * @remarks
 * A browser `EventSource` sends `Accept: text/event-stream` on every connection. The global
 * media-type middleware runs before any route, so these requests go through the composed `/v1`
 * app, where a stream route refused with `406` would fail.
 */
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getSession } from '../support/auth-mock';
import { composedV1App, getDb, one, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';

/** The header a browser `EventSource` sends on every connection. */
const EVENT_SOURCE_HEADERS = { Accept: 'text/event-stream' };

let app: Hono;
let userId: string;
let orgId: string;
/** A settled Athena session the caller owns; its stream replays history and closes. */
let sessionId: string;

beforeAll(async () => {
  const schema = await getDb();
  const { db } = schema;
  app = await composedV1App();
  userId = await seedUserWithHub(db, schema, 'eventstream');
  const base = await seedBaseOrg(db, schema);
  orgId = base.orgId;
  await db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, base.humanActorId));
  sessionId = one(
    await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: userId,
        contextOrganizationId: orgId,
        trigger: 'delegation',
        status: 'completed',
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
});

beforeEach(() => {
  getSession.mockResolvedValue({
    user: { id: userId, name: 'Stream Reader', email: 'stream@example.test' },
  });
});

describe('an event stream request', () => {
  it('opens an organization session activity stream', async () => {
    const res = await app.request(`/v1/orgs/${orgId}/sessions/${sessionId}/stream`, {
      headers: EVENT_SOURCE_HEADERS,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.body?.cancel();
  });

  it('opens a personal Athena session activity stream', async () => {
    const res = await app.request(`/v1/me/athena/sessions/${sessionId}/stream`, {
      headers: EVENT_SOURCE_HEADERS,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.body?.cancel();
  });

  it('answers a missing session with a problem document', async () => {
    const res = await app.request(`/v1/orgs/${orgId}/sessions/01J00000000000000000000000/stream`, {
      headers: EVENT_SOURCE_HEADERS,
    });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('is still refused by an endpoint that only answers with JSON', async () => {
    const res = await app.request('/v1/time/categories', { headers: EVENT_SOURCE_HEADERS });

    expect(res.status).toBe(406);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });
});
