/**
 * Authentication routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import { eq, desc, and, ne, gt } from 'drizzle-orm';
import {
  SessionIdParamSchema,
  AccountIdParamSchema,
  PasskeyIdParamSchema,
  VerifyBackupCodeRequestSchema,
  UpdatePasskeyRequestSchema,
  BackupCodesInfoResponseSchema,
  GenerateBackupCodesResponseSchema,
  VerifyBackupCodeResponseSchema,
  SessionsResponseSchema,
  LinkedAccountsResponseSchema,
  PasskeysResponseSchema,
  UpdatePasskeyResponseSchema,
} from '@athena/types/openapi/auth';
import {
  ErrorResponseSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { auth } from '../lib/auth.js';
import { db } from '../db/index.js';
import { sessions, accounts, verifications, passkeys } from '../db/schema/auth.js';
import { requireAuth, getUserId, getSessionToken } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import {
  generateBackupCodes,
  verifyBackupCode,
  getBackupCodesInfo,
} from '../services/backup-codes.js';
import { buildSessionsResponse, toBackupCodesInfo, toLinkedAccount, toPasskey } from './auth/serializers.js';
import { generateRecoveryToken } from './auth/helpers.js';

const authRoutes = createOpenAPIApp();
const authMiddleware = [requireAuth];

// =============================================================================
// Backup Codes
// =============================================================================

const getBackupCodesStatus = createRoute({
  method: 'get',
  path: '/backup-codes',
  tags: ['Auth'],
  summary: 'Get backup codes status',
  description: 'Get information about backup codes for the current user.',
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Backup codes status retrieved',
      content: {
        'application/json': {
          schema: BackupCodesInfoResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const generateBackupCodesRoute = createRoute({
  method: 'post',
  path: '/backup-codes/generate',
  tags: ['Auth'],
  summary: 'Generate backup codes',
  description: 'Generate new backup codes. This invalidates any existing codes.',
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Backup codes generated',
      content: {
        'application/json': {
          schema: GenerateBackupCodesResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const verifyBackupCodeRoute = createRoute({
  method: 'post',
  path: '/backup-codes/verify',
  tags: ['Auth'],
  summary: 'Verify backup code',
  description: 'Verify a backup code for account recovery. Does not require authentication.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: VerifyBackupCodeRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Backup code verified',
      content: {
        'application/json': {
          schema: VerifyBackupCodeResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid backup code',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Sessions
// =============================================================================

const getSessions = createRoute({
  method: 'get',
  path: '/sessions',
  tags: ['Auth'],
  summary: 'Get active sessions',
  description: 'Get all active sessions for the current user.',
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Sessions retrieved',
      content: {
        'application/json': {
          schema: SessionsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const revokeSession = createRoute({
  method: 'delete',
  path: '/sessions/{sessionId}',
  tags: ['Auth'],
  summary: 'Revoke session',
  description: 'Revoke a specific session.',
  middleware: authMiddleware,
  request: {
    params: SessionIdParamSchema,
  },
  responses: {
    204: {
      description: 'Session revoked successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    403: {
      description: 'Unauthorized access',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const revokeAllSessions = createRoute({
  method: 'delete',
  path: '/sessions',
  tags: ['Auth'],
  summary: 'Revoke all sessions',
  description: 'Revoke all sessions except the current one.',
  middleware: authMiddleware,
  responses: {
    204: {
      description: 'All sessions revoked',
    },
    400: {
      description: 'No current session found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Linked Accounts
// =============================================================================

const getLinkedAccounts = createRoute({
  method: 'get',
  path: '/linked-accounts',
  tags: ['Auth'],
  summary: 'Get linked accounts',
  description: 'Get all linked OAuth accounts.',
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Linked accounts retrieved',
      content: {
        'application/json': {
          schema: LinkedAccountsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const unlinkAccount = createRoute({
  method: 'delete',
  path: '/linked-accounts/{accountId}',
  tags: ['Auth'],
  summary: 'Unlink account',
  description: 'Unlink an OAuth account.',
  middleware: authMiddleware,
  request: {
    params: AccountIdParamSchema,
  },
  responses: {
    204: {
      description: 'Account unlinked successfully',
    },
    400: {
      description: 'Cannot unlink last authentication method',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    403: {
      description: 'Access forbidden',
      content: {
        'application/json': {
          schema: ForbiddenErrorSchema,
        },
      },
    },
    404: {
      description: 'Linked account not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Passkeys
// =============================================================================

const getPasskeys = createRoute({
  method: 'get',
  path: '/passkeys',
  tags: ['Auth'],
  summary: 'Get passkeys',
  description: 'Get all registered passkeys.',
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Passkeys retrieved',
      content: {
        'application/json': {
          schema: PasskeysResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const updatePasskey = createRoute({
  method: 'patch',
  path: '/passkeys/{passkeyId}',
  tags: ['Auth'],
  summary: 'Update passkey',
  description: 'Update passkey display name.',
  middleware: authMiddleware,
  request: {
    params: PasskeyIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdatePasskeyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Passkey updated',
      content: {
        'application/json': {
          schema: UpdatePasskeyResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    403: {
      description: 'Access forbidden',
      content: {
        'application/json': {
          schema: ForbiddenErrorSchema,
        },
      },
    },
    404: {
      description: 'Passkey not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

const deletePasskey = createRoute({
  method: 'delete',
  path: '/passkeys/{passkeyId}',
  tags: ['Auth'],
  summary: 'Delete passkey',
  description: 'Delete a registered passkey.',
  middleware: authMiddleware,
  request: {
    params: PasskeyIdParamSchema,
  },
  responses: {
    204: {
      description: 'Passkey deleted successfully',
    },
    400: {
      description: 'Cannot delete last authentication method',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    403: {
      description: 'Access forbidden',
      content: {
        'application/json': {
          schema: ForbiddenErrorSchema,
        },
      },
    },
    404: {
      description: 'Passkey not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Backup Codes Routes
// =============================================================================

authRoutes.openapi(generateBackupCodesRoute, async (c) => {
  const userId = getUserId(c);
  const codes = await generateBackupCodes(userId);

  return c.json(
    {
      codes,
      message: 'Store these codes safely. They will only be shown once.',
      count: codes.length,
    },
    200,
  );
});

authRoutes.openapi(getBackupCodesStatus, async (c) => {
  const userId = getUserId(c);
  const info = await getBackupCodesInfo(userId);

  return c.json(toBackupCodesInfo(info), 200);
});

/**
 * Verify a backup code for account recovery.
 * POST /api/auth/backup-codes/verify
 */
authRoutes.openapi(verifyBackupCodeRoute, async (c) => {
  const { email, code } = c.req.valid('json');

  // Find user by email
  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.email, email),
  });

  if (!user) {
    // Don't reveal if user exists
    return c.json(
      {
        error: 'Validation error' as const,
        details: [{ field: 'emailOrCode', message: 'Invalid email or backup code' }],
      },
      400,
    );
  }

  const isValid = await verifyBackupCode(user.id, code);

  if (!isValid) {
    return c.json(
      {
        error: 'Validation error' as const,
        details: [{ field: 'emailOrCode', message: 'Invalid email or backup code' }],
      },
      400,
    );
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

  return c.json(
    {
      success: true as const,
      message: 'Backup code verified. You can now reset your password.',
      recoveryToken: token,
      expiresAt,
    },
    200,
  );
});

// ============================================================================
// Session Management Routes
// ============================================================================

/**
 * Get all active sessions for the user.
 * GET /api/auth/sessions
 */
authRoutes.openapi(getSessions, async (c) => {
  const userId = getUserId(c);

  // Get current session token from request
  const currentSessionToken = getSessionToken(c);

  // Query only non-expired sessions
  const userSessions = await db
    .select({
      id: sessions.id,
      token: sessions.token,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      lastActiveAt: sessions.lastActiveAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastActiveAt));

  const { sessions: sessionList, count } = buildSessionsResponse(
    userSessions,
    currentSessionToken,
  );

  return c.json({ sessions: sessionList, count }, 200);
});

/**
 * Revoke a specific session.
 * DELETE /api/auth/sessions/:sessionId
 */
authRoutes.openapi(revokeSession, async (c) => {
  const userId = getUserId(c);
  const { sessionId } = c.req.valid('param');

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
 * DELETE /api/auth/sessions
 *
 * RESTful semantics: DELETE on the collection removes all items.
 * The current session is automatically excluded (you can't delete the session making the request).
 */
authRoutes.openapi(revokeAllSessions, async (c) => {
  const userId = getUserId(c);
  const currentSessionToken = getSessionToken(c);

  if (!currentSessionToken) {
    return c.json({ error: 'No current session found' }, 400);
  }

  // Delete all sessions for this user EXCEPT the current one
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.token, currentSessionToken)));

  return c.body(null, 204);
});

// ============================================================================
// Linked Accounts Routes
// ============================================================================

/**
 * Get all linked OAuth accounts.
 * GET /api/auth/linked-accounts
 */
authRoutes.openapi(getLinkedAccounts, async (c) => {
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

  const accountsResponse = linkedAccounts.map(toLinkedAccount);
  return c.json({ accounts: accountsResponse, count: accountsResponse.length }, 200);
});

/**
 * Unlink an OAuth account.
 * DELETE /api/auth/linked-accounts/:accountId
 */
authRoutes.openapi(unlinkAccount, async (c) => {
  const userId = getUserId(c);
  const { accountId } = c.req.valid('param');

  // Verify account belongs to user
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);

  if (!account) {
    return c.json({ error: 'Not found', message: 'Account not found' }, 404);
  }

  if (account.userId !== userId) {
    return c.json({ error: 'Forbidden', message: 'Account does not belong to user' }, 403);
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
// Passkey Management Routes
// ============================================================================

/**
 * Get all registered passkeys for the user.
 * GET /api/auth/passkeys
 */
authRoutes.openapi(getPasskeys, async (c) => {
  const userId = getUserId(c);

  const userPasskeys = await db
    .select({
      id: passkeys.id,
      name: passkeys.name,
      deviceType: passkeys.deviceType,
      backedUp: passkeys.backedUp,
      createdAt: passkeys.createdAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(desc(passkeys.createdAt));

  const passkeysResponse = userPasskeys.map(toPasskey);
  return c.json({ passkeys: passkeysResponse, count: passkeysResponse.length }, 200);
});

/**
 * Update a passkey (rename).
 * PATCH /api/auth/passkeys/:passkeyId
 */
authRoutes.openapi(updatePasskey, async (c) => {
  const userId = getUserId(c);
  const { passkeyId } = c.req.valid('param');
  const body = c.req.valid('json');

  // Verify passkey belongs to user
  const [passkey] = await db.select().from(passkeys).where(eq(passkeys.id, passkeyId)).limit(1);

  if (!passkey) {
    return c.json({ error: 'Not found', message: 'Passkey not found' }, 404);
  }

  if (passkey.userId !== userId) {
    return c.json({ error: 'Forbidden', message: 'Passkey does not belong to user' }, 403);
  }

  // Update the passkey name
  await db.update(passkeys).set({ name: body.name }).where(eq(passkeys.id, passkeyId));

  return c.json({ success: true as const, name: body.name }, 200);
});

/**
 * Delete a passkey.
 * DELETE /api/auth/passkeys/:passkeyId
 */
authRoutes.openapi(deletePasskey, async (c) => {
  const userId = getUserId(c);
  const { passkeyId } = c.req.valid('param');

  // Verify passkey belongs to user
  const [passkey] = await db.select().from(passkeys).where(eq(passkeys.id, passkeyId)).limit(1);

  if (!passkey) {
    return c.json({ error: 'Not found', message: 'Passkey not found' }, 404);
  }

  if (passkey.userId !== userId) {
    return c.json({ error: 'Forbidden', message: 'Passkey does not belong to user' }, 403);
  }

  // Check if user has other sign-in methods before deleting last passkey
  const allPasskeys = await db.select().from(passkeys).where(eq(passkeys.userId, userId));
  const linkedAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));

  if (allPasskeys.length <= 1 && linkedAccounts.length === 0) {
    return c.json(
      {
        error: 'Cannot delete last passkey',
        message: 'You must have at least one sign-in method. Link an OAuth account first.',
      },
      400,
    );
  }

  // Delete the passkey
  await db.delete(passkeys).where(eq(passkeys.id, passkeyId));

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
