import { generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { generateAppleClientSecret } from '../src/apple-secret';

/** A throwaway EC P-256 keypair (the curve Apple's ES256 client secret is signed on). */
function ecKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    publicKey,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/** Decode a base64url JWT segment back to JSON. */
function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

describe('generateAppleClientSecret', () => {
  const input = {
    clientId: 'com.docket.web',
    teamId: 'ABCDE12345',
    keyId: 'KEY1234567',
  };

  it('mints a three-segment ES256 JWT with the Apple-required header + claims', () => {
    const { privateKeyPem } = ecKeypair();
    const jwt = generateAppleClientSecret({ ...input, privateKey: privateKeyPem });

    const [headerB64, payloadB64, signatureB64] = jwt.split('.');
    expect(signatureB64).toBeTruthy();

    expect(decodeSegment(headerB64!)).toEqual({ alg: 'ES256', kid: input.keyId });

    const payload = decodeSegment(payloadB64!);
    expect(payload['iss']).toBe(input.teamId);
    expect(payload['sub']).toBe(input.clientId);
    expect(payload['aud']).toBe('https://appleid.apple.com');
    // Valid window, and under Apple's six-month (15,777,000s) ceiling.
    const iat = payload['iat'] as number;
    const exp = payload['exp'] as number;
    expect(exp - iat).toBe(180 * 24 * 60 * 60);
    expect(exp - iat).toBeLessThanOrEqual(15_777_000);
  });

  it('produces a signature that verifies against the public key (JOSE r‖s / ieee-p1363)', () => {
    const { privateKeyPem, publicKey } = ecKeypair();
    const jwt = generateAppleClientSecret({ ...input, privateKey: privateKeyPem });

    const [headerB64, payloadB64, signatureB64] = jwt.split('.');
    const ok = verify(
      'sha256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signatureB64!, 'base64url'),
    );
    expect(ok).toBe(true);
  });

  it('normalizes an escaped-\\n (single-line .env) private key', () => {
    const { privateKeyPem } = ecKeypair();
    // Simulate a PEM stored on one `.env` line with literal `\n` escapes.
    const escaped = privateKeyPem.replace(/\n/g, '\\n');
    expect(() => generateAppleClientSecret({ ...input, privateKey: escaped })).not.toThrow();
  });

  it('throws on a private key that is not a valid EC PEM', () => {
    expect(() => generateAppleClientSecret({ ...input, privateKey: 'not-a-pem' })).toThrow();
  });
});
