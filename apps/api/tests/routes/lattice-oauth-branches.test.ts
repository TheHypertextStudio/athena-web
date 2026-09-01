/**
 * The Lovelace Lattice OAuth callback's failure paths.
 *
 * @remarks
 * `tests/lattice/lattice-flow.test.ts` drives the one happy trip through this route as part of the
 * end-to-end flow. Everything a real browser can arrive with *instead* is covered here: no state,
 * a forged state, a state for another flow or another person, a decline, a refused or malformed
 * token exchange, a narrowed grant, a back-button replay, and a second authorization against a
 * connection that already exists.
 *
 * Only the network is stood in for: the issuer's token endpoint is a stubbed `fetch`, so the real
 * exchange, the real scope check and the real sealing all run. Each case asserts what a person or
 * an operator can actually observe — the redirect's status flag, the row's stable failure code,
 * and whether a grant was stored.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // A 32-byte base64 key, so pending and approved credentials are really sealed.
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
  process.env['LATTICE_CLIENT_ID'] = 'client_docket';
  process.env['LATTICE_CLIENT_SECRET'] = 'secret_docket';
  process.env['LATTICE_ACCOUNTS_ISSUER'] = 'https://lovelace-accounts.test';
});

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import { signConnectState } from '../../src/lib/oauth-state';
import type latticeOAuthRouter from '../../src/routes/lattice-oauth';
import type {
  LatticeConnectionRow,
  loadStoredLatticeCredential as LoadStoredLatticeCredential,
  storeLatticeCredential as StoreLatticeCredential,
} from '../../src/routes/lattice-connection';
import { appWithSession, getDb, one, seedUserWithHub } from '../support/routes-harness';

/** The scopes a full Lovelace grant comes back with. */
const FULL_SCOPE = 'openid offline_access lattice:compute:inference lattice:compute:catalog:read';

const TOKEN_ENDPOINT = 'https://lovelace-accounts.test/oauth/token';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let latticeOAuth!: typeof latticeOAuthRouter;
let storeLatticeCredential!: typeof StoreLatticeCredential;
let loadStoredLatticeCredential!: typeof LoadStoredLatticeCredential;
let app!: ReturnType<typeof appWithSession>;
let fetchStub!: ReturnType<typeof vi.spyOn>;

/** One stored connection plus its owner. */
interface Connected {
  readonly userId: string;
  readonly connectionId: string;
}

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  latticeOAuth = (await import('../../src/routes/lattice-oauth')).default;
  ({ storeLatticeCredential, loadStoredLatticeCredential } =
    await import('../../src/routes/lattice-connection'));
  // The callback carries no Docket session on purpose: a third-party top-level redirect does not
  // reliably send one back.
  app = appWithSession(latticeOAuth, null);
});

beforeEach(() => {
  // Default: any unexpected issuer call fails loudly rather than reaching the network.
  fetchStub = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no issuer configured'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Seed a person with a connection row waiting on consent. */
async function seedConnection(
  status: 'pending' | 'error' | 'connected' = 'pending',
): Promise<Connected> {
  const userId = await seedUserWithHub(
    db,
    schema,
    `LatticeCb-${Math.random().toString(36).slice(2, 8)}`,
  );
  const connectionId = one(
    await db
      .insert(schema.latticeConnection)
      .values({ ownerUserId: userId, status })
      .returning({ id: schema.latticeConnection.id }),
  ).id;
  return { userId, connectionId };
}

/** Read one connection row back. */
async function readConnection(connectionId: string): Promise<LatticeConnectionRow> {
  return one(
    await db
      .select()
      .from(schema.latticeConnection)
      .where(eq(schema.latticeConnection.id, connectionId)),
  );
}

/** Mint the signed state Lovelace echoes back. */
function stateFor(fields: Record<string, string>): string {
  return signConnectState(fields);
}

/** Drive the callback and return the `?lattice=` flag the browser lands on. */
async function callback(
  query: string,
): Promise<{ status: number; flag: string | null; path: string }> {
  const response = await app.request(`http://api.test/callback${query}`);
  const location = new URL(response.headers.get('location') ?? '', 'http://web.test');
  return {
    status: response.status,
    flag: location.searchParams.get('lattice'),
    path: location.pathname,
  };
}

/** Make the issuer's token endpoint answer once with this status and body. */
function issuerAnswers(status: number, body: unknown): void {
  fetchStub.mockImplementation((input: unknown) => {
    expect(String(input)).toBe(TOKEN_ENDPOINT);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

describe('the Lattice OAuth callback', () => {
  it('sends a callback with no state back to settings as a failure', async () => {
    const landing = await callback('?code=code_1');

    expect(landing.status).toBe(302);
    expect(landing.path).toBe('/settings/athena');
    expect(landing.flag).toBe('error');
  });

  it('refuses a state that was not signed by this deployment', async () => {
    const landing = await callback('?code=code_1&state=not-a-signed-state.deadbeef');

    expect(landing.flag).toBe('error');
  });

  it('refuses a validly signed state minted for a different connect flow', async () => {
    const seeded = await seedConnection();
    const state = stateFor({
      scope: 'mcp',
      connectionId: seeded.connectionId,
      ownerUserId: seeded.userId,
    });

    const landing = await callback(`?code=code_1&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('error');
    // Nothing was recorded against the row: a foreign state never identifies one.
    const row = await readConnection(seeded.connectionId);
    expect(row.status).toBe('pending');
    expect(row.lastFailureReason).toBeNull();
  });

  it('refuses a lattice state that names no connection', async () => {
    const seeded = await seedConnection();
    const state = stateFor({ scope: 'lattice', ownerUserId: seeded.userId });

    const landing = await callback(`?code=code_1&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('error');
  });

  it('refuses a lattice state that names no owner', async () => {
    const seeded = await seedConnection();
    const state = stateFor({ scope: 'lattice', connectionId: seeded.connectionId });

    const landing = await callback(`?code=code_1&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('error');
    const row = await readConnection(seeded.connectionId);
    expect(row.lastFailureReason).toBeNull();
  });

  it('refuses a state naming a connection that no longer exists', async () => {
    const seeded = await seedConnection();
    const state = stateFor({
      scope: 'lattice',
      connectionId: 'lat_conn_deleted',
      ownerUserId: seeded.userId,
    });

    const landing = await callback(`?code=code_1&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('error');
    const row = await readConnection(seeded.connectionId);
    expect(row.status).toBe('pending');
  });

  it('refuses a state binding one person’s owner id to another person’s connection', async () => {
    const owner = await seedConnection();
    const stranger = await seedConnection();
    const state = stateFor({
      scope: 'lattice',
      connectionId: owner.connectionId,
      ownerUserId: stranger.userId,
    });

    const landing = await callback(`?code=code_1&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('error');
    // The targeted row is untouched — a mismatched owner cannot even record a failure on it.
    const row = await readConnection(owner.connectionId);
    expect(row.status).toBe('pending');
    expect(row.lastFailureReason).toBeNull();
  });

  it('treats an explicit decline as a choice, not a fault', async () => {
    const seeded = await seedConnection();
    const state = stateFor({
      scope: 'lattice',
      connectionId: seeded.connectionId,
      ownerUserId: seeded.userId,
    });

    const landing = await callback(`?error=access_denied&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('declined');
    const row = await readConnection(seeded.connectionId);
    expect(row.status).toBe('error');
    expect(row.enabled).toBe(false);
    expect(row.lastFailureReason).toBe('not_connected');
    expect(row.lastFailureAt).toBeInstanceOf(Date);
  });

  it('records a code-less callback that is not a decline as a gateway failure', async () => {
    const seeded = await seedConnection();
    const state = stateFor({
      scope: 'lattice',
      connectionId: seeded.connectionId,
      ownerUserId: seeded.userId,
    });

    const landing = await callback(`?error=server_error&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('error');
    const row = await readConnection(seeded.connectionId);
    expect(row.status).toBe('error');
    expect(row.lastFailureReason).toBe('gateway_error');
  });

  it('records a failure when no authorization is in flight for the connection', async () => {
    const seeded = await seedConnection();
    const state = stateFor({
      scope: 'lattice',
      connectionId: seeded.connectionId,
      ownerUserId: seeded.userId,
    });

    const landing = await callback(`?code=code_1&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('error');
    // No sealed verifier means there is nothing to exchange with, so the issuer is never called.
    expect(fetchStub).not.toHaveBeenCalled();
    const row = await readConnection(seeded.connectionId);
    expect(row.status).toBe('error');
    expect(row.lastFailureReason).toBe('gateway_error');
  });

  it('records a stable code, and stores nothing, when the issuer refuses the exchange', async () => {
    const seeded = await seedConnection();
    await storeLatticeCredential(seeded.connectionId, seeded.userId, {
      kind: 'lattice_oauth_pending',
      codeVerifier: 'verifier_refused',
    });
    issuerAnswers(400, {
      error: 'invalid_grant',
      error_description: 'PKCE verification failed for client client_docket',
    });
    const state = stateFor({
      scope: 'lattice',
      connectionId: seeded.connectionId,
      ownerUserId: seeded.userId,
    });

    const landing = await callback(`?code=code_intercepted&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('error');
    const row = await readConnection(seeded.connectionId);
    expect(row.status).toBe('error');
    expect(row.enabled).toBe(false);
    // Issuer prose never lands in the row: only Docket's own stable code does.
    expect(row.lastFailureReason).toBe('gateway_error');
    expect(row.grantedScope).toBeNull();
    // The flow stays un-completed: the sealed credential is still the pending one.
    const stored = await loadStoredLatticeCredential(seeded.connectionId, seeded.userId);
    expect(stored?.kind).toBe('lattice_oauth_pending');
  });

  it('records a failure when the issuer answers 200 with no access token', async () => {
    const seeded = await seedConnection();
    await storeLatticeCredential(seeded.connectionId, seeded.userId, {
      kind: 'lattice_oauth_pending',
      codeVerifier: 'verifier_tokenless',
    });
    issuerAnswers(200, { token_type: 'Bearer', expires_in: 3600, scope: FULL_SCOPE });
    const state = stateFor({
      scope: 'lattice',
      connectionId: seeded.connectionId,
      ownerUserId: seeded.userId,
    });

    const landing = await callback(`?code=code_granted&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('error');
    const row = await readConnection(seeded.connectionId);
    expect(row.status).toBe('error');
    expect(row.lastFailureReason).toBe('gateway_error');
    const stored = await loadStoredLatticeCredential(seeded.connectionId, seeded.userId);
    expect(stored?.kind).toBe('lattice_oauth_pending');
  });

  it('refuses to keep a grant the issuer narrowed below what Athena needs', async () => {
    const seeded = await seedConnection();
    await storeLatticeCredential(seeded.connectionId, seeded.userId, {
      kind: 'lattice_oauth_pending',
      codeVerifier: 'verifier_narrowed',
    });
    issuerAnswers(200, {
      access_token: 'at_narrow',
      refresh_token: 'rt_narrow',
      expires_in: 3600,
      scope: 'openid offline_access',
    });
    const state = stateFor({
      scope: 'lattice',
      connectionId: seeded.connectionId,
      ownerUserId: seeded.userId,
    });

    const landing = await callback(`?code=code_granted&state=${encodeURIComponent(state)}`);

    // Its own outcome: the person approved, just not enough, and needs a different instruction.
    expect(landing.flag).toBe('scopes');
    const row = await readConnection(seeded.connectionId);
    expect(row.status).toBe('error');
    expect(row.enabled).toBe(false);
    expect(row.lastFailureReason).toBe('insufficient_scopes');
    // A grant Athena cannot use is not kept.
    const stored = await loadStoredLatticeCredential(seeded.connectionId, seeded.userId);
    expect(stored?.kind).toBe('lattice_oauth_pending');
  });

  it('answers a replayed callback idempotently instead of re-exchanging the code', async () => {
    const seeded = await seedConnection('connected');
    await db
      .update(schema.latticeConnection)
      .set({ grantedScope: FULL_SCOPE, lastVerifiedAt: new Date() })
      .where(eq(schema.latticeConnection.id, seeded.connectionId));
    await storeLatticeCredential(seeded.connectionId, seeded.userId, {
      kind: 'lattice_oauth',
      accessToken: 'at_live',
      refreshToken: 'rt_live',
      expiresInSeconds: 3600,
      scope: FULL_SCOPE,
      obtainedAt: new Date().toISOString(),
    });
    const state = stateFor({
      scope: 'lattice',
      connectionId: seeded.connectionId,
      ownerUserId: seeded.userId,
    });

    const landing = await callback(`?code=code_consumed&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('connected');
    // The consumed code is never sent back to the issuer, so a healthy connection cannot be
    // flipped to error by a back-button resubmit.
    expect(fetchStub).not.toHaveBeenCalled();
    const row = await readConnection(seeded.connectionId);
    expect(row.status).toBe('connected');
    expect(row.lastFailureReason).toBeNull();
    const stored = await loadStoredLatticeCredential(seeded.connectionId, seeded.userId);
    expect(stored).toMatchObject({ kind: 'lattice_oauth', accessToken: 'at_live' });
  });

  it('clears an earlier failure when a connection is authorized again', async () => {
    const seeded = await seedConnection('error');
    await db
      .update(schema.latticeConnection)
      .set({ lastFailureReason: 'insufficient_scopes', lastFailureAt: new Date() })
      .where(eq(schema.latticeConnection.id, seeded.connectionId));
    await storeLatticeCredential(seeded.connectionId, seeded.userId, {
      kind: 'lattice_oauth_pending',
      codeVerifier: 'verifier_reauth',
    });
    const sentForms: string[] = [];
    fetchStub.mockImplementation((_input: unknown, init: unknown) => {
      const body = (init as { body?: unknown } | undefined)?.body;
      sentForms.push(typeof body === 'string' ? body : '');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'at_reauth',
            refresh_token: 'rt_reauth',
            expires_in: 3600,
            scope: FULL_SCOPE,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });
    const state = stateFor({
      scope: 'lattice',
      connectionId: seeded.connectionId,
      ownerUserId: seeded.userId,
    });

    const landing = await callback(`?code=code_reauth&state=${encodeURIComponent(state)}`);

    expect(landing.flag).toBe('connected');
    const row = await readConnection(seeded.connectionId);
    expect(row.status).toBe('connected');
    expect(row.grantedScope).toBe(FULL_SCOPE);
    expect(row.lastFailureReason).toBeNull();
    expect(row.lastFailureAt).toBeNull();
    expect(row.lastVerifiedAt).toBeInstanceOf(Date);

    // The exchange carried the code from the URL and the verifier that was sealed at /authorize.
    const form = new URLSearchParams(assertDefined(sentForms[0]));
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('code_reauth');
    expect(form.get('code_verifier')).toBe('verifier_reauth');

    // The person ends up with exactly one sealed credential, now the approved one.
    const credentials = await db
      .select()
      .from(schema.latticeCredential)
      .where(eq(schema.latticeCredential.connectionId, seeded.connectionId));
    expect(credentials).toHaveLength(1);
    expect(assertDefined(credentials[0]).ciphertext).not.toContain('at_reauth');
    const stored = await loadStoredLatticeCredential(seeded.connectionId, seeded.userId);
    expect(stored).toMatchObject({ kind: 'lattice_oauth', accessToken: 'at_reauth' });
  });
});
