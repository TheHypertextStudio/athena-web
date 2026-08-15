/**
 * The share surface: minting, revoking, and the one question an external page may ask.
 *
 * @remarks
 * The public read is exercised through the SAME composition the root server uses — the shared
 * `buildCorsMiddleware` wrapping the public router at its real path — rather than against the
 * router alone. The two properties that make a widget work in a browser (no session gate,
 * credential-free open CORS) live in that composition, so a handler-only test would pass on a
 * build where nothing outside Docket could read it.
 *
 * The composition is rebuilt here instead of importing `src/server.ts` because that module pulls
 * in the entire route tree; a separate test file has no business failing because an unrelated
 * router is mid-edit. What the rebuild cannot prove — that the real server actually mounts this —
 * is asserted separately, against the server's own source, in `time-wiring.test.ts`.
 */
import type { PublicTimerStatusOut, TimeShareTokenCreated, TimeShareTokenOut } from '@docket/types';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { buildCorsMiddleware } from '../../src/cors';
import { onError } from '../../src/error';
import timePublic, { SHARED_TIMER_STATUS_PATH } from '../../src/routes/time-public';
import time from '../../src/routes/time';
import { SHARE_TOKEN_HEADER } from '../../src/time/share';
import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const FOREIGN_ORIGIN = 'https://willie.example';

/** The root server's public composition: shared CORS policy + the public router at its path. */
const publicServer = new Hono<AppEnv>();
publicServer.onError(onError);
publicServer.use('*', buildCorsMiddleware(['https://app.docket.test']));
publicServer.route('/v1/public/time', timePublic);

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

describe('Time share tokens', () => {
  let userId: string;
  let organizationId: string;
  let app: ReturnType<typeof appWithSession>;

  beforeEach(async () => {
    const schema = await getDb();
    userId = await seedUserWithHub(schema.db, schema, 'TimeShare');
    organizationId = await seedOrg(schema.db, schema);
    const actorId = await addMember(schema.db, schema, organizationId, userId);
    await schema.db
      .insert(schema.team)
      .values({
        organizationId,
        name: 'Core',
        key: `K${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id });
    await schema.db.insert(schema.grant).values({
      organizationId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'organization',
      resourceId: organizationId,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: true,
    });
    app = appWithSession(time, fakeSession(userId));
  });

  /** Mint a token through the owner's own session. */
  async function mint(body: Record<string, unknown>): Promise<TimeShareTokenCreated> {
    const response = await app.request('/share-tokens', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    return json<TimeShareTokenCreated>(response);
  }

  /** Read the public status from a third-party origin, exactly as a widget would. */
  async function readPublic(token: string | null): Promise<Response> {
    return publicServer.request(SHARED_TIMER_STATUS_PATH, {
      headers: {
        Origin: FOREIGN_ORIGIN,
        ...(token ? { [SHARE_TOKEN_HEADER]: token } : {}),
      },
    });
  }

  /** Preflight the read, as a browser does before sending a custom header cross-origin. */
  async function preflight(): Promise<Response> {
    return publicServer.request(SHARED_TIMER_STATUS_PATH, {
      method: 'OPTIONS',
      headers: {
        Origin: FOREIGN_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': SHARE_TOKEN_HEADER,
      },
    });
  }

  it('mints a token whose secret is shown once and never stored in the clear', async () => {
    const minted = await mint({ label: 'Personal site' });
    expect(minted.token).toEqual(expect.any(String));
    expect(minted.token.length).toBeGreaterThan(20);
    expect(minted.statusUrl.endsWith(SHARED_TIMER_STATUS_PATH)).toBe(true);
    expect(minted.embedSnippet).toContain('docket-timer');
    expect(minted.embedSnippet).toContain(minted.token);

    const schema = await getDb();
    const stored = one(
      await schema.db
        .select()
        .from(schema.timeShareToken)
        .where(eq(schema.timeShareToken.id, minted.id)),
    );
    expect(stored.tokenHash).not.toContain(minted.token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const listed = await json<{ items: TimeShareTokenOut[] }>(await app.request('/share-tokens'));
    expect(listed.items).toEqual([
      expect.objectContaining({ id: minted.id, label: 'Personal site' }),
    ]);
    // The list is the only later view of a token, and it cannot leak the secret.
    expect(JSON.stringify(listed)).not.toContain(minted.token);
  });

  it('answers idle for a valid token with nothing running, cross-origin', async () => {
    const minted = await mint({ label: 'Personal site' });
    const response = await readPublic(minted.token);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    // Credential-free: a browser must never attach the owner's Docket cookies to this.
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(json<PublicTimerStatusOut>(response)).resolves.toEqual(
      expect.objectContaining({ state: 'idle', taskTitle: null, elapsedMs: 0 }),
    );

    // The browser asks first. Without this, every widget fetch fails before it is sent.
    const preflighted = await preflight();
    expect(preflighted.status).toBe(204);
    expect(preflighted.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflighted.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      SHARE_TOKEN_HEADER,
    );
  });

  it('reports the running task, and honours a token that withholds its name', async () => {
    const open = await mint({ label: 'Public', includeTitle: true, includeWorkspace: true });
    const quiet = await mint({ label: 'Discreet', includeTitle: false });
    const started = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ context: { label: 'Rewrite the onboarding', organizationId } }),
    });
    expect(started.status).toBe(200);

    const shown = await json<PublicTimerStatusOut>(await readPublic(open.token));
    expect(shown).toEqual(
      expect.objectContaining({
        state: 'running',
        taskTitle: 'Rewrite the onboarding',
        workspaceName: expect.any(String),
      }),
    );
    expect(new Date(shown.serverNow).toString()).not.toBe('Invalid Date');

    const withheld = await json<PublicTimerStatusOut>(await readPublic(quiet.token));
    expect(withheld).toEqual(
      expect.objectContaining({ state: 'running', taskTitle: null, workspaceName: null }),
    );
  });

  it('reports a paused session as paused rather than idle', async () => {
    const minted = await mint({ label: 'Personal site' });
    const record = await json<{ id: string }>(
      await app.request('/records', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ context: { label: 'Stepped away', organizationId } }),
      }),
    );
    await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    await expect(json<PublicTimerStatusOut>(await readPublic(minted.token))).resolves.toEqual(
      expect.objectContaining({ state: 'paused', taskTitle: 'Stepped away' }),
    );
  });

  it('refuses a missing, unknown or revoked token identically', async () => {
    expect((await readPublic(null)).status).toBe(401);
    expect((await readPublic('not-a-real-token')).status).toBe(401);

    const minted = await mint({ label: 'Temporary' });
    expect((await readPublic(minted.token)).status).toBe(200);
    const revoked = await app.request(`/share-tokens/${minted.id}`, { method: 'DELETE' });
    expect(revoked.status).toBe(200);
    expect((await json<TimeShareTokenOut>(revoked)).revokedAt).not.toBeNull();
    expect((await readPublic(minted.token)).status).toBe(401);
  });

  it('never lets one person revoke another person’s token', async () => {
    const minted = await mint({ label: 'Mine' });
    const schema = await getDb();
    const strangerId = await seedUserWithHub(schema.db, schema, 'Stranger');
    const stranger = appWithSession(time, fakeSession(strangerId));
    expect(
      (await stranger.request(`/share-tokens/${minted.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
    expect((await readPublic(minted.token)).status).toBe(200);
  });
});
