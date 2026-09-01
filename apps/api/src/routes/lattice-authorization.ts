/**
 * `@docket/api` — short-lived Lovelace authorization attempts and their one shared completion.
 *
 * @remarks
 * Attempts own the PKCE verifier while a browser ceremony is in flight. The active
 * `lattice_credential` is replaced only after a code has been exchanged and its scopes verified,
 * so a dismissed or failed relink cannot break an existing Lattice connection.
 */
import { createHash } from 'node:crypto';

import {
  db,
  genId,
  latticeAuthorizationAttempt,
  latticeConnection,
  latticeCredential,
} from '@docket/db';
import {
  LATTICE_SCOPE_PARAM,
  LOVELACE_FEDCM_CONFIG_PATH,
  beginLatticeAuthorization,
  completeLatticeAuthorization,
  missingLatticeScopes,
  parseLatticeCredential,
  type LatticeCredentialRecord,
} from '@docket/integrations';
import { and, eq, gt } from 'drizzle-orm';

import { sealCredential, unsealCredential } from '../lib/credentials';
import { signConnectState } from '../lib/oauth-state';
import { latticeOAuthConfig } from './lattice-connection';

/** Lifetime shared with the signed OAuth state envelope. */
const AUTHORIZATION_ATTEMPT_TTL_MS = 10 * 60 * 1000;

/** Coarse application-owned result safe to return to Settings. */
export type LatticeAuthorizationResult = 'connected' | 'declined' | 'error' | 'scopes';

/** Browser-safe inputs for one redirect or active FedCM ceremony. */
export interface StartedLatticeAuthorization {
  readonly attemptId: string;
  readonly expiresAt: string;
  readonly authorizationUrl: string;
  readonly fedcm: {
    readonly configUrl: string;
    readonly clientId: string;
    readonly params: {
      readonly purpose: 'oauth_authorization';
      readonly redirect_uri: string;
      readonly scope: string;
      readonly state: string;
      readonly code_challenge: string;
      readonly code_challenge_method: 'S256';
    };
  };
}

/** One attempt row after its owner binding has been checked. */
type AttemptRow = typeof latticeAuthorizationAttempt.$inferSelect;

/** Hash an OAuth state value without retaining the browser-visible envelope. */
function stateHash(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

/** Convert an already-terminal attempt into its idempotent public outcome. */
function terminalResult(attempt: AttemptRow): LatticeAuthorizationResult | null {
  switch (attempt.status) {
    case 'completed':
      return 'connected';
    case 'declined':
      return 'declined';
    case 'failed':
      return attempt.failureReason === 'insufficient_scopes' ? 'scopes' : 'error';
    case 'exchanging':
      return 'error';
    case 'pending':
      return null;
  }
}

/** Load an attempt without ever crossing its Better Auth owner boundary. */
async function loadAttempt(attemptId: string, ownerUserId: string): Promise<AttemptRow | null> {
  const [attempt] = await db
    .select()
    .from(latticeAuthorizationAttempt)
    .where(
      and(
        eq(latticeAuthorizationAttempt.id, attemptId),
        eq(latticeAuthorizationAttempt.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  return attempt ?? null;
}

/** Mark a claimed or expired attempt terminal without touching the active connection. */
async function failAttempt(
  attemptId: string,
  status: 'declined' | 'failed',
  failureReason: string,
): Promise<void> {
  await db
    .update(latticeAuthorizationAttempt)
    .set({ status, failureReason, consumedAt: new Date() })
    .where(eq(latticeAuthorizationAttempt.id, attemptId));
}

/**
 * Create an owner-bound attempt and return only its public browser inputs.
 *
 * @param connectionId - The owner's durable Lattice connection identity.
 * @param ownerUserId - Authenticated Better Auth owner.
 * @returns Redirect and FedCM representations of the same OAuth request.
 */
export async function startLatticeAuthorizationAttempt(
  connectionId: string,
  ownerUserId: string,
): Promise<StartedLatticeAuthorization> {
  const attemptId = genId();
  const state = signConnectState({
    scope: 'lattice',
    attemptId,
    connectionId,
    ownerUserId,
  });
  const config = latticeOAuthConfig();
  const begun = beginLatticeAuthorization(config, state);
  const expiresAt = new Date(Date.now() + AUTHORIZATION_ATTEMPT_TTL_MS);
  await db.insert(latticeAuthorizationAttempt).values({
    id: attemptId,
    connectionId,
    ownerUserId,
    stateHash: stateHash(state),
    verifierCiphertext: sealCredential(JSON.stringify(begun.credential)),
    redirectUri: config.redirectUri,
    scope: LATTICE_SCOPE_PARAM,
    codeChallenge: begun.codeChallenge,
    expiresAt,
  });

  const issuer = (config.issuer ?? '').replace(/\/+$/, '');
  return {
    attemptId,
    expiresAt: expiresAt.toISOString(),
    authorizationUrl: begun.authorizationUrl,
    fedcm: {
      configUrl: `${issuer}${LOVELACE_FEDCM_CONFIG_PATH}`,
      clientId: config.clientId,
      params: {
        purpose: 'oauth_authorization',
        redirect_uri: config.redirectUri,
        scope: LATTICE_SCOPE_PARAM,
        state,
        code_challenge: begun.codeChallenge,
        code_challenge_method: 'S256',
      },
    },
  };
}

/** Inputs shared by the authenticated FedCM completion and signed redirect callback. */
export interface CompleteLatticeAuthorizationAttemptInput {
  readonly attemptId: string;
  readonly ownerUserId: string;
  readonly authorizationCode: string;
  /** Signed state is supplied by the redirect transport and checked against the stored hash. */
  readonly state?: string;
  /** Connection id decoded from redirect state; absent for the authenticated FedCM transport. */
  readonly connectionId?: string;
}

/** Whether a loaded attempt matches every binding supplied by its transport. */
function attemptMatches(
  attempt: AttemptRow | null,
  input: Pick<CompleteLatticeAuthorizationAttemptInput, 'state' | 'connectionId'>,
): attempt is AttemptRow {
  return (
    attempt !== null &&
    (input.state === undefined || attempt.stateHash === stateHash(input.state)) &&
    (input.connectionId === undefined || attempt.connectionId === input.connectionId)
  );
}

type AttemptClaim =
  | { readonly kind: 'claimed'; readonly attempt: AttemptRow }
  | { readonly kind: 'result'; readonly result: LatticeAuthorizationResult | null };

/** Atomically move one live pending attempt into its one-use exchange state. */
async function claimAttempt(
  input: CompleteLatticeAuthorizationAttemptInput,
): Promise<AttemptClaim> {
  const existing = await loadAttempt(input.attemptId, input.ownerUserId);
  if (!attemptMatches(existing, input)) return { kind: 'result', result: null };
  const prior = terminalResult(existing);
  if (prior !== null) return { kind: 'result', result: prior };

  const now = new Date();
  const [claimed] = await db
    .update(latticeAuthorizationAttempt)
    .set({ status: 'exchanging', consumedAt: now })
    .where(
      and(
        eq(latticeAuthorizationAttempt.id, existing.id),
        eq(latticeAuthorizationAttempt.ownerUserId, input.ownerUserId),
        eq(latticeAuthorizationAttempt.status, 'pending'),
        gt(latticeAuthorizationAttempt.expiresAt, now),
      ),
    )
    .returning();
  if (claimed) return { kind: 'claimed', attempt: claimed };

  const current = await loadAttempt(input.attemptId, input.ownerUserId);
  if (!current) return { kind: 'result', result: null };
  const result = terminalResult(current);
  if (result !== null) return { kind: 'result', result };
  await failAttempt(existing.id, 'failed', 'authorization_expired');
  return { kind: 'result', result: 'error' };
}

/** Atomically install an approved grant and close its claimed attempt. */
async function installApprovedCredential(
  attempt: AttemptRow,
  approved: LatticeCredentialRecord,
): Promise<void> {
  const ciphertext = sealCredential(JSON.stringify(approved));
  await db.transaction(async (tx) => {
    await tx
      .insert(latticeCredential)
      .values({
        connectionId: attempt.connectionId,
        ownerUserId: attempt.ownerUserId,
        ciphertext,
      })
      .onConflictDoUpdate({
        target: latticeCredential.connectionId,
        set: { ciphertext },
      });
    await tx
      .update(latticeConnection)
      .set({
        status: 'connected',
        grantedScope: approved.scope,
        lastFailureReason: null,
        lastFailureAt: null,
        lastVerifiedAt: new Date(),
      })
      .where(
        and(
          eq(latticeConnection.id, attempt.connectionId),
          eq(latticeConnection.ownerUserId, attempt.ownerUserId),
        ),
      );
    await tx
      .update(latticeAuthorizationAttempt)
      .set({ status: 'completed', failureReason: null })
      .where(eq(latticeAuthorizationAttempt.id, attempt.id));
  });
}

/**
 * Claim, exchange, validate, and install one authorization attempt.
 *
 * @param input - Owner-bound attempt and one-time Lovelace authorization code.
 * @returns A coarse result, or `null` when the attempt does not belong to this owner/state.
 */
export async function completeLatticeAuthorizationAttempt(
  input: CompleteLatticeAuthorizationAttemptInput,
): Promise<LatticeAuthorizationResult | null> {
  const claim = await claimAttempt(input);
  if (claim.kind === 'result') return claim.result;
  const claimed = claim.attempt;

  try {
    const pending = parseLatticeCredential(unsealCredential(claimed.verifierCiphertext));
    if (pending?.kind !== 'lattice_oauth_pending') {
      throw new Error('Lattice authorization attempt has no PKCE verifier');
    }
    const approved = await completeLatticeAuthorization(latticeOAuthConfig(), {
      authorizationCode: input.authorizationCode,
      credential: pending,
    });
    if (missingLatticeScopes(approved.scope).length > 0) {
      await failAttempt(claimed.id, 'failed', 'insufficient_scopes');
      return 'scopes';
    }

    await installApprovedCredential(claimed, approved);
    return 'connected';
  } catch {
    await failAttempt(claimed.id, 'failed', 'gateway_error');
    return 'error';
  }
}

/**
 * Consume an explicit denial without modifying any active grant.
 *
 * @param input - Owner/state binding decoded from the redirect callback.
 * @returns Coarse outcome, or `null` for a foreign attempt.
 */
export async function rejectLatticeAuthorizationAttempt(input: {
  readonly attemptId: string;
  readonly ownerUserId: string;
  readonly state: string;
  readonly connectionId: string;
  readonly declined: boolean;
}): Promise<LatticeAuthorizationResult | null> {
  const attempt = await loadAttempt(input.attemptId, input.ownerUserId);
  if (
    attempt?.connectionId !== input.connectionId ||
    attempt.stateHash !== stateHash(input.state)
  ) {
    return null;
  }
  const prior = terminalResult(attempt);
  if (prior !== null) return prior;
  await failAttempt(
    attempt.id,
    input.declined ? 'declined' : 'failed',
    input.declined ? 'not_connected' : 'gateway_error',
  );
  return input.declined ? 'declined' : 'error';
}
