/**
 * The refusals and edge states of the owner-only Lattice routes (`/v1/me/athena/lattice`).
 *
 * @remarks
 * `tests/lattice/lattice-flow.test.ts` walks the happy path end to end against real local servers.
 * This suite covers what that walk never reaches: a signed-out caller, a caller who has never
 * connected, a deployment with no Lovelace OAuth client registered, a gateway that answers with an
 * empty account, a stored value an older build wrote, and the disconnect that must keep the
 * connection row while clearing every secret and every device fact on it.
 *
 * The gateway itself is stubbed here (the flow test owns the real-HTTP proof) so each case can
 * script exactly what the account reports; everything below the route — sealing, unsealing,
 * failure recording, the `enabled`/`device_id` CHECK — is the real implementation.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('4'.repeat(32)).toString('base64');
  // A registered client is what makes the deployment able to offer Lattice at all; the
  // "not configured" cases below take it away again for the duration of one describe block.
  process.env['LATTICE_CLIENT_ID'] = 'client_docket_test';
});

const { listLatticeDevices } = vi.hoisted(() => ({ listLatticeDevices: vi.fn() }));

vi.mock('@docket/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof IntegrationsModule>()),
  listLatticeDevices,
}));

import type * as DbModule from '@docket/db';
import type * as IntegrationsModule from '@docket/integrations';
import { LATTICE_SCOPES, LatticeUnavailableError, type LatticeDevice } from '@docket/integrations';

import { env } from '../../src/env';
import type latticeRouter from '../../src/routes/lattice';
import type {
  loadStoredLatticeCredential as LoadStoredLatticeCredential,
  storeLatticeCredential as StoreLatticeCredential,
} from '../../src/routes/lattice-connection';
import { appWithSession, fakeSession, getDb, one } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

const JSON_HEADERS = { 'content-type': 'application/json' };

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let lattice!: typeof latticeRouter;
let storeLatticeCredential!: typeof StoreLatticeCredential;
let loadStoredLatticeCredential!: typeof LoadStoredLatticeCredential;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  lattice = (await import('../../src/routes/lattice')).default;
  ({ storeLatticeCredential, loadStoredLatticeCredential } =
    await import('../../src/routes/lattice-connection'));
});

afterEach(() => {
  listLatticeDevices.mockReset();
  vi.restoreAllMocks();
});

/** A device as the gateway reports it. */
function device(overrides: Partial<LatticeDevice> = {}): LatticeDevice {
  return {
    id: 'lat_studio',
    name: 'Studio Mac',
    status: 'reachable',
    ready: true,
    lastSeenAt: '2026-08-29T12:00:00.000Z',
    executionBackend: 'local-model',
    ...overrides,
  };
}

/** Seed a Better Auth user to own a connection. */
async function seedUser(label: string): Promise<string> {
  return one(
    await db
      .insert(schema.user)
      .values({
        name: label,
        email: `${label}-${Math.random().toString(36).slice(2)}@example.com`,
        emailVerified: true,
      })
      .returning({ id: schema.user.id }),
  ).id;
}

/** Seed a connection row for an owner, with an approved sealed grant unless told otherwise. */
async function seedConnection(
  ownerUserId: string,
  overrides: Partial<typeof schema.latticeConnection.$inferInsert> = {},
  options: { readonly credential?: 'approved' | 'corrupt' | 'none' } = {},
): Promise<string> {
  const connectionId = one(
    await db
      .insert(schema.latticeConnection)
      .values({
        ownerUserId,
        status: 'connected',
        grantedScope: LATTICE_SCOPES.join(' '),
        accountId: 'acct_lovelace_1',
        ...overrides,
      })
      .returning({ id: schema.latticeConnection.id }),
  ).id;
  const credential = options.credential ?? 'approved';
  if (credential === 'approved') {
    await storeLatticeCredential(connectionId, ownerUserId, {
      kind: 'lattice_oauth',
      accessToken: 'at_test',
      refreshToken: 'rt_test',
      // No reported lifetime: the stored token is used as-is, so no test here talks to an issuer.
      expiresInSeconds: null,
      scope: LATTICE_SCOPES.join(' '),
      obtainedAt: new Date().toISOString(),
    });
  }
  if (credential === 'corrupt') {
    await db
      .insert(schema.latticeCredential)
      .values({ connectionId, ownerUserId, ciphertext: 'not-a-sealed-envelope' });
  }
  return connectionId;
}

/** Read the one connection row an owner has. */
async function readConnection(
  ownerUserId: string,
): Promise<typeof schema.latticeConnection.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(schema.latticeConnection)
    .where(eq(schema.latticeConnection.ownerUserId, ownerUserId));
  return rows[0];
}

/** Call the router as a signed-in owner (or as nobody, with `null`). */
async function call(
  userId: string | null,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const app = appWithSession(lattice, userId === null ? null : fakeSession(userId));
  return await app.request(path, {
    method: init.method ?? 'GET',
    headers: JSON_HEADERS,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

describe('the Lattice routes with no signed-in owner', () => {
  it('refuses to report anyone’s connection', async () => {
    const response = await call(null, '/lattice');

    expect(response.status).toBe(401);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: 'unauthorized',
    });
  });

  it('refuses to disconnect, leaving the grant intact', async () => {
    const owner = await seedUser('lattice-signed-out');
    const connectionId = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      deviceStatus: 'reachable',
      enabled: true,
    });

    const response = await call(null, '/lattice', { method: 'DELETE' });

    expect(response.status).toBe(401);
    expect(await readConnection(owner)).toMatchObject({
      status: 'connected',
      enabled: true,
      deviceId: 'lat_studio',
    });
    expect(
      await db
        .select()
        .from(schema.latticeCredential)
        .where(eq(schema.latticeCredential.connectionId, connectionId)),
    ).toHaveLength(1);
  });
});

describe('the Lattice routes for someone who has never connected', () => {
  it('reports an available, unconnected deployment', async () => {
    const owner = await seedUser('lattice-never-connected');

    const response = await call(owner, '/lattice');

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      available: true,
      deploymentReason: null,
      connected: false,
      enabled: false,
      deviceId: null,
      deviceName: null,
      deviceStatus: null,
      grantedScope: null,
      unavailableReason: null,
    });
  });

  it('refuses to list devices, choose one, or switch on', async () => {
    const owner = await seedUser('lattice-no-connection');

    const [devices, chosen, switched] = await Promise.all([
      call(owner, '/lattice/devices'),
      call(owner, '/lattice/device', { method: 'POST', body: { deviceId: 'lat_studio' } }),
      call(owner, '/lattice', { method: 'PATCH', body: { enabled: true } }),
    ]);

    expect([devices.status, chosen.status, switched.status]).toEqual([404, 404, 404]);
    expect((await devices.json()) as Record<string, unknown>).toMatchObject({ code: 'not_found' });
    // A refused call must not conjure a connection row for them.
    expect(await readConnection(owner)).toBeUndefined();
    expect(listLatticeDevices).not.toHaveBeenCalled();
  });

  it('disconnects into the same unconnected state without creating a row', async () => {
    const owner = await seedUser('lattice-disconnect-nothing');

    const response = await call(owner, '/lattice', { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      connected: false,
      enabled: false,
      deviceId: null,
    });
    expect(await readConnection(owner)).toBeUndefined();
  });
});

describe('starting and completing a Lattice authorization attempt', () => {
  it('keeps a working grant active while returning redirect and FedCM inputs', async () => {
    const owner = await seedUser('lattice-relink-start');
    const connectionId = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      deviceStatus: 'reachable',
      enabled: true,
    });

    const response = await call(owner, '/lattice/authorize', { method: 'POST' });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      attemptId: string;
      expiresAt: string;
      authorizationUrl: string;
      fedcm: {
        configUrl: string;
        clientId: string;
        params: Record<string, string>;
      };
    };
    const redirect = new URL(body.authorizationUrl);
    expect(body.attemptId).toBeTruthy();
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.fedcm).toMatchObject({
      configUrl: 'https://auth.uselovelace.com/web-identity/config.json',
      clientId: 'client_docket_test',
      params: {
        purpose: 'oauth_authorization',
        redirect_uri: expect.stringContaining('/internal/integrations/lattice/callback'),
        scope: LATTICE_SCOPES.join(' '),
        code_challenge_method: 'S256',
      },
    });
    expect(body.fedcm.params['state']).toBe(redirect.searchParams.get('state'));
    expect(body.fedcm.params['code_challenge']).toBe(redirect.searchParams.get('code_challenge'));

    expect(await readConnection(owner)).toMatchObject({
      id: connectionId,
      status: 'connected',
      enabled: true,
      deviceId: 'lat_studio',
    });
    expect(await loadStoredLatticeCredential(connectionId, owner)).toMatchObject({
      kind: 'lattice_oauth',
      accessToken: 'at_test',
    });
    const attempts = await db
      .select()
      .from(schema.latticeAuthorizationAttempt)
      .where(eq(schema.latticeAuthorizationAttempt.id, body.attemptId));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      connectionId,
      ownerUserId: owner,
      status: 'pending',
      redirectUri: body.fedcm.params['redirect_uri'],
      scope: LATTICE_SCOPES.join(' '),
      codeChallenge: body.fedcm.params['code_challenge'],
      consumedAt: null,
    });
    expect(attempts[0]?.verifierCiphertext).toContain('v1:gcm:');
    expect(attempts[0]?.verifierCiphertext).not.toContain('code_verifier');
  });

  it('exchanges a FedCM code once and installs the resulting grant', async () => {
    const owner = await seedUser('lattice-fedcm-complete');
    const started = await call(owner, '/lattice/authorize', { method: 'POST' });
    const { attemptId } = (await started.json()) as { attemptId: string };
    const issuer = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'at_fedcm',
          refresh_token: 'rt_fedcm',
          expires_in: 3600,
          scope: LATTICE_SCOPES.join(' '),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const completed = await call(owner, '/lattice/authorize/complete', {
      method: 'POST',
      body: { attemptId, authorizationCode: 'code_from_fedcm' },
    });
    const replay = await call(owner, '/lattice/authorize/complete', {
      method: 'POST',
      body: { attemptId, authorizationCode: 'code_from_fedcm' },
    });

    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({ status: 'connected' });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ status: 'connected' });
    expect(issuer).toHaveBeenCalledTimes(1);

    const connection = await readConnection(owner);
    expect(connection).toMatchObject({
      status: 'connected',
      grantedScope: LATTICE_SCOPES.join(' '),
      lastFailureReason: null,
    });
    expect(await loadStoredLatticeCredential(assertDefined(connection).id, owner)).toMatchObject({
      kind: 'lattice_oauth',
      accessToken: 'at_fedcm',
      refreshToken: 'rt_fedcm',
    });
    const [attempt] = await db
      .select()
      .from(schema.latticeAuthorizationAttempt)
      .where(eq(schema.latticeAuthorizationAttempt.id, attemptId));
    expect(attempt).toMatchObject({ status: 'completed', failureReason: null });
    expect(attempt?.consumedAt).toBeInstanceOf(Date);

    const request = issuer.mock.calls[0]?.[1];
    const form = new URLSearchParams(typeof request?.body === 'string' ? request.body : '');
    expect(form.get('code')).toBe('code_from_fedcm');
    expect(form.get('code_verifier')).toBeTruthy();
  });

  it('does not let a failed replacement attempt damage the active connection', async () => {
    const owner = await seedUser('lattice-relink-fails');
    const connectionId = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      enabled: true,
    });
    const started = await call(owner, '/lattice/authorize', { method: 'POST' });
    const { attemptId } = (await started.json()) as { attemptId: string };
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('issuer unavailable'));

    const response = await call(owner, '/lattice/authorize/complete', {
      method: 'POST',
      body: { attemptId, authorizationCode: 'code_unexchangeable' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'error' });
    expect(await readConnection(owner)).toMatchObject({
      id: connectionId,
      status: 'connected',
      enabled: true,
      deviceId: 'lat_studio',
      lastFailureReason: null,
    });
    expect(await loadStoredLatticeCredential(connectionId, owner)).toMatchObject({
      kind: 'lattice_oauth',
      accessToken: 'at_test',
    });
    const [attempt] = await db
      .select()
      .from(schema.latticeAuthorizationAttempt)
      .where(eq(schema.latticeAuthorizationAttempt.id, attemptId));
    expect(attempt).toMatchObject({ status: 'failed', failureReason: 'gateway_error' });
  });

  it('refuses to complete another owner’s attempt before calling Lovelace', async () => {
    const owner = await seedUser('lattice-attempt-owner');
    const stranger = await seedUser('lattice-attempt-stranger');
    const started = await call(owner, '/lattice/authorize', { method: 'POST' });
    const { attemptId } = (await started.json()) as { attemptId: string };
    const issuer = vi.spyOn(globalThis, 'fetch');

    const response = await call(stranger, '/lattice/authorize/complete', {
      method: 'POST',
      body: { attemptId, authorizationCode: 'code_stolen' },
    });

    expect(response.status).toBe(404);
    expect(issuer).not.toHaveBeenCalled();
  });
});

describe('the Lattice routes on a deployment with no Lovelace client', () => {
  /** Run one case with the OAuth client id taken away, then put it back. */
  async function unconfigured<T>(run: () => Promise<T>): Promise<T> {
    // `env` is a validated snapshot, not a live view of `process.env`; the same
    // `Reflect.set` swap `tests/routes/billing-http.test.ts` uses for its own flag.
    const configured = env.LATTICE_CLIENT_ID;
    Reflect.set(env, 'LATTICE_CLIENT_ID', undefined);
    try {
      return await run();
    } finally {
      Reflect.set(env, 'LATTICE_CLIENT_ID', configured);
    }
  }

  it('still explains why the section is unavailable', async () => {
    const owner = await seedUser('lattice-unconfigured-read');
    await seedConnection(owner, { deviceId: 'lat_studio', deviceName: 'Studio Mac' });

    const response = await unconfigured(async () => await call(owner, '/lattice'));

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      available: false,
      deploymentReason: 'not_configured',
      connected: true,
      deviceId: 'lat_studio',
    });
  });

  it('refuses every mutating route', async () => {
    const owner = await seedUser('lattice-unconfigured-mutations');
    await seedConnection(owner, { deviceId: 'lat_studio', deviceName: 'Studio Mac' });

    const responses = await unconfigured(
      async () =>
        await Promise.all([
          call(owner, '/lattice/authorize', { method: 'POST' }),
          call(owner, '/lattice/devices'),
          call(owner, '/lattice/device', { method: 'POST', body: { deviceId: 'lat_studio' } }),
          call(owner, '/lattice', { method: 'PATCH', body: { enabled: true } }),
        ]),
    );

    expect(responses.map((response) => response.status)).toEqual([409, 409, 409, 409]);
    const [authorize] = responses;
    expect((await assertDefined(authorize).json()) as Record<string, unknown>).toMatchObject({
      code: 'conflict',
    });
    // Nothing was written on the way to the refusal: no consent flow, no device choice.
    expect(await readConnection(owner)).toMatchObject({
      status: 'connected',
      enabled: false,
      deviceStatus: null,
    });
    expect(listLatticeDevices).not.toHaveBeenCalled();
  });

  it('still lets someone disconnect', async () => {
    const owner = await seedUser('lattice-unconfigured-disconnect');
    await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      deviceStatus: 'reachable',
      enabled: true,
    });

    const response = await unconfigured(
      async () => await call(owner, '/lattice', { method: 'DELETE' }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      available: false,
      deploymentReason: 'not_configured',
      connected: false,
      enabled: false,
      deviceId: null,
    });
    expect(await readConnection(owner)).toMatchObject({ status: 'disconnected', enabled: false });
  });
});

describe('listing the devices on a Lattice account', () => {
  it('reports an account with no devices and marks the chosen one revoked', async () => {
    const owner = await seedUser('lattice-empty-account');
    await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      deviceStatus: 'reachable',
      lastFailureReason: 'device_offline',
      lastFailureAt: new Date(),
    });
    listLatticeDevices.mockResolvedValue([]);

    const response = await call(owner, '/lattice/devices');

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toEqual({
      devices: [],
      unavailableReason: null,
    });
    // The account can no longer see the chosen machine, so its stored status says exactly that
    // rather than keeping the last-known-good "reachable".
    const row = await readConnection(owner);
    expect(row).toMatchObject({
      deviceId: 'lat_studio',
      deviceStatus: 'revoked',
      lastFailureReason: null,
      lastFailureAt: null,
    });
    expect(row?.lastVerifiedAt).toBeInstanceOf(Date);
  });

  it('refreshes the chosen device’s live status from the account', async () => {
    const owner = await seedUser('lattice-refresh-status');
    await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      deviceStatus: 'reachable',
    });
    listLatticeDevices.mockResolvedValue([
      device({ status: 'offline', ready: false }),
      device({ id: 'lat_laptop', name: 'Laptop' }),
    ]);

    const response = await call(owner, '/lattice/devices');
    const body = (await response.json()) as { devices: Record<string, unknown>[] };

    expect(body.devices).toEqual([
      expect.objectContaining({ id: 'lat_studio', status: 'offline', selected: true }),
      expect.objectContaining({ id: 'lat_laptop', status: 'reachable', selected: false }),
    ]);
    expect(await readConnection(owner)).toMatchObject({ deviceStatus: 'offline' });
  });

  it('answers an unreadable gateway with an actionable reason and records it', async () => {
    const owner = await seedUser('lattice-gateway-down');
    await seedConnection(owner, { deviceId: 'lat_studio', deviceName: 'Studio Mac' });
    listLatticeDevices.mockRejectedValue(
      new LatticeUnavailableError('gateway_unreachable', 'getaddrinfo ENOTFOUND'),
    );

    const response = await call(owner, '/lattice/devices');

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toEqual({
      devices: [],
      unavailableReason: 'gateway_unreachable',
    });
    const row = await readConnection(owner);
    expect(row).toMatchObject({ lastFailureReason: 'gateway_unreachable', status: 'connected' });
    expect(row?.lastFailureAt).toBeInstanceOf(Date);
  });

  it('switches a narrowed grant off instead of leaving it apparently working', async () => {
    const owner = await seedUser('lattice-narrow-grant');
    await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      enabled: true,
    });
    listLatticeDevices.mockRejectedValue(new LatticeUnavailableError('insufficient_scopes'));

    const response = await call(owner, '/lattice/devices');

    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      unavailableReason: 'insufficient_scopes',
    });
    expect(await readConnection(owner)).toMatchObject({
      status: 'error',
      enabled: false,
      lastFailureReason: 'insufficient_scopes',
    });
  });

  it('fails the request when the stored grant cannot be unsealed', async () => {
    const owner = await seedUser('lattice-corrupt-grant');
    await seedConnection(
      owner,
      { deviceId: 'lat_studio', deviceName: 'Studio Mac' },
      { credential: 'corrupt' },
    );

    const response = await call(owner, '/lattice/devices');

    expect(response.status).toBe(409);
    // A failure that is not a Lattice unavailability is never dressed up as one, and nothing
    // actionable is recorded against the connection.
    expect(await readConnection(owner)).toMatchObject({ lastFailureReason: null });
    expect(listLatticeDevices).not.toHaveBeenCalled();
  });
});

describe('choosing which device runs Athena’s turns', () => {
  it('refuses a device the account does not have, leaving the choice alone', async () => {
    const owner = await seedUser('lattice-device-missing');
    await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      deviceStatus: 'reachable',
    });
    listLatticeDevices.mockResolvedValue([device({ id: 'lat_laptop', name: 'Laptop' })]);

    const response = await call(owner, '/lattice/device', {
      method: 'POST',
      body: { deviceId: 'lat_desktop' },
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      deviceId: 'lat_studio',
      deviceStatus: 'reachable',
      unavailableReason: 'device_missing',
    });
    expect(await readConnection(owner)).toMatchObject({
      deviceId: 'lat_studio',
      lastFailureReason: 'device_missing',
    });
  });

  it('records a device chosen without switching Athena onto it', async () => {
    const owner = await seedUser('lattice-choose-disabled');
    await seedConnection(owner, { status: 'pending' });
    listLatticeDevices.mockResolvedValue([device({ status: 'offline', ready: false })]);

    const response = await call(owner, '/lattice/device', {
      method: 'POST',
      body: { deviceId: 'lat_studio', enabled: false },
    });

    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      connected: true,
      enabled: false,
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      deviceStatus: 'offline',
      unavailableReason: null,
    });
    expect(await readConnection(owner)).toMatchObject({
      status: 'connected',
      enabled: false,
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
    });
  });
});

describe('switching the Lattice backend on and off', () => {
  it('reports a missing device choice rather than switching on', async () => {
    const owner = await seedUser('lattice-switch-no-device');
    await seedConnection(owner);

    const response = await call(owner, '/lattice', { method: 'PATCH', body: { enabled: true } });

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      enabled: false,
      deviceId: null,
      unavailableReason: 'no_device_selected',
    });
    expect(await readConnection(owner)).toMatchObject({ enabled: false });
  });

  it('switches on once a device is chosen', async () => {
    const owner = await seedUser('lattice-switch-on');
    await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      deviceStatus: 'reachable',
    });

    const response = await call(owner, '/lattice', { method: 'PATCH', body: { enabled: true } });

    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      enabled: true,
      deviceId: 'lat_studio',
      unavailableReason: null,
    });
    expect(await readConnection(owner)).toMatchObject({ enabled: true });
  });
});

describe('disconnecting Lovelace', () => {
  it('clears the grant, the account and the device while keeping the connection', async () => {
    const owner = await seedUser('lattice-disconnect');
    const other = await seedUser('lattice-disconnect-bystander');
    const connectionId = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      deviceStatus: 'reachable',
      enabled: true,
      lastFailureReason: 'device_offline',
      lastFailureAt: new Date(),
      lastVerifiedAt: new Date(),
    });
    const otherConnectionId = await seedConnection(other, {
      deviceId: 'lat_other',
      deviceName: 'Other Mac',
    });

    const response = await call(owner, '/lattice', { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      available: true,
      connected: false,
      enabled: false,
      deviceId: null,
      deviceName: null,
      deviceStatus: null,
      grantedScope: null,
      unavailableReason: null,
    });
    // The row survives (delegation history references it) with every secret and device fact gone.
    expect(await readConnection(owner)).toMatchObject({
      id: connectionId,
      status: 'disconnected',
      enabled: false,
      deviceId: null,
      deviceName: null,
      deviceStatus: null,
      grantedScope: null,
      accountId: null,
      lastFailureReason: null,
      lastFailureAt: null,
      lastVerifiedAt: null,
    });
    expect(
      await db
        .select()
        .from(schema.latticeCredential)
        .where(eq(schema.latticeCredential.connectionId, connectionId)),
    ).toHaveLength(0);
    // One person's disconnect is theirs alone.
    expect(
      await db
        .select()
        .from(schema.latticeCredential)
        .where(
          and(
            eq(schema.latticeCredential.connectionId, otherConnectionId),
            eq(schema.latticeCredential.ownerUserId, other),
          ),
        ),
    ).toHaveLength(1);
    expect(await readConnection(other)).toMatchObject({
      status: 'connected',
      deviceId: 'lat_other',
    });
  });

  it('leaves a disconnected connection disconnected when repeated', async () => {
    const owner = await seedUser('lattice-disconnect-twice');
    const connectionId = await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
    });

    await call(owner, '/lattice', { method: 'DELETE' });
    const response = await call(owner, '/lattice', { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      connected: false,
      deviceId: null,
    });
    expect(await readConnection(owner)).toMatchObject({
      id: connectionId,
      status: 'disconnected',
    });
  });
});

describe('reading a connection an older build wrote', () => {
  it('drops a device status and failure reason it no longer recognizes', async () => {
    const owner = await seedUser('lattice-legacy-values');
    await seedConnection(owner, {
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      deviceStatus: 'degraded',
      lastFailureReason: 'gateway_flooded',
    });

    const response = await call(owner, '/lattice');

    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      connected: true,
      deviceId: 'lat_studio',
      deviceName: 'Studio Mac',
      // Unreadable values read as absent rather than failing the response schema.
      deviceStatus: null,
      unavailableReason: null,
    });
  });
});
