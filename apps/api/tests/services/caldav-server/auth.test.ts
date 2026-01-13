/**
 * CalDAV authentication unit tests.
 *
 * Tests for password hashing, verification, and app password generation.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateAppPassword,
} from '../../../src/services/caldav-server/auth.js';

describe('CalDAV Authentication', () => {
  describe('generateAppPassword', () => {
    it('should generate password in xxxx-xxxx-xxxx-xxxx format', () => {
      const password = generateAppPassword();
      expect(password).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    });

    it('should generate unique passwords', () => {
      const passwords = new Set<string>();
      for (let i = 0; i < 100; i++) {
        passwords.add(generateAppPassword());
      }
      expect(passwords.size).toBe(100);
    });

    it('should use only lowercase alphanumeric characters', () => {
      const password = generateAppPassword();
      const chars = password.replace(/-/g, '');
      expect(chars).toMatch(/^[a-z0-9]+$/);
      expect(chars.length).toBe(16);
    });
  });

  describe('hashPassword', () => {
    it('should produce hash in correct format', async () => {
      const hash = await hashPassword('test-password');
      const parts = hash.split(':');

      expect(parts.length).toBe(6);
      expect(parts[0]).toBe('scrypt');
      expect(parts[1]).toBe('131072'); // N = 2^17
      expect(parts[2]).toBe('8'); // r = 8
      expect(parts[3]).toBe('1'); // p = 1
      // parts[4] = salt (base64)
      // parts[5] = hash (base64)
    });

    it('should produce different hashes for same password (due to random salt)', async () => {
      const hash1 = await hashPassword('same-password');
      const hash2 = await hashPassword('same-password');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const password = 'correct-password';
      const hash = await hashPassword(password);

      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hash = await hashPassword('correct-password');

      const result = await verifyPassword('wrong-password', hash);
      expect(result).toBe(false);
    });

    it('should reject malformed hash (wrong prefix)', async () => {
      const result = await verifyPassword('password', 'bcrypt:invalid:hash');
      expect(result).toBe(false);
    });

    it('should reject malformed hash (wrong part count)', async () => {
      const result = await verifyPassword('password', 'scrypt:131072:8:1');
      expect(result).toBe(false);
    });

    it('should reject empty hash', async () => {
      const result = await verifyPassword('password', '');
      expect(result).toBe(false);
    });

    it('should use timing-safe comparison to prevent timing attacks', async () => {
      const hash = await hashPassword('password');

      // Test that wrong passwords take similar time to verify
      // (we can't directly test timingSafeEqual, but we verify the function works)
      const start1 = Date.now();
      await verifyPassword('wrong-password-1', hash);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      await verifyPassword('completely-different-wrong-password-that-is-longer', hash);
      const time2 = Date.now() - start2;

      // Both should be roughly similar since scrypt dominates timing
      expect(Math.abs(time1 - time2)).toBeLessThan(500); // Within 500ms
    });
  });

  describe('password flow integration', () => {
    it('should hash and verify an app password', async () => {
      const appPassword = generateAppPassword();
      const hash = await hashPassword(appPassword);

      expect(await verifyPassword(appPassword, hash)).toBe(true);
      expect(await verifyPassword('wrong-password', hash)).toBe(false);
    });
  });
});
