/**
 * RISC (Cross-Account Protection) Service
 *
 * Handles Google's Cross-Account Protection security events.
 * See: https://developers.google.com/identity/protocols/risc
 *
 * @packageDocumentation
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { db } from '../../db/index.js';
import { accounts, sessions, users } from '../../db/schema/auth.js';
import { eq, and } from 'drizzle-orm';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import {
  RISC_EVENT_TYPES,
  type RISCTokenPayload,
  type RISCSubject,
  type RISCProcessingResult,
  type ResolvedUser,
  type TokenSubject,
} from './types.js';

// =============================================================================
// Configuration
// =============================================================================

const RISC_CONFIG_URL = 'https://accounts.google.com/.well-known/risc-configuration';

// Cache for RISC configuration
let riscConfigCache: {
  issuer: string;
  jwks_uri: string;
  cachedAt: number;
} | null = null;

const CONFIG_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Set of processed event IDs for deduplication (in-memory, consider Redis for production)
const processedEvents = new Set<string>();
const PROCESSED_EVENTS_MAX_SIZE = 10000;

// =============================================================================
// Configuration Fetching
// =============================================================================

/**
 * Fetch RISC configuration from Google.
 */
async function getRISCConfig() {
  const now = Date.now();

  if (riscConfigCache && now - riscConfigCache.cachedAt < CONFIG_CACHE_TTL) {
    return riscConfigCache;
  }

  const response = await fetch(RISC_CONFIG_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch RISC configuration: ${String(response.status)}`);
  }

  const config = (await response.json()) as { issuer: string; jwks_uri: string };
  riscConfigCache = {
    issuer: config.issuer,
    jwks_uri: config.jwks_uri,
    cachedAt: now,
  };

  return riscConfigCache;
}

// =============================================================================
// Token Validation
// =============================================================================

/**
 * Validate a RISC security event token.
 *
 * @param token - The JWT token from Google
 * @returns Decoded token payload if valid
 * @throws Error if validation fails
 */
export async function validateRISCToken(token: string): Promise<RISCTokenPayload> {
  const config = await getRISCConfig();

  // Create JWKS fetcher from Google's keys endpoint
  const JWKS = createRemoteJWKSet(new URL(config.jwks_uri));

  // Get Google OAuth client ID for audience validation
  const clientId = env.googleOAuth?.clientId;
  if (!clientId) {
    throw new Error('Google OAuth client ID not configured');
  }

  // Verify the token
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: config.issuer,
    audience: clientId,
    // Security events don't have expiration - they're historical
    clockTolerance: Infinity,
  });

  return payload as RISCTokenPayload;
}

// =============================================================================
// Event Deduplication
// =============================================================================

/**
 * Check if an event has already been processed (deduplication).
 */
function isEventProcessed(jti: string): boolean {
  return processedEvents.has(jti);
}

/**
 * Mark an event as processed.
 */
function markEventProcessed(jti: string): void {
  // Prevent unbounded growth
  if (processedEvents.size >= PROCESSED_EVENTS_MAX_SIZE) {
    const firstKey = processedEvents.values().next().value;
    if (firstKey) {
      processedEvents.delete(firstKey);
    }
  }
  processedEvents.add(jti);
}

// =============================================================================
// Subject Resolution
// =============================================================================

/**
 * Find user by Google account ID.
 */
async function findUserByGoogleId(googleAccountId: string): Promise<ResolvedUser | null> {
  const [account] = await db
    .select({
      userId: accounts.userId,
      userEmail: users.email,
    })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(and(eq(accounts.providerId, 'google'), eq(accounts.accountId, googleAccountId)))
    .limit(1);

  return account ?? null;
}

/**
 * Find user by email address.
 */
async function findUserByEmail(email: string): Promise<ResolvedUser | null> {
  const [user] = await db
    .select({
      userId: users.id,
      userEmail: users.email,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return user ?? null;
}

/**
 * Resolve a RISC subject to a user.
 * Supports iss-sub, id_token_claims, and token subject types.
 */
async function findUserBySubject(subject: RISCSubject): Promise<ResolvedUser | null> {
  switch (subject.subject_type) {
    case 'iss-sub':
      // Most common - lookup by Google account ID (the 'sub' claim)
      return findUserByGoogleId(subject.sub);

    case 'id_token_claims':
      // Lookup by email from ID token claims
      return findUserByEmail(subject.email);

    case 'token':
      // Token subjects require hash lookup
      // Currently not implemented - would need to store token hashes
      logger.warn(
        { subjectType: 'token', tokenIdentifierAlg: subject.token_identifier_alg },
        '[RISC] Token subject lookup not implemented',
      );
      return null;

    default:
      logger.warn({ subject }, '[RISC] Unknown subject type');
      return null;
  }
}

// =============================================================================
// Session and Account Management
// =============================================================================

/**
 * Revoke all sessions for a user.
 */
async function revokeUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
  logger.info({ userId }, '[RISC] Revoked all sessions');
}

/**
 * Clear OAuth tokens for a user's Google account.
 */
async function clearGoogleOAuthTokens(userId: string): Promise<void> {
  await db
    .update(accounts)
    .set({
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      tokensRevokedAt: new Date(),
    })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'google')));

  logger.info({ userId }, '[RISC] Cleared Google OAuth tokens');
}

/**
 * Disable Google sign-in for a user.
 */
async function disableGoogleSignIn(userId: string): Promise<void> {
  await db
    .update(accounts)
    .set({ googleSignInDisabled: true })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'google')));

  logger.info({ userId }, '[RISC] Disabled Google sign-in');
}

/**
 * Enable Google sign-in for a user.
 */
async function enableGoogleSignIn(userId: string): Promise<void> {
  await db
    .update(accounts)
    .set({ googleSignInDisabled: false })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'google')));

  logger.info({ userId }, '[RISC] Enabled Google sign-in');
}

/**
 * Flag account for credential change requirement.
 */
async function flagCredentialChangeRequired(userId: string): Promise<void> {
  await db
    .update(accounts)
    .set({ credentialChangeRequired: true })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'google')));

  await db.update(users).set({ securityAlertAt: new Date() }).where(eq(users.id, userId));

  logger.info({ userId }, '[RISC] Flagged credential change required');
}

// =============================================================================
// Event Handlers
// =============================================================================

/**
 * Handle sessions-revoked event.
 * Google is telling us to terminate all the user's sessions.
 */
async function handleSessionsRevoked(subject: RISCSubject): Promise<void> {
  const user = await findUserBySubject(subject);
  if (user) {
    await revokeUserSessions(user.userId);
  }
}

/**
 * Handle tokens-revoked event (RISC namespace).
 * The user revoked our access; terminate sessions and clear tokens.
 */
async function handleTokensRevoked(subject: RISCSubject): Promise<void> {
  const user = await findUserBySubject(subject);
  if (user) {
    await clearGoogleOAuthTokens(user.userId);
    await revokeUserSessions(user.userId);
  }
}

/**
 * Handle OAuth tokens-revoked event (OAuth namespace).
 * All OAuth tokens for our client have been revoked.
 */
async function handleOAuthTokensRevoked(subject: RISCSubject): Promise<void> {
  const user = await findUserBySubject(subject);
  if (user) {
    await clearGoogleOAuthTokens(user.userId);
    await revokeUserSessions(user.userId);
  }
}

/**
 * Handle OAuth token-revoked event (single token).
 * A specific OAuth token has been revoked.
 */
function handleOAuthTokenRevoked(subject: TokenSubject): void {
  // For single token revocation, we would need to:
  // 1. Store token hashes when tokens are issued
  // 2. Look up which user owns the revoked token
  // 3. Clear just that specific token
  //
  // Currently not implemented - would need schema changes to store token hashes.
  // For now, log the event for monitoring.
  logger.warn(
    {
      tokenType: subject.token_type,
      tokenIdentifierAlg: subject.token_identifier_alg,
    },
    '[RISC] Single token-revoked event received but token lookup not implemented',
  );
}

/**
 * Handle account-disabled event.
 * The user's Google account was disabled (hijacking or ToS violation).
 */
async function handleAccountDisabled(subject: RISCSubject, reason?: string): Promise<void> {
  const user = await findUserBySubject(subject);
  if (user) {
    // Block Google sign-in (allow other auth methods like passkeys)
    await disableGoogleSignIn(user.userId);
    // Revoke all sessions for security
    await revokeUserSessions(user.userId);

    logger.info({ userId: user.userId, reason }, '[RISC] Account disabled');
  }
}

/**
 * Handle account-enabled event.
 * The user's Google account was re-enabled.
 */
async function handleAccountEnabled(subject: RISCSubject): Promise<void> {
  const user = await findUserBySubject(subject);
  if (user) {
    // Re-enable Google sign-in
    await enableGoogleSignIn(user.userId);

    logger.info({ userId: user.userId }, '[RISC] Account re-enabled');
  }
}

/**
 * Handle account-credential-change-required event.
 * Suspicious activity detected; monitor the account.
 */
async function handleCredentialChangeRequired(subject: RISCSubject): Promise<void> {
  const user = await findUserBySubject(subject);
  if (user) {
    // Flag for monitoring - could force password change or send security alert
    await flagCredentialChangeRequired(user.userId);

    logger.info({ userId: user.userId }, '[RISC] Credential change required flagged');
  }
}

/**
 * Handle verification event.
 * Used to test endpoint connectivity.
 */
function handleVerification(state?: string): void {
  logger.info({ state }, '[RISC] Verification event received');
}

// =============================================================================
// Event Processing
// =============================================================================

/**
 * Process a validated RISC security event.
 *
 * @param payload - Decoded JWT payload
 * @returns Processing result
 */
export async function processRISCEvent(payload: RISCTokenPayload): Promise<RISCProcessingResult> {
  const eventTypes: string[] = [];

  // Check for duplicate event
  if (payload.jti && isEventProcessed(payload.jti)) {
    logger.debug({ jti: payload.jti }, '[RISC] Duplicate event, skipping');
    return { success: true, eventTypes: [], duplicate: true };
  }

  // Process each event in the payload
  for (const [eventType, event] of Object.entries(payload.events)) {
    eventTypes.push(eventType);

    // Verification events don't require a subject
    if (eventType === RISC_EVENT_TYPES.VERIFICATION) {
      handleVerification(event.state ?? event.reason);
      continue;
    }

    // All other events require a subject
    if (!event.subject) {
      logger.warn({ eventType }, '[RISC] Event has no subject, skipping');
      continue;
    }

    try {
      switch (eventType) {
        // Standard RISC events
        case RISC_EVENT_TYPES.SESSIONS_REVOKED:
          await handleSessionsRevoked(event.subject);
          break;

        case RISC_EVENT_TYPES.TOKENS_REVOKED:
          await handleTokensRevoked(event.subject);
          break;

        case RISC_EVENT_TYPES.ACCOUNT_DISABLED:
          await handleAccountDisabled(event.subject, event.reason);
          break;

        case RISC_EVENT_TYPES.ACCOUNT_ENABLED:
          await handleAccountEnabled(event.subject);
          break;

        case RISC_EVENT_TYPES.CREDENTIAL_CHANGE_REQUIRED:
          await handleCredentialChangeRequired(event.subject);
          break;

        // OAuth security events
        case RISC_EVENT_TYPES.OAUTH_TOKENS_REVOKED:
          await handleOAuthTokensRevoked(event.subject);
          break;

        case RISC_EVENT_TYPES.OAUTH_TOKEN_REVOKED:
          // Single token revocation uses token subject type
          if (event.subject.subject_type === 'token') {
            handleOAuthTokenRevoked(event.subject);
          } else {
            logger.warn(
              { eventType, subjectType: event.subject.subject_type },
              '[RISC] token-revoked event with non-token subject type',
            );
          }
          break;

        default:
          logger.warn({ eventType }, '[RISC] Unknown event type');
      }
    } catch (error) {
      logger.error(
        { eventType, error: error instanceof Error ? error.message : 'Unknown error' },
        '[RISC] Error processing event',
      );
      throw error;
    }
  }

  // Mark event as processed for deduplication
  if (payload.jti) {
    markEventProcessed(payload.jti);
  }

  return { success: true, eventTypes };
}

// =============================================================================
// Exports
// =============================================================================

// Re-export types for convenience
export * from './types.js';

// Re-export stream management functions
export {
  initializeRISCStream,
  getStream,
  registerStream,
  updateStreamStatus,
  requestVerification,
  getStreamStatus,
} from './stream.js';
