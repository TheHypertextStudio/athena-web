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

/** The Lovelace OAuth callback edge. */
const latticeOAuth = new Hono().get('/callback', async (c) => {
  const state = c.req.query('state');
  const decoded = state ? verifyConnectState(state) : null;
  const connectionId = decoded?.['connectionId'];
  const ownerUserId = decoded?.['ownerUserId'];
  if (
    decoded?.['scope'] !== 'lattice' ||
    typeof connectionId !== 'string' ||
    typeof ownerUserId !== 'string'
  ) {
    // An unsigned, expired or foreign state is the one case with no row to record against.
    return c.redirect(settingsRedirect('error'));
  }

  const [row] = await db
    .select()
    .from(latticeConnection)
    .where(eq(latticeConnection.id, connectionId))
    .limit(1);
  if (row?.ownerUserId !== ownerUserId) {
    return c.redirect(settingsRedirect('error'));
  }

  const code = c.req.query('code');
  if (!code) {
    // Lovelace sends `error=access_denied` when someone declines. That is a choice, not a fault,
    // so it gets its own outcome and its own copy.
    const declined = c.req.query('error') === 'access_denied';
    await markFailed(row, declined ? 'not_connected' : 'gateway_error');
    return c.redirect(settingsRedirect(declined ? 'declined' : 'error'));
  }

  try {
    const pending = await loadStoredLatticeCredential(row.id, ownerUserId);
    // An already-approved credential here means no new `/authorize` has run since this connection
    // last completed: this is a replay (a back-button resubmit), not a new attempt. Redirect
    // idempotently rather than re-exchanging a consumed code and flipping a healthy connection to
    // error.
    if (pending?.kind === 'lattice_oauth') {
      return c.redirect(settingsRedirect('connected'));
    }
    if (pending?.kind !== 'lattice_oauth_pending') {
      throw new Error('Lattice authorization is no longer active');
    }

    const approved = await completeLatticeAuthorization(latticeOAuthConfig(), {
      authorizationCode: code,
      credential: pending,
    });

    // A narrowed grant is caught here rather than at the first turn, where it would surface as a
    // confusing mid-conversation failure.
    const missing = missingLatticeScopes(approved.scope);
    if (missing.length > 0) {
      await markFailed(row, 'insufficient_scopes');
      return c.redirect(settingsRedirect('scopes'));
    }

    await storeLatticeCredential(row.id, ownerUserId, approved);
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
    return c.redirect(settingsRedirect('connected'));
  } catch {
    // The thrown value is issuer or transport text. It is deliberately not read, not logged into
    // the row, and not put on the redirect: the row records a stable code and nothing else.
    await markFailed(row, 'gateway_error');
    return c.redirect(settingsRedirect('error'));
  }
});

export default latticeOAuth;
