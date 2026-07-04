import { createVerify, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  InstallationTokenStore,
  buildAppJwt,
  decodeAppPrivateKey,
  mintInstallationToken,
  resolveInstallationAccount,
} from '../../src/real/connector-github-app';
import { ConnectorError } from '../../src/ports/connector-error';

// A throwaway RSA keypair so the JWT signature can be verified against a real public key.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' });
const NOW_S = 1_750_000_000;
const APP = { appId: '12345', privateKeyPem: PEM };

/** Decode a base64url JWT segment to its parsed JSON. */
function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

describe('buildAppJwt', () => {
  it('produces a verifiable RS256 JWT with the app id as issuer and a <=10min window', () => {
    const jwt = buildAppJwt({ ...APP, nowSeconds: NOW_S });
    const segments = jwt.split('.');
    expect(segments).toHaveLength(3);
    const [header, payload, signature] = segments as [string, string, string];

    expect(decodeSegment(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = decodeSegment(payload);
    expect(claims['iss']).toBe('12345');
    expect(claims['iat']).toBe(NOW_S - 60); // backdated for clock skew
    expect(claims['exp']).toBe(NOW_S + 540); // 9 min, under GitHub's 10-min ceiling

    const verifier = createVerify('RSA-SHA256').update(`${header}.${payload}`);
    expect(verifier.verify(PUBLIC_PEM, signature, 'base64url')).toBe(true);
  });
});

describe('decodeAppPrivateKey', () => {
  it('round-trips a single-line base64 PEM back into the original PEM', () => {
    const encoded = Buffer.from(PEM, 'utf8').toString('base64');
    expect(decodeAppPrivateKey(encoded)).toBe(PEM);
  });
});

describe('mintInstallationToken', () => {
  it('POSTs the app JWT and returns the token + expiry', async () => {
    const http = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.github.com/app/installations/99/access_tokens');
      expect(init?.method).toBe('POST');
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      expect(auth.startsWith('Bearer ')).toBe(true);
      return new Response(
        JSON.stringify({ token: 'ghs_abc', expires_at: '2026-06-28T13:00:00Z' }),
        {
          status: 201,
        },
      );
    });
    const res = await mintInstallationToken({ ...APP, http }, '99', NOW_S);
    expect(res).toEqual({ token: 'ghs_abc', expiresAt: '2026-06-28T13:00:00Z' });
    expect(http).toHaveBeenCalledOnce();
  });

  it('throws a ConnectorError when GitHub omits the token', async () => {
    const http = vi.fn(async () => new Response(JSON.stringify({}), { status: 201 }));
    await expect(mintInstallationToken({ ...APP, http }, '99', NOW_S)).rejects.toBeInstanceOf(
      ConnectorError,
    );
  });
});

describe('resolveInstallationAccount', () => {
  it('returns the installation account login', async () => {
    const http = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.github.com/app/installations/99');
      return new Response(JSON.stringify({ account: { login: 'octocat' } }), { status: 200 });
    });
    expect(await resolveInstallationAccount({ ...APP, http }, '99', NOW_S)).toBe('octocat');
  });
});

describe('InstallationTokenStore', () => {
  it('caches a token and re-mints only when within the refresh skew of expiry', async () => {
    let calls = 0;
    const http = vi.fn(async () => {
      calls += 1;
      // Each mint returns a token expiring 1 hour after "now" of that call.
      return new Response(
        JSON.stringify({ token: `ghs_${calls}`, expires_at: '2026-06-28T13:00:00.000Z' }),
        { status: 201 },
      );
    });
    const store = new InstallationTokenStore({ ...APP, http });
    const baseMs = Date.parse('2026-06-28T12:00:00.000Z');

    const first = await store.getToken('99', baseMs);
    expect(first).toBe('ghs_1');
    // Well before expiry → cache hit, no new mint.
    expect(await store.getToken('99', baseMs + 60_000)).toBe('ghs_1');
    expect(calls).toBe(1);

    // Within 5 min of the 13:00 expiry → refresh.
    const refreshed = await store.getToken('99', Date.parse('2026-06-28T12:58:00.000Z'));
    expect(refreshed).toBe('ghs_2');
    expect(calls).toBe(2);
  });
});
