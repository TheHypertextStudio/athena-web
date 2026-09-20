import { describe, expect, it } from 'vitest';

import {
  clientIdFromRequest,
  decodeJwtPayload,
  presentedRevocationToken,
} from '../src/oauth-provider-live-state';

function context(authorization?: string) {
  return {
    request: new Request('https://api.clearthedocket.com/token', {
      ...(authorization ? { headers: { authorization } } : {}),
    }),
  } as never;
}

describe('OAuth provider live-state parsing', () => {
  it('decodes one JWT object payload', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url');
    expect(decodeJwtPayload(`header.${payload}.signature`)).toEqual({ sub: 'user-1' });
  });

  it.each([
    ['missing payload', 'not-a-jwt'],
    ['invalid JSON', `header.${Buffer.from('{').toString('base64url')}.signature`],
    ['null JSON', `header.${Buffer.from('null').toString('base64url')}.signature`],
    ['array JSON', `header.${Buffer.from('[]').toString('base64url')}.signature`],
  ])('rejects %s', (_label, token) => {
    expect(() => decodeJwtPayload(token)).toThrow();
  });

  it('reads a complete Basic client identity before falling back to the body', () => {
    const basic = Buffer.from('client-1:secret').toString('base64');
    expect(clientIdFromRequest(context(`Basic ${basic}`), {})).toBe('client-1');
    expect(clientIdFromRequest(context(), { client_id: 'client-2' })).toBe('client-2');
    expect(clientIdFromRequest(context(), {})).toBeNull();
  });

  it.each(['client-only', ':secret', 'client:'])(
    'rejects incomplete Basic credentials: %s',
    (credentials) => {
      const basic = Buffer.from(credentials).toString('base64');
      expect(clientIdFromRequest(context(`Basic ${basic}`), { client_id: 'fallback' })).toBeNull();
    },
  );

  it('normalizes the revocation token and rejects omission', () => {
    expect(presentedRevocationToken({ token: 'Bearer token-value' })).toBe('token-value');
    expect(presentedRevocationToken({ token: 'token-value' })).toBe('token-value');
    expect(() => presentedRevocationToken({})).toThrow();
    expect(() => presentedRevocationToken({ token: 'Bearer ' })).toThrow();
  });
});
