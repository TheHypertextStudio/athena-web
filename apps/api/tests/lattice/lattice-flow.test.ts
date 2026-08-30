/**
 * The whole bring-your-own-Lattice flow, end to end, against real HTTP servers and a real
 * database: consent → token exchange → device discovery → device selection → a turn that runs on
 * the chosen device → the device goes offline.
 *
 * @remarks
 * This test is hermetic: the Lovelace accounts issuer and the Lattice gateway are real local HTTP
 * servers implementing the documented contract, and the "device" is a scripted model server. That
 * makes it safe in CI while still exercising every hop — PKCE, the token endpoint, the bearer
 * header, the `lattice:personal:<id>` selector, the gateway's error codes, and the per-owner
 * backend resolution the agent loop uses.
 *
 * The one thing it deliberately does NOT prove is that a *real* model on a *real* machine answers;
 * that requires hardware and is verified separately by `scripts/verify-lattice-local.ts`, whose
 * recorded output is committed under `docs/engineering/evidence/`.
 *
 * The load-bearing assertion is the last one: when the device goes offline, the request count on
 * every other capacity stays at zero. Athena tells the person instead of quietly answering from
 * the cloud.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { AppEnv } from '../../src/context';
import type { resolveOwnerBackend as ResolveOwnerBackendFn } from '../../src/routes/lattice-backend';
import type { signConnectState as SignConnectStateFn } from '../../src/lib/oauth-state';

/** The per-owner backend resolver the agent loop calls. */
type ResolveOwnerBackend = typeof ResolveOwnerBackendFn;
/** The signed connect-state minter. */
type SignConnectState = typeof SignConnectStateFn;

process.env['DATABASE_URL'] = 'pglite://memory://';
// This flow must remain available in the deployed API. The owner's Lattice choice is independent
// of whether the process-level fallback has a verified model provider.
process.env['APP_MODE'] = 'production';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';
// A 32-byte base64 key, so credentials really are sealed rather than stored as plaintext.
process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.alloc(32, 3).toString('base64');

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

/** One request the gateway saw, for the routing assertions. */
interface GatewayCall {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly model?: string;
}

/** Everything the local stand-ins record. */
interface Recorder {
  readonly gatewayCalls: GatewayCall[];
  readonly deviceCalls: string[];
  /** Flipped to make the paired device stop answering. */
  deviceOnline: boolean;
}

/** Read and JSON-parse a request body. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw === '') return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

/** Read one field as a string; anything non-string reads as empty rather than `[object Object]`. */
function field(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

/** Send a JSON response. */
function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

/** Start a server on an ephemeral port and return its origin. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

/**
 * A stand-in for the Lovelace accounts issuer: authorization endpoint plus token endpoint,
 * validating PKCE the way a real issuer does.
 */
function accountsStub(): { server: Server; issuedCodes: Map<string, string> } {
  const issuedCodes = new Map<string, string>();
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/oauth/authorize') {
        // A real issuer renders consent here; recording the challenge is what lets the token
        // endpoint below actually verify the verifier.
        issuedCodes.set('code_granted', url.searchParams.get('code_challenge') ?? '');
        send(res, 200, { ok: true });
        return;
      }
      if (url.pathname === '/oauth/token') {
        const form = await readBody(req);
        if (form['grant_type'] === 'refresh_token') {
          send(res, 200, {
            access_token: 'at_refreshed',
            refresh_token: 'rt_2',
            expires_in: 3600,
            scope: 'lattice:compute:inference lattice:compute:catalog:read',
          });
          return;
        }
        const { createHash } = await import('node:crypto');
        const verifier = field(form, 'code_verifier');
        const expected = issuedCodes.get('code_granted');
        if (expected !== createHash('sha256').update(verifier).digest('base64url')) {
          send(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
          return;
        }
        send(res, 200, {
          access_token: 'at_1',
          refresh_token: 'rt_1',
          expires_in: 3600,
          scope: 'lattice:compute:inference lattice:compute:catalog:read',
        });
        return;
      }
      send(res, 404, { error: 'not_found' });
    })();
  });
  return { server, issuedCodes };
}

/**
 * A stand-in for the Lattice gateway that relays to a "device".
 *
 * @remarks
 * It implements the documented routes and, critically, the documented refusal: an unreachable
 * device is a terminal `409 runtime_unreachable`, never a quiet reroute onto other capacity.
 */
function gatewayStub(recorder: Recorder, deviceOrigin: string): Server {
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      recorder.gatewayCalls.push({
        path: url.pathname,
        authorization: req.headers.authorization,
      });
      if (url.pathname === '/v1/personal-runtimes') {
        send(res, 200, {
          runtimes: [
            {
              latticeId: 'lat_studio',
              accountId: 'acct_1',
              displayName: 'Willie Mac Studio',
              executionBackend: 'local-model',
              status: recorder.deviceOnline ? 'reachable' : 'offline',
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-02T00:00:00.000Z',
              lastSeenAt: '2026-08-02T12:00:00.000Z',
            },
          ],
        });
        return;
      }
      if (url.pathname === '/v1/chat/completions') {
        const body = await readBody(req);
        const model = field(body, 'model');
        recorder.gatewayCalls.splice(-1, 1, {
          path: url.pathname,
          authorization: req.headers.authorization,
          model,
        });
        if (!recorder.deviceOnline) {
          send(res, 409, {
            error: 'runtime_unreachable',
            message: 'the daemon has not polled recently',
          });
          return;
        }
        // Relay to the device exactly as the gateway does: same OpenAI-shaped payload.
        const relayed = await fetch(`${deviceOrigin}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({}, body, { model: 'local-scripted' })),
        });
        send(res, 200, await relayed.json());
        return;
      }
      send(res, 404, { error: 'not_found' });
    })();
  });
}

/** A stand-in for the model server running on the person's machine. */
function deviceStub(recorder: Recorder): Server {
  return createServer((req, res) => {
    void (async () => {
      recorder.deviceCalls.push(req.url ?? '/');
      const body = await readBody(req);
      const messages = body['messages'] as { role: string; content: string }[];
      const asked = messages.at(-1)?.content ?? '';
      // Answer as a tool call when the prompt asks for one, so the text protocol is exercised
      // rather than just the happy prose path.
      const content = asked.includes('create a task')
        ? '```json\n{"tool":"create_task","input":{"title":"Ship the launch note"}}\n```'
        : 'I ran on your own machine.';
      send(res, 200, {
        id: 'cmpl_local_1',
        object: 'chat.completion',
        model: 'local-scripted',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      });
    })();
  });
}

const recorder: Recorder = { gatewayCalls: [], deviceCalls: [], deviceOnline: true };
const servers: Server[] = [];
const USER_ID = 'user_lattice_1';

// The stand-in servers come up at module scope, BEFORE anything under `src/` is imported. The
// API's `env` is a snapshot taken when `@docket/env/api` first loads, so setting these variables
// inside `beforeAll` would be too late — the feature would read as unconfigured and every
// assertion below would be vacuously "unavailable".
const device = deviceStub(recorder);
servers.push(device);
const deviceOrigin = await listen(device);
const gateway = gatewayStub(recorder, deviceOrigin);
servers.push(gateway);
const gatewayOrigin = await listen(gateway);
const accounts = accountsStub();
servers.push(accounts.server);
const accountsOrigin = await listen(accounts.server);

process.env['LATTICE_CLIENT_ID'] = 'client_docket';
process.env['LATTICE_CLIENT_SECRET'] = 'secret_docket';
process.env['LATTICE_ACCOUNTS_ISSUER'] = accountsOrigin;
process.env['LATTICE_GATEWAY_URL'] = gatewayOrigin;
process.env['API_URL'] = 'http://api.test';
process.env['WEB_URL'] = 'http://web.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let app!: Hono<AppEnv>;
let resolveOwnerBackend!: ResolveOwnerBackend;
let signConnectState!: SignConnectState;

/** Call the API as the signed-in owner. */
async function call(
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<Response> {
  return await app.request(`http://api.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
}

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  await installTestProductFixture(db);

  await db.insert(schema.user).values({
    id: USER_ID,
    name: 'Ada',
    email: 'ada@example.com',
    emailVerified: true,
  });

  const lattice = (await import('../../src/routes/lattice')).default;
  ({ resolveOwnerBackend } = await import('../../src/routes/lattice-backend'));
  ({ signConnectState } = await import('../../src/lib/oauth-state'));
  const { onError } = await import('../../src/error');
  const { fakeSession } = await import('../support/routes-harness');
  app = new Hono<AppEnv>();
  app.onError(onError);
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(USER_ID));
    await next();
  });
  app.route('/v1/me/athena', lattice);
});

afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((done) => {
          server.close(() => {
            done();
          });
        }),
    ),
  );
});

describe('the bring-your-own-Lattice flow', () => {
  it('starts unconnected, and says so without erroring', async () => {
    const response = await call('/v1/me/athena/lattice');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ available: true, connected: false, enabled: false });
    // The permission ask is visible before anyone clicks Connect.
    expect(body['scopes']).toEqual(['lattice:compute:inference', 'lattice:compute:catalog:read']);
  });

  it('sends the browser to Lovelace with PKCE and the exact scopes', async () => {
    const response = await call('/v1/me/athena/lattice/authorize', { method: 'POST' });
    expect(response.status).toBe(200);
    const { authorizationUrl } = (await response.json()) as { authorizationUrl: string };
    const url = new URL(authorizationUrl);

    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe(
      'lattice:compute:inference lattice:compute:catalog:read',
    );
    expect(url.searchParams.get('client_id')).toBe('client_docket');

    // The issuer sees the challenge; nothing that could be replayed leaves the server.
    await fetch(authorizationUrl);
    expect(url.searchParams.get('code_verifier')).toBeNull();
  });

  it('completes the exchange through the real callback and stores a sealed grant', async () => {
    const latticeOAuth = (await import('../../src/routes/lattice-oauth')).default;
    const callbackApp = new Hono().route('/internal/integrations/lattice', latticeOAuth);
    const [connection] = await db.select().from(schema.latticeConnection);
    const state = signConnectState({
      scope: 'lattice',
      connectionId: connection?.id ?? '',
      ownerUserId: USER_ID,
    });

    const response = await callbackApp.request(
      `http://api.test/internal/integrations/lattice/callback?code=code_granted&state=${encodeURIComponent(state)}`,
    );

    expect(response.status).toBe(302);
    // Back to Settings with a coarse outcome flag and nothing else — no issuer text on the URL.
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/settings/athena');
    expect(location.search).toBe('?lattice=connected');

    const [stored] = await db.select().from(schema.latticeCredential);
    // Sealed, not plaintext: the raw token must not be findable in the column.
    expect(stored?.ciphertext).toContain('v1:gcm:');
    expect(stored?.ciphertext).not.toContain('at_1');
  });

  it('lists the person’s devices from the gateway, as that person', async () => {
    const response = await call('/v1/me/athena/lattice/devices');
    const body = (await response.json()) as { devices: { id: string; ready: boolean }[] };

    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]).toMatchObject({ id: 'lat_studio', ready: true, selected: false });
    // Attribution: the gateway saw the *user's* bearer token, not a shared developer key.
    const listCall = recorder.gatewayCalls.find((c) => c.path === '/v1/personal-runtimes');
    expect(listCall?.authorization).toBe('Bearer at_1');
  });

  it('points Athena at the chosen device and reports it active', async () => {
    const response = await call('/v1/me/athena/lattice/device', {
      method: 'POST',
      body: JSON.stringify({ deviceId: 'lat_studio' }),
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      connected: true,
      enabled: true,
      deviceId: 'lat_studio',
      deviceName: 'Willie Mac Studio',
      deviceStatus: 'reachable',
      unavailableReason: null,
    });
  });

  it('routes that owner’s turn to the gateway, which relays it to the device', async () => {
    const before = recorder.deviceCalls.length;
    const backend = await resolveOwnerBackend(USER_ID);
    expect(backend.kind).toBe('lattice');
    expect(backend.deviceId).toBe('lat_studio');

    const events = [];
    for await (const event of backend.runtime.streamTurn({
      system: 'You are Athena.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Where did you run?' }] }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: 'text', text: 'I ran on your own machine.' });
    // Athena called the gateway host, and the gateway — not Docket — reached the device.
    const chat = recorder.gatewayCalls.filter((c) => c.path === '/v1/chat/completions').at(-1);
    expect(chat?.model).toBe('lattice:personal:lat_studio');
    expect(chat?.authorization).toBe('Bearer at_1');
    expect(recorder.deviceCalls.length).toBe(before + 1);
  });

  it('carries a tool call back through the text protocol', async () => {
    const backend = await resolveOwnerBackend(USER_ID);
    const events = [];
    for await (const event of backend.runtime.streamTurn({
      system: 'You are Athena.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Please create a task for the note' }] },
      ],
      tools: [
        {
          name: 'create_task',
          description: 'Create a task.',
          inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
        },
      ],
    })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({
      type: 'tool_use',
      name: 'create_task',
      input: { title: 'Ship the launch note' },
    });
  });

  it('consults the deployment fallback only for an account without Lattice', async () => {
    await expect(resolveOwnerBackend('user_without_lattice')).rejects.toThrow(
      'Athena model backend "anthropic-direct" is missing config: ANTHROPIC_API_KEY',
    );
  });

  it('surfaces an explicit unavailable state when the device goes offline, and answers from nowhere else', async () => {
    recorder.deviceOnline = false;
    const deviceCallsBefore = recorder.deviceCalls.length;

    const backend = await resolveOwnerBackend(USER_ID);
    const failure = await (async () => {
      try {
        for await (const _ of backend.runtime.streamTurn({
          system: 'You are Athena.',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Still there?' }] }],
          tools: [],
        })) {
          // The turn must not produce any event at all.
          return new Error('a turn was served while the device was offline');
        }
        return new Error('the turn completed while the device was offline');
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toMatchObject({ reason: 'device_offline' });
    // The whole point: nothing ran anywhere. Not on the device, not on a cloud model.
    expect(recorder.deviceCalls.length).toBe(deviceCallsBefore);

    // And the surface can now explain it in its own words.
    const status = (await (await call('/v1/me/athena/lattice')).json()) as Record<string, unknown>;
    expect(status['unavailableReason']).toBe('device_offline');
    recorder.deviceOnline = true;
  });

  it('returns to the deployment fallback when switched off, keeping the grant', async () => {
    await call('/v1/me/athena/lattice', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });

    await expect(resolveOwnerBackend(USER_ID)).rejects.toThrow(
      'Athena model backend "anthropic-direct" is missing config: ANTHROPIC_API_KEY',
    );
    const status = (await (await call('/v1/me/athena/lattice')).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ connected: true, enabled: false, deviceId: 'lat_studio' });
  });

  it('disconnecting deletes the grant and the stored token', async () => {
    const response = await call('/v1/me/athena/lattice', { method: 'DELETE' });
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      connected: false,
      deviceId: null,
    });
    expect(await db.select().from(schema.latticeCredential)).toHaveLength(0);
    expect(await db.select().from(schema.latticeConnection)).toHaveLength(0);
  });
});
import { installTestProductFixture } from '../support/db';
