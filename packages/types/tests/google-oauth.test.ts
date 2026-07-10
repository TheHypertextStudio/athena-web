import { describe, expect, it } from 'vitest';

import {
  GOOGLE_CONNECTOR_SCOPES,
  googleScopesForConnector,
  parseOAuthScopes,
} from '../src/google-oauth';

describe('Google OAuth scope helpers', () => {
  it('parses comma- and whitespace-separated provider storage', () => {
    expect(parseOAuthScopes('openid,email  profile\ntasks')).toEqual([
      'openid',
      'email',
      'profile',
      'tasks',
    ]);
    expect(parseOAuthScopes(null)).toEqual([]);
  });

  it('returns only the scopes owned by the selected connector', () => {
    expect(googleScopesForConnector('calendar')).toEqual(GOOGLE_CONNECTOR_SCOPES.calendar);
    expect(googleScopesForConnector('gmail')).toEqual([
      'https://www.googleapis.com/auth/gmail.modify',
    ]);
    expect(googleScopesForConnector('linear')).toEqual([]);
  });
});
