/**
 * `@docket/api` — the browser callback for a Lovelace Lattice authorization.
 *
 * @remarks
 * Lovelace redirects the person's user agent here after they approve (or decline) on Lovelace's
 * own consent screen. Like the MCP callback next door, this route has **no required Docket
 * session**: a third-party top-level redirect does not reliably carry a session cookie back, so
 * requiring one would break the flow for a share of users for no security benefit.
 *
 * What carries the trust instead:
 *
 * - The signed `state` envelope, HMAC'd with `BETTER_AUTH_SECRET` and expiring in ten minutes,
 *   binds this response to exactly one connection row and one owner. That is both the tenancy
 *   binding and the CSRF defense.
 * - The PKCE verifier was sealed against that row when the flow started, so a code intercepted in
 *   transit cannot be exchanged by anyone else.
 *
 * The redirect target is always the Athena settings page with a coarse status flag. No issuer
 * text ever rides on the URL — the page owns its own copy for each outcome.
 */
import { db, latticeConnection } from '@docket/db';
import { completeLatticeAuthorization, missingLatticeScopes } from '@docket/integrations';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { webAppOrigin } from '../lib/github-app';
import { verifyConnectState } from '../lib/oauth-state';
import {
  completeLatticeAuthorizationAttempt,
  rejectLatticeAuthorizationAttempt,
} from './lattice-authorization';
import {
  latticeOAuthConfig,
  loadStoredLatticeCredential,
  storeLatticeCredential,
  type LatticeConnectionRow,
} from './lattice-connection';

/**
 * The coarse outcomes the settings page renders copy for.
 *
 * @remarks
 * `scopes` is separate from `error` because it needs a different instruction: the person did
 * approve, but approved less than Athena needs, and telling them "something went wrong" would send
 * them round the same loop.
 */
type CallbackStatus = 'connected' | 'declined' | 'error' | 'scopes';

/** Return to Settings → Athena with a status flag and nothing else. */
function settingsRedirect(status: CallbackStatus): string {
  return `${webAppOrigin()}/settings/athena?lattice=${status}`;
}

/** Stamp a terminal failure on the connection row. */
async function markFailed(row: LatticeConnectionRow, reason: string): Promise<void> {
  await db
    .update(latticeConnection)
    .set({
      status: 'error',
      enabled: false,
      lastFailureReason: reason,
      lastFailureAt: new Date(),
    })
    .where(eq(latticeConnection.id, row.id));
}

/** Complete a callback backed by the new isolated authorization-attempt table. */
async function attemptCallbackStatus(input: {
  readonly attemptId: string;
  readonly connectionId: string;
  readonly ownerUserId: string;
  readonly state: string;
  readonly code: string | undefined;
  readonly error: string | undefined;
}): Promise<CallbackStatus> {
  const status = input.code
    ? await completeLatticeAuthorizationAttempt({
        attemptId: input.attemptId,
        ownerUserId: input.ownerUserId,
        connectionId: input.connectionId,
        authorizationCode: input.code,
        state: input.state,
      })
    : await rejectLatticeAuthorizationAttempt({
        attemptId: input.attemptId,
        ownerUserId: input.ownerUserId,
        connectionId: input.connectionId,
        state: input.state,
        declined: input.error === 'access_denied',
      });
  return status ?? 'error';
}

/** Complete a redirect started before isolated attempt rows were deployed. */
async function legacyCallbackStatus(input: {
  readonly connectionId: string;
  readonly ownerUserId: string;
  readonly code: string | undefined;
  readonly error: string | undefined;
}): Promise<CallbackStatus> {
  const [row] = await db
    .select()
    .from(latticeConnection)
    .where(eq(latticeConnection.id, input.connectionId))
    .limit(1);
  if (row?.ownerUserId !== input.ownerUserId) return 'error';

  if (!input.code) {
    const declined = input.error === 'access_denied';
    await markFailed(row, declined ? 'not_connected' : 'gateway_error');
    return declined ? 'declined' : 'error';
  }

  try {
    const pending = await loadStoredLatticeCredential(row.id, input.ownerUserId);
    if (pending?.kind === 'lattice_oauth') return 'connected';
    if (pending?.kind !== 'lattice_oauth_pending') {
      throw new Error('Lattice authorization is no longer active');
    }

    const approved = await completeLatticeAuthorization(latticeOAuthConfig(), {
      authorizationCode: input.code,
      credential: pending,
    });
    if (missingLatticeScopes(approved.scope).length > 0) {
      await markFailed(row, 'insufficient_scopes');
      return 'scopes';
    }

    await storeLatticeCredential(row.id, input.ownerUserId, approved);
    await db
      .update(latticeConnection)
      .set({
        status: 'connected',
        grantedScope: approved.scope,
        lastFailureReason: null,
        lastFailureAt: null,
        lastVerifiedAt: new Date(),
      })
      .where(eq(latticeConnection.id, row.id));
    return 'connected';
  } catch {
    await markFailed(row, 'gateway_error');
    return 'error';
  }
}

/** The Lovelace OAuth callback edge. */
const latticeOAuth = new Hono().get('/callback', async (c) => {
  const state = c.req.query('state');
  const decoded = state ? verifyConnectState(state) : null;
  const connectionId = decoded?.['connectionId'];
  const ownerUserId = decoded?.['ownerUserId'];
  if (
    typeof state !== 'string' ||
    decoded?.['scope'] !== 'lattice' ||
    typeof connectionId !== 'string' ||
    typeof ownerUserId !== 'string'
  ) {
    // An unsigned, expired or foreign state is the one case with no row to record against.
    return c.redirect(settingsRedirect('error'));
  }

  const attemptId = decoded['attemptId'];
  if (typeof attemptId === 'string') {
    const status = await attemptCallbackStatus({
      attemptId,
      ownerUserId,
      connectionId,
      state,
      code: c.req.query('code'),
      error: c.req.query('error'),
    });
    return c.redirect(settingsRedirect(status));
  }

  // Compatibility for an authorization started by the previous deployment, where the PKCE
  // verifier was temporarily stored in `lattice_credential` and state had no attempt id.
  const status = await legacyCallbackStatus({
    connectionId,
    ownerUserId,
    code: c.req.query('code'),
    error: c.req.query('error'),
  });
  return c.redirect(settingsRedirect(status));
});

export default latticeOAuth;
