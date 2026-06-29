import { describe, expect, it } from 'vitest';

import { decodeIdTokenClaims } from '../../src/lib/id-token';

/** Build a JWT-shaped string (`header.payload.signature`) carrying the given claims. */
function jwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.signature`;
}

const NONE = { email: null, name: null, picture: null };

describe('decodeIdTokenClaims', () => {
  it('decodes email/name/picture from the (unverified) payload', () => {
    expect(
      decodeIdTokenClaims(
        jwt({ email: 'ada@gmail.com', name: 'Ada', picture: 'http://x/a.png', sub: '1' }),
      ),
    ).toEqual({ email: 'ada@gmail.com', name: 'Ada', picture: 'http://x/a.png' });
  });

  it('returns all-null claims for an absent token', () => {
    expect(decodeIdTokenClaims(null)).toEqual(NONE);
  });

  it('returns all-null claims for a malformed token', () => {
    expect(decodeIdTokenClaims('not-a-jwt')).toEqual(NONE);
    expect(decodeIdTokenClaims('a.b.c')).toEqual(NONE);
  });

  it('omits non-string claims', () => {
    expect(decodeIdTokenClaims(jwt({ email: 123, name: null }))).toEqual(NONE);
  });
});
