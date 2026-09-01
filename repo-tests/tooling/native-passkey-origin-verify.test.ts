import { describe, expect, it, vi } from 'vitest';

import {
  parseNativePasskeyOrigins,
  verifyNativePasskeyOrigins,
} from '../../scripts/native-passkey-origin-verify';

const API_ORIGIN = 'https://docket-api.hypertext.studio';
const NATIVE_ORIGIN = 'android:apk-key-hash:3zJp1NzJxP5y_mFioPTp7l8EFEfcs472qSV2_DiQ28c';

describe('native passkey origin production verification', () => {
  it('proves each configured origin reaches passkey verification through the real HTTP contract', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method !== 'POST') {
        return new Response(JSON.stringify({ challenge: 'fresh' }), {
          status: 200,
          headers: { 'set-cookie': 'better-auth.challenge=fresh; Path=/; HttpOnly; Secure' },
        });
      }
      const headers = new Headers(init.headers);
      expect(url).toBe(`${API_ORIGIN}/api/auth/passkey/verify-authentication`);
      expect(headers.get('origin')).toBe(NATIVE_ORIGIN);
      expect(headers.get('cookie')).toBe('better-auth.challenge=fresh');
      return new Response(JSON.stringify({ code: 'PASSKEY_NOT_FOUND' }), { status: 401 });
    });

    const report = await verifyNativePasskeyOrigins(fetcher, {
      apiOrigin: API_ORIGIN,
      nativeOrigins: [NATIVE_ORIGIN],
    });

    expect(report.passed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({ origin: NATIVE_ORIGIN, passed: true, code: 'PASSKEY_NOT_FOUND' }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports an origin-gate rejection without exposing a response body or cookie', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 200,
          headers: { 'set-cookie': 'better-auth.challenge=private; Path=/; HttpOnly' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'INVALID_ORIGIN', message: 'provider detail' }), {
          status: 403,
        }),
      );

    const report = await verifyNativePasskeyOrigins(fetcher, {
      apiOrigin: API_ORIGIN,
      nativeOrigins: [NATIVE_ORIGIN],
    });

    expect(report.passed).toBe(false);
    expect(report.checks[0]).toEqual({
      origin: NATIVE_ORIGIN,
      passed: false,
      status: 403,
      code: 'INVALID_ORIGIN',
    });
    expect(JSON.stringify(report)).not.toContain('private');
    expect(JSON.stringify(report)).not.toContain('provider detail');
  });

  it('rejects malformed or empty deployment configuration before making a request', () => {
    expect(() => parseNativePasskeyOrigins('')).toThrow('at least one');
    expect(() =>
      parseNativePasskeyOrigins(`${NATIVE_ORIGIN},https://docket.hypertext.studio`),
    ).toThrow('Invalid native passkey origin');
  });
});
