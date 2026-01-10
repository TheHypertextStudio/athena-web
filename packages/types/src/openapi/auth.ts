/**
 * Auth OpenAPI schemas.
 *
 * These schemas define the API contract for auth endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Core Auth Schemas
// =============================================================================

export const SessionSchema = z
  .object({
    id: z.string().openapi({ description: 'Session ID' }),
    ipAddress: z.string().nullable().openapi({ description: 'IP address of session' }),
    userAgent: z.string().nullable().openapi({ description: 'User agent string' }),
    createdAt: TimestampSchema.openapi({ description: 'Session creation time' }),
    expiresAt: TimestampSchema.openapi({ description: 'Session expiration time' }),
    isCurrent: z.boolean().openapi({ description: 'Whether this is the current session' }),
  })
  .openapi('Session');

export const LinkedAccountSchema = z
  .object({
    id: z.string().openapi({ description: 'Account link ID' }),
    providerId: z.string().openapi({ description: 'OAuth provider ID', example: 'google' }),
    accountId: z.string().openapi({ description: 'Provider account ID' }),
    createdAt: TimestampSchema.openapi({ description: 'Link creation time' }),
  })
  .openapi('LinkedAccount');

export const PasskeySchema = z
  .object({
    id: z.string().openapi({ description: 'Passkey ID' }),
    name: z.string().openapi({ description: 'Passkey display name', example: 'MacBook Pro' }),
    deviceType: z.string().nullable().openapi({ description: 'Device type' }),
    backedUp: z.boolean().openapi({ description: 'Whether passkey is backed up' }),
    createdAt: TimestampSchema.openapi({ description: 'Registration time' }),
  })
  .openapi('Passkey');

export const BackupCodesInfoSchema = z
  .object({
    hasBackupCodes: z.boolean().openapi({ description: 'Whether user has backup codes' }),
    remainingCount: z.number().int().openapi({ description: 'Number of unused backup codes' }),
    createdAt: TimestampSchema.nullable().openapi({ description: 'When codes were generated' }),
  })
  .openapi('BackupCodesInfo');

// =============================================================================
// Path Parameters
// =============================================================================

export const SessionIdParamSchema = z
  .object({
    sessionId: z.string().openapi({
      description: 'Session ID',
      param: { name: 'sessionId', in: 'path' },
    }),
  })
  .openapi('SessionIdParam');

export const AccountIdParamSchema = z
  .object({
    accountId: z.string().openapi({
      description: 'Linked account ID',
      param: { name: 'accountId', in: 'path' },
    }),
  })
  .openapi('AccountIdParam');

export const PasskeyIdParamSchema = z
  .object({
    passkeyId: z.string().openapi({
      description: 'Passkey ID',
      param: { name: 'passkeyId', in: 'path' },
    }),
  })
  .openapi('PasskeyIdParam');

// =============================================================================
// Request Bodies
// =============================================================================

export const VerifyBackupCodeRequestSchema = z
  .object({
    email: z.email().openapi({
      description: 'User email address',
      example: 'user@example.com',
    }),
    code: z.string().min(8).max(10).openapi({
      description: 'Backup code (8-10 characters)',
    }),
  })
  .openapi('VerifyBackupCodeRequest');

export const UpdatePasskeyRequestSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({
      description: 'New passkey display name',
      example: 'Work MacBook',
    }),
  })
  .openapi('UpdatePasskeyRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const BackupCodesInfoResponseSchema = successResponseSchema(
  BackupCodesInfoSchema,
  'Backup codes info response',
).openapi('BackupCodesInfoResponse');

export const GenerateBackupCodesResponseSchema = z
  .object({
    codes: z.array(z.string()).openapi({ description: 'Generated backup codes' }),
    message: z.string().openapi({ description: 'Success message' }),
    count: z.number().int().openapi({ description: 'Number of codes generated' }),
  })
  .openapi('GenerateBackupCodesResponse');

export const VerifyBackupCodeResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string().openapi({ description: 'Success message' }),
    recoveryToken: z.string().openapi({ description: 'Token for account recovery' }),
    expiresAt: z.string().openapi({ description: 'Token expiration time' }),
  })
  .openapi('VerifyBackupCodeResponse');

export const SessionsResponseSchema = z
  .object({
    sessions: z.array(SessionSchema),
    count: z.number().int().openapi({ description: 'Total number of sessions' }),
  })
  .openapi('SessionsResponse');

export const LinkedAccountsResponseSchema = z
  .object({
    accounts: z.array(LinkedAccountSchema),
    count: z.number().int().openapi({ description: 'Total number of linked accounts' }),
  })
  .openapi('LinkedAccountsResponse');

export const PasskeysResponseSchema = z
  .object({
    passkeys: z.array(PasskeySchema),
    count: z.number().int().openapi({ description: 'Total number of passkeys' }),
  })
  .openapi('PasskeysResponse');

export const RevokeAllSessionsResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string().openapi({ description: 'Success message' }),
  })
  .openapi('RevokeAllSessionsResponse');

export const UpdatePasskeyResponseSchema = z
  .object({
    success: z.literal(true),
    name: z.string().openapi({ description: 'Updated passkey name' }),
  })
  .openapi('UpdatePasskeyResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type Session = z.infer<typeof SessionSchema>;
export type LinkedAccount = z.infer<typeof LinkedAccountSchema>;
export type Passkey = z.infer<typeof PasskeySchema>;
export type BackupCodesInfo = z.infer<typeof BackupCodesInfoSchema>;
export type VerifyBackupCodeRequest = z.infer<typeof VerifyBackupCodeRequestSchema>;
export type UpdatePasskeyRequest = z.infer<typeof UpdatePasskeyRequestSchema>;
export type BackupCodesInfoResponse = z.infer<typeof BackupCodesInfoResponseSchema>;
export type GenerateBackupCodesResponse = z.infer<typeof GenerateBackupCodesResponseSchema>;
export type VerifyBackupCodeResponse = z.infer<typeof VerifyBackupCodeResponseSchema>;
export type SessionsResponse = z.infer<typeof SessionsResponseSchema>;
export type LinkedAccountsResponse = z.infer<typeof LinkedAccountsResponseSchema>;
export type PasskeysResponse = z.infer<typeof PasskeysResponseSchema>;
export type RevokeAllSessionsResponse = z.infer<typeof RevokeAllSessionsResponseSchema>;
export type UpdatePasskeyResponse = z.infer<typeof UpdatePasskeyResponseSchema>;
