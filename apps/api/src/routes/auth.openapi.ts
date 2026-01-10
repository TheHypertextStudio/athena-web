/**
 * Auth OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
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
  RevokeAllSessionsResponseSchema,
  UpdatePasskeyResponseSchema,
} from '@athena/types/openapi/auth';
import {
  ErrorResponseSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// Backup Codes
// =============================================================================

export const getBackupCodesStatus = createRoute({
  method: 'get',
  path: '/backup-codes',
  tags: ['Auth'],
  summary: 'Get backup codes status',
  description: 'Get information about backup codes for the current user.',
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

export const generateBackupCodes = createRoute({
  method: 'post',
  path: '/backup-codes/generate',
  tags: ['Auth'],
  summary: 'Generate backup codes',
  description: 'Generate new backup codes. This invalidates any existing codes.',
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

export const verifyBackupCode = createRoute({
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

export const getSessions = createRoute({
  method: 'get',
  path: '/sessions',
  tags: ['Auth'],
  summary: 'Get active sessions',
  description: 'Get all active sessions for the current user.',
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

export const revokeSession = createRoute({
  method: 'delete',
  path: '/sessions/{sessionId}',
  tags: ['Auth'],
  summary: 'Revoke session',
  description: 'Revoke a specific session.',
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
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

export const revokeAllSessions = createRoute({
  method: 'post',
  path: '/sessions/revoke-all',
  tags: ['Auth'],
  summary: 'Revoke all sessions',
  description: 'Revoke all sessions except the current one.',
  responses: {
    200: {
      description: 'All sessions revoked',
      content: {
        'application/json': {
          schema: RevokeAllSessionsResponseSchema,
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

export const getLinkedAccounts = createRoute({
  method: 'get',
  path: '/linked-accounts',
  tags: ['Auth'],
  summary: 'Get linked accounts',
  description: 'Get all linked OAuth accounts.',
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

export const unlinkAccount = createRoute({
  method: 'delete',
  path: '/linked-accounts/{accountId}',
  tags: ['Auth'],
  summary: 'Unlink account',
  description: 'Unlink an OAuth account.',
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

export const getPasskeys = createRoute({
  method: 'get',
  path: '/passkeys',
  tags: ['Auth'],
  summary: 'Get passkeys',
  description: 'Get all registered passkeys.',
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

export const updatePasskey = createRoute({
  method: 'patch',
  path: '/passkeys/{passkeyId}',
  tags: ['Auth'],
  summary: 'Update passkey',
  description: 'Update passkey display name.',
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

export const deletePasskey = createRoute({
  method: 'delete',
  path: '/passkeys/{passkeyId}',
  tags: ['Auth'],
  summary: 'Delete passkey',
  description: 'Delete a registered passkey.',
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
