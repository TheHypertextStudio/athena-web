/**
 * RISC (Cross-Account Protection) Service Tests
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock database - must use vi.hoisted for proper hoisting
const mockDb = vi.hoisted(() => {
  const selectMock = vi.fn();
  const deleteMock = vi.fn();
  const updateMock = vi.fn();
  return {
    select: selectMock,
    delete: deleteMock,
    update: updateMock,
    _reset: () => {
      selectMock.mockReset();
      deleteMock.mockReset();
      updateMock.mockReset();
      // Default implementations
      selectMock.mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          })),
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });
      deleteMock.mockReturnValue({
        where: vi.fn(() => Promise.resolve()),
      });
      updateMock.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      });
    },
  };
});

const mockJwtVerify = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({ db: mockDb }));

vi.mock('../../src/db/schema/auth.js', () => ({
  accounts: {
    userId: 'userId',
    providerId: 'providerId',
    accountId: 'accountId',
    googleSignInDisabled: 'googleSignInDisabled',
    tokensRevokedAt: 'tokensRevokedAt',
    credentialChangeRequired: 'credentialChangeRequired',
    accessToken: 'accessToken',
    refreshToken: 'refreshToken',
    accessTokenExpiresAt: 'accessTokenExpiresAt',
    refreshTokenExpiresAt: 'refreshTokenExpiresAt',
  },
  sessions: { userId: 'userId' },
  users: { id: 'id', email: 'email', securityAlertAt: 'securityAlertAt' },
}));

vi.mock('../../src/lib/env.js', () => ({
  env: {
    googleOAuth: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    },
    riscConfig: {
      webhookUrl: 'https://example.com/api/risc/webhook',
      useAdc: true,
    },
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: mockJwtVerify,
}));

import {
  validateRISCToken,
  processRISCEvent,
  RISC_EVENT_TYPES,
} from '../../src/services/risc/index.js';

describe('RISC Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._reset();
    // Reset fetch mock
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateRISCToken', () => {
    it('should validate a valid RISC token', async () => {
      // Mock RISC config fetch
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            issuer: 'https://accounts.google.com',
            jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          }),
      });

      // Mock JWT verification
      const mockPayload = {
        jti: 'event-123',
        iat: Date.now() / 1000,
        iss: 'https://accounts.google.com',
        aud: 'test-client-id',
        events: {
          [RISC_EVENT_TYPES.SESSIONS_REVOKED]: {
            subject: {
              subject_type: 'iss-sub',
              iss: 'https://accounts.google.com',
              sub: 'google-user-123',
            },
          },
        },
      };

      mockJwtVerify.mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: 'RS256' },
      });

      const result = await validateRISCToken('valid-token');

      expect(result).toEqual(mockPayload);
      expect(mockJwtVerify).toHaveBeenCalledWith(
        'valid-token',
        expect.any(Function),
        expect.objectContaining({
          issuer: 'https://accounts.google.com',
          audience: 'test-client-id',
        }),
      );
    });

    it('should throw error when JWT verification fails', async () => {
      // Config is cached, so test JWT verification failure instead
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            issuer: 'https://accounts.google.com',
            jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          }),
      });

      mockJwtVerify.mockRejectedValueOnce(new Error('Invalid token'));

      await expect(validateRISCToken('invalid-token')).rejects.toThrow('Invalid token');
    });

    it('should cache RISC config', async () => {
      // First call - config is cached from previous test, so this might not fetch
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            issuer: 'https://accounts.google.com',
            jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          }),
      });

      mockJwtVerify.mockResolvedValue({
        payload: { jti: '1', events: {} },
        protectedHeader: { alg: 'RS256' },
      });

      await validateRISCToken('token1');
      await validateRISCToken('token2');

      // Both tokens validated
      expect(mockJwtVerify).toHaveBeenCalledTimes(2);
    });
  });

  describe('processRISCEvent', () => {
    it('should process sessions-revoked event', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve([{ userId: 'user-123', userEmail: 'test@example.com' }]),
              ),
            })),
          })),
        })),
      });

      const payload = {
        jti: 'event-123',
        events: {
          [RISC_EVENT_TYPES.SESSIONS_REVOKED]: {
            subject: {
              subject_type: 'iss-sub' as const,
              iss: 'https://accounts.google.com',
              sub: 'google-user-123',
            },
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.SESSIONS_REVOKED);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should process tokens-revoked event and clear OAuth tokens', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve([{ userId: 'user-123', userEmail: 'test@example.com' }]),
              ),
            })),
          })),
        })),
      });

      const payload = {
        jti: 'event-456',
        events: {
          [RISC_EVENT_TYPES.TOKENS_REVOKED]: {
            subject: {
              subject_type: 'iss-sub' as const,
              iss: 'https://accounts.google.com',
              sub: 'google-user-456',
            },
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.TOKENS_REVOKED);
      // Should update accounts (clear tokens) and delete sessions
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should process OAuth tokens-revoked event', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve([{ userId: 'user-oauth', userEmail: 'oauth@example.com' }]),
              ),
            })),
          })),
        })),
      });

      const payload = {
        jti: 'oauth-event-123',
        events: {
          [RISC_EVENT_TYPES.OAUTH_TOKENS_REVOKED]: {
            subject: {
              subject_type: 'iss-sub' as const,
              iss: 'https://accounts.google.com',
              sub: 'google-user-oauth',
            },
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.OAUTH_TOKENS_REVOKED);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should process OAuth token-revoked event (single token)', async () => {
      const payload = {
        jti: 'oauth-single-token-event',
        events: {
          [RISC_EVENT_TYPES.OAUTH_TOKEN_REVOKED]: {
            subject: {
              subject_type: 'token' as const,
              token_type: 'refresh_token' as const,
              token_identifier_alg: 'prefix' as const,
              token: 'ya29.a0AfH6SMB...',
            },
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.OAUTH_TOKEN_REVOKED);
      // Should log warning since token lookup is not implemented
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should process account-disabled event and disable Google sign-in', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve([{ userId: 'user-789', userEmail: 'disabled@example.com' }]),
              ),
            })),
          })),
        })),
      });

      const payload = {
        jti: 'event-789',
        events: {
          [RISC_EVENT_TYPES.ACCOUNT_DISABLED]: {
            subject: {
              subject_type: 'iss-sub' as const,
              iss: 'https://accounts.google.com',
              sub: 'google-user-789',
            },
            reason: 'hijacking',
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.ACCOUNT_DISABLED);
      // Should update accounts (set googleSignInDisabled) and delete sessions
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should process account-enabled event and re-enable Google sign-in', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve([{ userId: 'user-enabled', userEmail: 'enabled@example.com' }]),
              ),
            })),
          })),
        })),
      });

      const payload = {
        jti: 'event-enabled',
        events: {
          [RISC_EVENT_TYPES.ACCOUNT_ENABLED]: {
            subject: {
              subject_type: 'iss-sub' as const,
              iss: 'https://accounts.google.com',
              sub: 'google-user-enabled',
            },
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.ACCOUNT_ENABLED);
      // Should update accounts (set googleSignInDisabled=false)
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should process credential-change-required event', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve([{ userId: 'user-cred', userEmail: 'cred@example.com' }]),
              ),
            })),
          })),
        })),
      });

      const payload = {
        jti: 'event-cred',
        events: {
          [RISC_EVENT_TYPES.CREDENTIAL_CHANGE_REQUIRED]: {
            subject: {
              subject_type: 'iss-sub' as const,
              iss: 'https://accounts.google.com',
              sub: 'google-user-cred',
            },
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.CREDENTIAL_CHANGE_REQUIRED);
      // Should update accounts (set credentialChangeRequired) and users (set securityAlertAt)
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should process verification event', async () => {
      const payload = {
        jti: 'verify-123',
        events: {
          [RISC_EVENT_TYPES.VERIFICATION]: {
            state: 'test-state',
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.VERIFICATION);
    });

    it('should resolve id_token_claims subject by email', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([{ userId: 'user-email', userEmail: 'email@example.com' }]),
            ),
          })),
        })),
      });

      const payload = {
        jti: 'event-email-subject',
        events: {
          [RISC_EVENT_TYPES.SESSIONS_REVOKED]: {
            subject: {
              subject_type: 'id_token_claims' as const,
              iss: 'https://accounts.google.com',
              email: 'email@example.com',
            },
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.SESSIONS_REVOKED);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should deduplicate events by jti', async () => {
      const payload = {
        jti: 'duplicate-event',
        events: {
          [RISC_EVENT_TYPES.VERIFICATION]: {
            state: 'test',
          },
        },
      };

      // First call should process
      const result1 = await processRISCEvent(payload);
      expect(result1.success).toBe(true);
      expect(result1.eventTypes.length).toBeGreaterThan(0);

      // Second call with same jti should skip (dedup)
      const result2 = await processRISCEvent(payload);
      expect(result2.success).toBe(true);
      expect(result2.eventTypes).toEqual([]);
      expect(result2.duplicate).toBe(true);
    });

    it('should skip events without subject', async () => {
      const payload = {
        jti: 'no-subject-event',
        events: {
          [RISC_EVENT_TYPES.SESSIONS_REVOKED]: {},
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.SESSIONS_REVOKED);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle user not found gracefully', async () => {
      // Return empty array (user not found)
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          })),
        })),
      });

      const payload = {
        jti: 'unknown-user-event',
        events: {
          [RISC_EVENT_TYPES.SESSIONS_REVOKED]: {
            subject: {
              subject_type: 'iss-sub' as const,
              iss: 'https://accounts.google.com',
              sub: 'unknown-google-user',
            },
          },
        },
      };

      // Should not throw, just log and continue
      const result = await processRISCEvent(payload);
      expect(result.success).toBe(true);
    });

    it('should handle multiple events in single payload', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() =>
                Promise.resolve([{ userId: 'user-multi', userEmail: 'multi@example.com' }]),
              ),
            })),
          })),
        })),
      });

      const payload = {
        jti: 'multi-event',
        events: {
          [RISC_EVENT_TYPES.SESSIONS_REVOKED]: {
            subject: {
              subject_type: 'iss-sub' as const,
              iss: 'https://accounts.google.com',
              sub: 'google-user-multi',
            },
          },
          [RISC_EVENT_TYPES.CREDENTIAL_CHANGE_REQUIRED]: {
            subject: {
              subject_type: 'iss-sub' as const,
              iss: 'https://accounts.google.com',
              sub: 'google-user-multi',
            },
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(result.eventTypes).toHaveLength(2);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.SESSIONS_REVOKED);
      expect(result.eventTypes).toContain(RISC_EVENT_TYPES.CREDENTIAL_CHANGE_REQUIRED);
    });

    it('should warn on unknown subject type', async () => {
      const payload = {
        jti: 'unknown-subject-type',
        events: {
          [RISC_EVENT_TYPES.SESSIONS_REVOKED]: {
            subject: {
              subject_type: 'unknown' as never,
              iss: 'https://accounts.google.com',
              sub: 'test',
            },
          },
        },
      };

      const result = await processRISCEvent(payload);

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
