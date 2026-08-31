/**
 * `@docket/api` — the parts of one person's Lattice grant that `tests/lattice/lattice-flow.test.ts`
 * never reaches, because that suite walks a single happy connection from consent to disconnect.
 *
 * @remarks
 * What is exercised here instead:
 *
 * - **Choosing and clearing a runtime**: switching to a second device, choosing one without
 *   switching Athena onto it, choosing one the account no longer has, and disconnecting an account
 *   that never connected.
 * - **Every "this owner cannot use this connection" refusal**: no connection row at all, consent
 *   still in flight, a connection whose sealed grant is gone, and one person reaching for another
 *   person's credential.
 * - **Refresh**: the rotated token really is written back, an issuer that refuses the refresh
 *   turns the connection off, and a deployment that has lost its Lovelace client id says so with
 *   `not_connected` rather than a wrong reason.
 * - **The unconfigured and defaulted deployment shapes**: no client id, no issuer override, no
 *   client secret, no gateway override.
 *
 * The Lovelace accounts issuer and the Lattice gateway are local HTTP servers speaking the
 * documented contract, so nothing here reaches the network.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.hoisted(() => {
  // A 32-byte base64 key, so the stored grants below are really sealed.
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
});

import type * as DbModule from '@docket/db';
import { LOVELACE_ACCOUNTS_ISSUER, type LatticeCredentialRecord } from '@docket/integrations';
import { assertDefined } from '@docket/test-utils';

import { env } from '../../src/env';
import type latticeRouter from '../../src/routes/lattice';
import type * as LatticeConnectionModule from '../../src/routes/lattice-connection';
import type {
  sealCredential as SealCredential,
  unsealCredential as UnsealCredential,
} from '../../src/lib/credentials';
import { appWithSession, fakeSession, getDb, one } from '../support/routes-harness';

const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * `env` is `readonly` at the type level (values are meant to arrive only from validated process
 * env) but is a plain object at runtime. These four are toggled per case — always restored in
 * `afterEach` — the same way `tests/routes/integrations-edges.test.ts` toggles its own.
 */
const mutableEnv = env as {
  LATTICE_CLIENT_ID: string | undefined;
  LATTICE_CLIENT_SECRET: string | undefined;
  LATTICE_ACCOUNTS_ISSUER: string | undefined;
  LATTICE_GATEWAY_URL: string | undefined;
};

/** One personal-runtime record in the gateway's own shape. */
interface RuntimeRecord {
  readonly latticeId: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly executionBackend: string;
  readonly status: 'unpaired' | 'reachable' | 'offline' | 'revoked';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastSeenAt: string;
}

/** What the gateway stand-in serves, and what it saw. */
const gateway: {
  runtimes: RuntimeRecord[];
  calls: { path: string; authorization: string | undefined }[];
} = { runtimes: [], calls: [] };

/** What the accounts stand-in does at its token endpoint, and the forms it received. */
const accounts: { refuseRefresh: boolean; forms: Record<string, string>[] } = {
  refuseRefresh: false,
  forms: [],
};

/** Build a paired-device record. */
function runtime(
  latticeId: string,
  displayName: string,
  status: RuntimeRecord['status'] = 'reachable',
): RuntimeRecord {
  return {
    latticeId,
    accountId: 'acct_branches',
    displayName,
    executionBackend: 'local-model',
    status,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    lastSeenAt: '2026-08-02T12:00:00.000Z',
  };
}

/** Read and parse a request body as JSON or as a form. */
async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw === '') return {};
  return Object.fromEntries(new URLSearchParams(raw));
}

/** Send a JSON response. */
function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Start a server on an ephemeral port and return its origin. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let lattice!: typeof latticeRouter;
let connectionModule!: typeof LatticeConnectionModule;
let sealCredential!: typeof SealCredential;
let unsealCredential!: typeof UnsealCredential;
let accountsOrigin!: string;
let gatewayOrigin!: string;
const servers: Server[] = [];

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ default: lattice } = await import('../../src/routes/lattice'));
  connectionModule = await import('../../src/routes/lattice-connection');
  ({ sealCredential, unsealCredential } = await import('../../src/lib/credentials'));

  const accountsServer = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/oauth/token') {
        send(res, 404, { error: 'not_found' });
        return;
      }
      accounts.forms.push(await readBody(req));
      if (accounts.refuseRefresh) {
        send(res, 400, { error: 'invalid_grant', error_description: 'the grant was revoked' });
        return;
      }
      send(res, 200, {
        access_token: 'at_refreshed',
        refresh_token: 'rt_2',
        expires_in: 3600,
        scope:
          'openid profile email offline_access lattice:compute:inference lattice:compute:catalog:read',
      });
    })();
  });
  servers.push(accountsServer);
  accountsOrigin = await listen(accountsServer);

  const gatewayServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    gateway.calls.push({ path: url.pathname, authorization: req.headers.authorization });
    if (url.pathname === '/v1/personal-runtimes') {
      send(res, 200, { runtimes: gateway.runtimes });
      return;
    }
    send(res, 404, { error: 'not_found' });
  });
  servers.push(gatewayServer);
  gatewayOrigin = await listen(gatewayServer);

  restoreEnv();
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

/** Put the deployment back into its fully configured shape. */
function restoreEnv(): void {
  mutableEnv.LATTICE_CLIENT_ID = 'client_docket_test';
  mutableEnv.LATTICE_CLIENT_SECRET = 'secret_docket_test';
  mutableEnv.LATTICE_ACCOUNTS_ISSUER = accountsOrigin;
  mutableEnv.LATTICE_GATEWAY_URL = gatewayOrigin;
}

beforeEach(() => {
  gateway.runtimes = [runtime('lat_studio', 'Studio')];
  gateway.calls = [];
  accounts.refuseRefresh = false;
  accounts.forms = [];
});

afterEach(() => {
  restoreEnv();
});

/** Seed a person. */
async function seedOwner(label: string): Promise<string> {
  return one(
    await db
      .insert(schema.user)
      .values({
        name: label,
        email: `${label}-${Math.random().toString(36).slice(2)}@lattice.test`,
      })
      .returning({ id: schema.user.id }),
  ).id;
}

/** Seed a connection row for a person. */
async function seedConnection(
  ownerUserId: string,
  values: Partial<typeof schema.latticeConnection.$inferInsert> = {},
): Promise<typeof schema.latticeConnection.$inferSelect> {
  return one(
    await db
      .insert(schema.latticeConnection)
      .values({ ownerUserId, status: 'connected', ...values })
      .returning(),
  );
}

/** An approved grant, either comfortably live or already past its refresh window. */
function grant(state: 'fresh' | 'expiring', accessToken = 'at_1'): LatticeCredentialRecord {
  return {
    kind: 'lattice_oauth',
    accessToken,
    refreshToken: 'rt_1',
    expiresInSeconds: state === 'fresh' ? 3600 : 60,
    scope:
      'openid profile email offline_access lattice:compute:inference lattice:compute:catalog:read',
    obtainedAt:
      state === 'fresh'
        ? new Date().toISOString()
        : new Date(Date.now() - 10 * 60_000).toISOString(),
  };
}

/** Seal a credential against a connection. */
async function seedCredential(
  connectionId: string,
  ownerUserId: string,
  credential: unknown,
): Promise<void> {
  await db.insert(schema.latticeCredential).values({
    connectionId,
    ownerUserId,
    ciphertext: sealCredential(JSON.stringify(credential)),
  });
}

/** Read a person's connection row back from the database. */
async function readConnection(
  ownerUserId: string,
): Promise<typeof schema.latticeConnection.$inferSelect> {
  return assertDefined(
    (
      await db
        .select()
        .from(schema.latticeConnection)
        .where(eq(schema.latticeConnection.ownerUserId, ownerUserId))
    )[0],
  );
}

/** Call the owner-only Lattice routes as one signed-in person. */
function callAs(userId: string) {
  const app = appWithSession(lattice, fakeSession(userId));
  return async (
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await app.request(path, {
      ...(init.method ? { method: init.method } : {}),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: JSON_HEADERS,
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

describe('choosing which runtime Athena uses', () => {
  it('moves the choice to another device on the same account', async () => {
    const owner = await seedOwner('Switcher');
    const connection = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio',
      deviceStatus: 'reachable',
      enabled: true,
    });
    await seedCredential(connection.id, owner, grant('fresh'));
    gateway.runtimes = [runtime('lat_studio', 'Studio'), runtime('lat_laptop', 'Laptop')];

    const { status, body } = await callAs(owner)('/lattice/device', {
      method: 'POST',
      body: { deviceId: 'lat_laptop' },
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ deviceId: 'lat_laptop', deviceName: 'Laptop', enabled: true });
    expect(await readConnection(owner)).toMatchObject({
      deviceId: 'lat_laptop',
      deviceName: 'Laptop',
      deviceStatus: 'reachable',
      status: 'connected',
      enabled: true,
    });
  });

  it('records the choice without switching Athena onto it when asked not to', async () => {
    const owner = await seedOwner('Deferred');
    const connection = await seedConnection(owner, { status: 'pending' });
    await seedCredential(connection.id, owner, grant('fresh'));

    const { body } = await callAs(owner)('/lattice/device', {
      method: 'POST',
      body: { deviceId: 'lat_studio', enabled: false },
    });

    expect(body).toMatchObject({
      connected: true,
      enabled: false,
      deviceId: 'lat_studio',
      unavailableReason: null,
    });
    const stored = await readConnection(owner);
    expect(stored.enabled).toBe(false);
    expect(stored.deviceId).toBe('lat_studio');
    expect(stored.lastVerifiedAt).not.toBeNull();
  });

  it('refuses a device the account no longer has and leaves the previous choice alone', async () => {
    const owner = await seedOwner('Missing');
    const connection = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio',
      deviceStatus: 'reachable',
      enabled: true,
    });
    await seedCredential(connection.id, owner, grant('fresh'));

    const { status, body } = await callAs(owner)('/lattice/device', {
      method: 'POST',
      body: { deviceId: 'lat_gone' },
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ deviceId: 'lat_studio', unavailableReason: 'device_missing' });
    const stored = await readConnection(owner);
    expect(stored.deviceId).toBe('lat_studio');
    expect(stored.lastFailureReason).toBe('device_missing');
    // `device_missing` is not terminal: the machine may be re-paired, so the grant stays on.
    expect(stored.status).toBe('connected');
    expect(stored.enabled).toBe(true);
  });

  it('marks a chosen device that has left the account as revoked on the next gateway read', async () => {
    const owner = await seedOwner('Vanished');
    const connection = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio',
      deviceStatus: 'reachable',
      enabled: true,
    });
    await seedCredential(connection.id, owner, grant('fresh'));
    gateway.runtimes = [runtime('lat_laptop', 'Laptop')];

    const { status, body } = await callAs(owner)('/lattice/devices');

    expect(status).toBe(200);
    expect(body).toMatchObject({ unavailableReason: null });
    expect(body['devices']).toEqual([
      expect.objectContaining({ id: 'lat_laptop', selected: false }),
    ]);
    // The picker keeps naming the machine the person chose, but stops claiming it is fine.
    expect(await readConnection(owner)).toMatchObject({
      deviceId: 'lat_studio',
      deviceStatus: 'revoked',
    });
  });

  it('refuses to choose a device while the consent is still in flight', async () => {
    const owner = await seedOwner('MidConsent');
    const started = await callAs(owner)('/lattice/authorize', { method: 'POST' });
    expect(started.status).toBe(200);

    const { body } = await callAs(owner)('/lattice/device', {
      method: 'POST',
      body: { deviceId: 'lat_studio' },
    });

    expect(body).toMatchObject({ connected: false, unavailableReason: 'not_connected' });
    const stored = await readConnection(owner);
    expect(stored.deviceId).toBeNull();
    expect(stored.lastFailureReason).toBe('not_connected');
  });

  it('refuses to choose a device for a connection whose sealed grant is gone', async () => {
    const owner = await seedOwner('Ungranted');
    await seedConnection(owner, { status: 'connected' });

    const { body } = await callAs(owner)('/lattice/device', {
      method: 'POST',
      body: { deviceId: 'lat_studio' },
    });

    expect(body).toMatchObject({ unavailableReason: 'not_connected' });
    expect((await readConnection(owner)).deviceId).toBeNull();
    // Nothing was read from the gateway: there was no token to read it with.
    expect(gateway.calls).toEqual([]);
  });
});

describe('turning the connection on and off', () => {
  it('refuses to switch on before a runtime is chosen', async () => {
    const owner = await seedOwner('NoDevice');
    await seedConnection(owner, { status: 'connected' });

    const { status, body } = await callAs(owner)('/lattice', {
      method: 'PATCH',
      body: { enabled: true },
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ enabled: false, unavailableReason: 'no_device_selected' });
    expect((await readConnection(owner)).enabled).toBe(false);
  });

  it('switches off and back on without discarding the grant or the runtime choice', async () => {
    const owner = await seedOwner('Toggler');
    const connection = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio',
      deviceStatus: 'reachable',
      enabled: true,
    });
    await seedCredential(connection.id, owner, grant('fresh'));
    const call = callAs(owner);

    const off = await call('/lattice', { method: 'PATCH', body: { enabled: false } });
    expect(off.body).toMatchObject({ connected: true, enabled: false, deviceId: 'lat_studio' });
    expect((await readConnection(owner)).enabled).toBe(false);

    const on = await call('/lattice', { method: 'PATCH', body: { enabled: true } });
    expect(on.body).toMatchObject({ enabled: true, deviceId: 'lat_studio' });
    const stored = await readConnection(owner);
    expect(stored.enabled).toBe(true);
    expect(
      await db
        .select()
        .from(schema.latticeCredential)
        .where(eq(schema.latticeCredential.connectionId, connection.id)),
    ).toHaveLength(1);
  });
});

describe('clearing the connection', () => {
  it('reports the same unconnected state for an account that never connected, and stores nothing', async () => {
    const owner = await seedOwner('NeverConnected');

    const { status, body } = await callAs(owner)('/lattice', { method: 'DELETE' });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      connected: false,
      enabled: false,
      deviceId: null,
      deviceStatus: null,
      unavailableReason: null,
    });
    expect(
      await db
        .select()
        .from(schema.latticeConnection)
        .where(eq(schema.latticeConnection.ownerUserId, owner)),
    ).toEqual([]);
  });
});

describe('one person’s connection is never another person’s', () => {
  it('has nothing to read, choose or switch for someone who never connected', async () => {
    const connected = await seedOwner('Owner');
    const connection = await seedConnection(connected, {
      deviceId: 'lat_studio',
      deviceName: 'Studio',
      deviceStatus: 'reachable',
      enabled: true,
    });
    await seedCredential(connection.id, connected, grant('fresh'));
    const stranger = await seedOwner('Stranger');
    const call = callAs(stranger);

    expect((await call('/lattice/devices')).status).toBe(404);
    expect(
      (await call('/lattice/device', { method: 'POST', body: { deviceId: 'lat_studio' } })).status,
    ).toBe(404);
    expect((await call('/lattice', { method: 'PATCH', body: { enabled: false } })).status).toBe(
      404,
    );
    expect((await call('/lattice')).body).toMatchObject({ connected: false, deviceId: null });

    // The other person's connection is untouched by all of it.
    expect(await readConnection(connected)).toMatchObject({
      deviceId: 'lat_studio',
      enabled: true,
      status: 'connected',
    });
  });

  it('refuses every route to a request carrying no session', async () => {
    const anonymous = appWithSession(lattice, null);

    for (const [path, init] of [
      ['/lattice', {}],
      ['/lattice/devices', {}],
      ['/lattice/authorize', { method: 'POST' }],
      ['/lattice', { method: 'DELETE' }],
    ] as const) {
      const response = await anonymous.request(path, { ...init, headers: JSON_HEADERS });
      expect(response.status).toBe(401);
    }
  });

  it('does not hand a sealed grant to a different owner', async () => {
    const owner = await seedOwner('Sealed');
    const other = await seedOwner('Other');
    const connection = await seedConnection(owner);
    await seedCredential(connection.id, owner, grant('fresh', 'at_owner'));

    await expect(
      connectionModule.loadStoredLatticeCredential(connection.id, owner),
    ).resolves.toMatchObject({ kind: 'lattice_oauth', accessToken: 'at_owner' });
    await expect(
      connectionModule.loadStoredLatticeCredential(connection.id, other),
    ).resolves.toBeNull();
  });
});

describe('refreshing a grant that is about to expire', () => {
  it('refreshes before reading the gateway and stores the rotated token', async () => {
    const owner = await seedOwner('Refresher');
    const connection = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio',
      deviceStatus: 'reachable',
      enabled: true,
    });
    await seedCredential(connection.id, owner, grant('expiring'));

    const { status, body } = await callAs(owner)('/lattice/devices');

    expect(status).toBe(200);
    expect(body).toMatchObject({ unavailableReason: null });
    expect(gateway.calls.at(-1)?.authorization).toBe('Bearer at_refreshed');
    // Written back: a second turn must not replay the rotated-away refresh token.
    const stored = one(
      await db
        .select()
        .from(schema.latticeCredential)
        .where(eq(schema.latticeCredential.connectionId, connection.id)),
    );
    expect(JSON.parse(unsealCredential(stored.ciphertext))).toMatchObject({
      kind: 'lattice_oauth',
      accessToken: 'at_refreshed',
      refreshToken: 'rt_2',
    });
  });

  it('switches the connection off when the issuer refuses the refresh', async () => {
    const owner = await seedOwner('Revoked');
    const connection = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio',
      deviceStatus: 'reachable',
      enabled: true,
    });
    await seedCredential(connection.id, owner, grant('expiring'));
    accounts.refuseRefresh = true;

    const { body } = await callAs(owner)('/lattice/devices');

    expect(body).toMatchObject({ devices: [], unavailableReason: 'authorization_expired' });
    // Terminal: every later turn would fail identically, so the connection stops claiming to work.
    expect(await readConnection(owner)).toMatchObject({
      status: 'error',
      enabled: false,
      lastFailureReason: 'authorization_expired',
    });
    expect(gateway.calls).toEqual([]);
  });

  it('omits the client secret from the token request for a public client', async () => {
    const owner = await seedOwner('PublicClient');
    const connection = await seedConnection(owner);
    await seedCredential(connection.id, owner, grant('expiring'));
    mutableEnv.LATTICE_CLIENT_SECRET = undefined;

    await expect(
      connectionModule.loadUsableLatticeCredential(await connectionOf(owner)),
    ).resolves.toMatchObject({ accessToken: 'at_refreshed' });

    const form = assertDefined(accounts.forms[0]);
    expect(form['client_id']).toBe('client_docket_test');
    expect(form['client_secret']).toBeUndefined();
    expect(form['grant_type']).toBe('refresh_token');
  });
});

describe('a deployment without a registered Lovelace client', () => {
  it('still reports why the section is unavailable', async () => {
    const owner = await seedOwner('Unconfigured');
    mutableEnv.LATTICE_CLIENT_ID = undefined;

    const { status, body } = await callAs(owner)('/lattice');

    expect(status).toBe(200);
    expect(body).toMatchObject({
      available: false,
      deploymentReason: 'not_configured',
      connected: false,
    });
  });

  it('refuses to start an authorization, and creates nothing', async () => {
    const owner = await seedOwner('Unconfigag');
    mutableEnv.LATTICE_CLIENT_ID = undefined;

    const { status } = await callAs(owner)('/lattice/authorize', { method: 'POST' });

    expect(status).toBe(409);
    expect(
      await db
        .select()
        .from(schema.latticeConnection)
        .where(eq(schema.latticeConnection.ownerUserId, owner)),
    ).toEqual([]);
  });

  it('reports a refresh it cannot even attempt as needing a reconnection', async () => {
    const owner = await seedOwner('LostClient');
    const connection = await seedConnection(owner);
    await seedCredential(connection.id, owner, grant('expiring'));
    const row = await connectionOf(owner);
    mutableEnv.LATTICE_CLIENT_ID = undefined;

    await expect(connectionModule.loadUsableLatticeCredential(row)).rejects.toMatchObject({
      reason: 'not_connected',
    });
    // The stored grant is left exactly as it was; nothing was posted to the issuer.
    expect(accounts.forms).toEqual([]);
    const stored = one(
      await db
        .select()
        .from(schema.latticeCredential)
        .where(eq(schema.latticeCredential.connectionId, connection.id)),
    );
    expect(JSON.parse(unsealCredential(stored.ciphertext))).toMatchObject({ accessToken: 'at_1' });
  });
});

describe('the deployment’s defaults', () => {
  it('sends the browser to Lovelace’s own accounts host when no issuer is configured', async () => {
    const owner = await seedOwner('DefaultIssuer');
    mutableEnv.LATTICE_ACCOUNTS_ISSUER = undefined;

    const { status, body } = await callAs(owner)('/lattice/authorize', { method: 'POST' });

    expect(status).toBe(200);
    const url = new URL(String(body['authorizationUrl']));
    expect(url.origin).toBe(LOVELACE_ACCOUNTS_ISSUER);
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client_docket_test');
  });

  it('calls Lattice’s own gateway when no gateway override is configured', async () => {
    const owner = await seedOwner('DefaultGateway');
    const connection = await seedConnection(owner);
    await seedCredential(connection.id, owner, grant('fresh', 'at_context'));
    const row = await connectionOf(owner);

    const overridden = await connectionModule.latticeGatewayContext(row);
    expect(overridden).toEqual({ accessToken: 'at_context', baseUrl: gatewayOrigin });

    mutableEnv.LATTICE_GATEWAY_URL = undefined;
    const defaulted = await connectionModule.latticeGatewayContext(row);
    expect(defaulted).toEqual({ accessToken: 'at_context' });
    expect(Object.hasOwn(defaulted, 'baseUrl')).toBe(false);
  });
});

/** Load a person's connection row through the owner-keyed loader the routes use. */
async function connectionOf(
  ownerUserId: string,
): Promise<LatticeConnectionModule.LatticeConnectionRow> {
  return assertDefined(await connectionModule.loadLatticeConnection(ownerUserId));
}
