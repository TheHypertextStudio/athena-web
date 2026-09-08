import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apple } from 'better-auth/social-providers';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyId = 'docket-apple-test-key';
const publicJwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', kid: keyId };

function appleToken(audience: string, nonce: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: keyId })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://appleid.apple.com',
      aud: audience,
      sub: 'apple-user',
      iat: now,
      exp: now + 300,
      nonce,
    }),
  ).toString('base64url');
  const content = `${header}.${payload}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}

describe('native Apple identity token verification', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ keys: [publicJwk] })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('accepts the native app audience and the hash of the raw nonce', async () => {
    const rawNonce = 'raw-native-nonce';
    const hashedNonce = createHash('sha256').update(rawNonce).digest('hex');
    const provider = apple({
      clientId: ['studio.hypertext.docket.web', 'studio.hypertext.docket'],
      clientSecret: 'test-secret',
    });

    const result = await provider.verifyIdToken(
      appleToken('studio.hypertext.docket', hashedNonce),
      rawNonce,
    );
    const keyRequest = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(keyRequest).toBeInstanceOf(URL);
    expect(keyRequest instanceof URL ? keyRequest.href : null).toBe(
      'https://appleid.apple.com/auth/keys',
    );
    expect(result).toBe(true);
  });

  it('rejects an unrecognized audience and a mismatched nonce', async () => {
    const provider = apple({
      clientId: ['studio.hypertext.docket.web', 'studio.hypertext.docket'],
      clientSecret: 'test-secret',
    });

    await expect(
      provider.verifyIdToken(
        appleToken('studio.hypertext.other', 'raw-native-nonce'),
        'raw-native-nonce',
      ),
    ).resolves.toBe(false);
    await expect(
      provider.verifyIdToken(
        appleToken('studio.hypertext.docket', 'different-nonce'),
        'raw-native-nonce',
      ),
    ).resolves.toBe(false);
  });
});
