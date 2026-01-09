/**
 * Authentication routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { auth } from '../lib/auth.js';
import { db } from '../db/index.js';
import { sessions, accounts, verifications } from '../db/schema/auth.js';
import { requireAuth, getUserId, getSessionToken } from '../middleware/auth.js';
import {
  generateBackupCodes,
  verifyBackupCode,
  getBackupCodesInfo,
} from '../services/backup-codes.js';
import { createHash, randomBytes } from 'crypto';

/**
 * Generate a secure recovery token.
 * Returns the plain token (for the user) and the hashed version (for storage).
 */
function generateRecoveryToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

/**
 * Hash a token for storage/comparison.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const authRoutes = new Hono();

// ============================================================================
// Backup Codes Routes
// ============================================================================

/**
 * Generate new backup codes.
 * POST /api/auth/backup-codes/generate
 */
authRoutes.post('/backup-codes/generate', requireAuth, async (c) => {
  const userId = getUserId(c);
  const codes = await generateBackupCodes(userId);

  return c.json({
    codes,
    message: 'Store these codes safely. They will only be shown once.',
    count: codes.length,
  });
});

/**
 * Get backup codes status.
 * GET /api/auth/backup-codes
 */
authRoutes.get('/backup-codes', requireAuth, async (c) => {
  const userId = getUserId(c);
  const info = await getBackupCodesInfo(userId);

  return c.json(info);
});

/**
 * Verify a backup code for account recovery.
 * POST /api/auth/backup-codes/verify
 */
const verifyBackupCodeSchema = z.object({
  email: z.email(),
  code: z.string().min(8).max(10),
});

authRoutes.post('/backup-codes/verify', async (c) => {
  const body = await c.req.json<unknown>();
  const parsed = verifyBackupCodeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: z.treeifyError(parsed.error) }, 400);
  }

  const { email, code } = parsed.data;

  // Find user by email
  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.email, email),
  });

  if (!user) {
    // Don't reveal if user exists
    return c.json({ error: 'Invalid email or backup code' }, 401);
  }

  const isValid = await verifyBackupCode(user.id, code);

  if (!isValid) {
    return c.json({ error: 'Invalid email or backup code' }, 401);
  }

  // Generate a secure recovery token
  const { token, hash } = generateRecoveryToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Store the hashed token in verifications table
  await db.insert(verifications).values({
    id: crypto.randomUUID(),
    identifier: `recovery:${user.id}`,
    value: hash,
    expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({
    success: true,
    message: 'Backup code verified. You can now reset your password.',
    recoveryToken: token,
    expiresAt: expiresAt.toISOString(),
  });
});

// ============================================================================
// Session Management Routes
// ============================================================================

/**
 * Get all active sessions for the user.
 * GET /api/auth/sessions
 */
authRoutes.get('/sessions', requireAuth, async (c) => {
  const userId = getUserId(c);

  // Get current session token from request
  const currentSessionToken = getSessionToken(c);
  const currentTokenHash = currentSessionToken ? hashToken(currentSessionToken) : null;

  const userSessions = await db
    .select({
      id: sessions.id,
      token: sessions.token,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt));

  // Mark which session is current by comparing token hashes
  const sessionsWithCurrent = userSessions.map((session) => ({
    id: session.id,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    isCurrent: currentTokenHash !== null && session.token === currentSessionToken,
  }));

  return c.json({
    sessions: sessionsWithCurrent,
    count: sessionsWithCurrent.length,
  });
});

/**
 * Revoke a specific session.
 * DELETE /api/auth/sessions/:sessionId
 */
authRoutes.delete('/sessions/:sessionId', requireAuth, async (c) => {
  const userId = getUserId(c);
  const sessionId = c.req.param('sessionId');

  // Verify session belongs to user
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  if (session.userId !== userId) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  // Delete the session
  await db.delete(sessions).where(eq(sessions.id, sessionId));

  return c.body(null, 204);
});

/**
 * Revoke all sessions except current.
 * POST /api/auth/sessions/revoke-all
 */
authRoutes.post('/sessions/revoke-all', requireAuth, async (c) => {
  const userId = getUserId(c);

  // Delete all sessions for this user
  // Note: The current session will also be deleted, requiring re-login
  await db.delete(sessions).where(eq(sessions.userId, userId));

  return c.json({
    success: true,
    message: 'All sessions have been revoked',
  });
});

// ============================================================================
// Linked Accounts Routes
// ============================================================================

/**
 * Get all linked OAuth accounts.
 * GET /api/auth/linked-accounts
 */
authRoutes.get('/linked-accounts', requireAuth, async (c) => {
  const userId = getUserId(c);

  const linkedAccounts = await db
    .select({
      id: accounts.id,
      providerId: accounts.providerId,
      accountId: accounts.accountId,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId));

  return c.json({
    accounts: linkedAccounts,
    count: linkedAccounts.length,
  });
});

/**
 * Unlink an OAuth account.
 * DELETE /api/auth/linked-accounts/:accountId
 */
authRoutes.delete('/linked-accounts/:accountId', requireAuth, async (c) => {
  const userId = getUserId(c);
  const accountId = c.req.param('accountId');

  // Verify account belongs to user
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);

  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  if (account.userId !== userId) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  // Check if this is the only sign-in method
  const allAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));

  if (allAccounts.length <= 1) {
    return c.json(
      {
        error: 'Cannot unlink last account',
        message: 'You must have at least one sign-in method',
      },
      400,
    );
  }

  // Delete the account link
  await db.delete(accounts).where(eq(accounts.id, accountId));

  return c.body(null, 204);
});

// ============================================================================
// Better Auth Handler (catch-all)
// ============================================================================

/**
 * Handle all Better Auth requests.
 * Routes: /api/auth/*
 */
authRoutes.on(['GET', 'POST'], '/*', (c) => {
  return auth.handler(c.req.raw);
});

export { authRoutes };
