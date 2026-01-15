/**
 * Authentication middleware unit tests.
 *
 * Tests for session token parsing from cookies.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'hono';

// Mock the database and auth before importing the module
vi.mock('../../src/db/index.js', () => ({
  db: {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

vi.mock('../../src/lib/auth.js', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

import { getSessionToken } from '../../src/middleware/auth.js';

describe('Auth Middleware', () => {
  describe('getSessionToken', () => {
    function createMockContext(cookieValue?: string): Context {
      const headers = new Headers();
      if (cookieValue !== undefined) {
        headers.set('cookie', cookieValue);
      }

      return {
        req: {
          header: (name: string) => headers.get(name),
        },
      } as unknown as Context;
    }

    it('should return null when no cookie header exists', () => {
      const c = createMockContext();
      expect(getSessionToken(c)).toBeNull();
    });

    it('should return null when cookie header exists but no session token', () => {
      const c = createMockContext('other-cookie=value');
      expect(getSessionToken(c)).toBeNull();
    });

    it('should extract simple token without signature', () => {
      const token = 'simple-token-12345';
      const c = createMockContext(`better-auth.session_token=${token}`);
      expect(getSessionToken(c)).toBe(token);
    });

    it('should extract token before the dot separator (signature)', () => {
      // Better Auth cookie format: {token}.{signature}
      const baseToken = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4';
      const signature = 'abcdefghijklmnopqrstuvwxyz123456';
      const cookieValue = `${baseToken}.${signature}`;
      const c = createMockContext(`better-auth.session_token=${cookieValue}`);

      expect(getSessionToken(c)).toBe(baseToken);
    });

    it('should handle URL-encoded cookie values', () => {
      // URL-encoded token with signature
      const baseToken = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4';
      const signature = 'abcdefghijklmnopqrstuvwxyz123456';
      const encodedValue = encodeURIComponent(`${baseToken}.${signature}`);
      const c = createMockContext(`better-auth.session_token=${encodedValue}`);

      expect(getSessionToken(c)).toBe(baseToken);
    });

    it('should handle cookies with multiple values', () => {
      const baseToken = 'test-token-value';
      const c = createMockContext(
        `other-cookie=foo; better-auth.session_token=${baseToken}.signature; another=bar`,
      );

      expect(getSessionToken(c)).toBe(baseToken);
    });

    it('should handle cookies with whitespace', () => {
      const baseToken = 'test-token';
      const c = createMockContext(`  better-auth.session_token=${baseToken}.sig  `);

      expect(getSessionToken(c)).toBe(baseToken);
    });

    it('should handle malformed URL-encoded values gracefully', () => {
      // Malformed URL encoding - should use raw value
      const c = createMockContext('better-auth.session_token=%invalid%');
      // Should return the raw value (minus signature if present)
      const result = getSessionToken(c);
      expect(result).toBe('%invalid%');
    });

    it('should handle empty cookie value', () => {
      const c = createMockContext('better-auth.session_token=');
      expect(getSessionToken(c)).toBe('');
    });

    it('should handle token that contains multiple dots', () => {
      // Only split on the first dot (token.signature format)
      const baseToken = 'token-with.dot';
      const signature = 'signature-part';
      const c = createMockContext(`better-auth.session_token=${baseToken}.${signature}`);

      // Should extract everything before the first dot only
      expect(getSessionToken(c)).toBe('token-with');
    });
  });
});
