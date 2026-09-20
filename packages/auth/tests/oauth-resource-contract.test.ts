import { describe, expect, it } from 'vitest';

import {
  effectiveOAuthClientScopes,
  hashOAuthToken,
  parseAuthorizationResource,
  resolveRestResourceUrl,
  resolveTokenResource,
} from '../src/oauth-resource-contract';

const MCP = 'https://api.clearthedocket.com/mcp';
const REST = 'https://api.clearthedocket.com/v1';

describe('OAuth resource contract', () => {
  it('defaults only absent legacy client scopes and preserves an explicit empty restriction', () => {
    expect(effectiveOAuthClientScopes(null)).toEqual([
      'work:read',
      'work:write',
      'agents:run',
      'connectors:link',
      'offline_access',
    ]);
    expect(effectiveOAuthClientScopes(undefined)).toEqual([
      'work:read',
      'work:write',
      'agents:run',
      'connectors:link',
      'offline_access',
    ]);
    expect(effectiveOAuthClientScopes([])).toEqual([]);
    expect(effectiveOAuthClientScopes(['work:read'])).toEqual(['work:read']);
  });

  it('uses one stable base64url SHA-256 token digest for storage and revocation', async () => {
    await expect(hashOAuthToken('secret-token')).resolves.toBe(
      'kwu9xRtq7VwqVnj9bije56BeiktkPPwLRCfD77hsDZQ',
    );
  });

  it('derives the REST resource from API_URL without accepting a trailing-slash alias', () => {
    expect(resolveRestResourceUrl('https://api.clearthedocket.com/')).toBe(REST);
  });

  it('defaults an omitted authorization resource to MCP and accepts either exact resource', () => {
    expect(parseAuthorizationResource([], MCP, REST)).toBe(MCP);
    expect(parseAuthorizationResource([MCP], MCP, REST)).toBe(MCP);
    expect(parseAuthorizationResource([REST], MCP, REST)).toBe(REST);
  });

  it.each([
    ['empty', ['']],
    ['repeated equal', [REST, REST]],
    ['repeated different', [REST, MCP]],
    ['comma-separated', [`${REST},${MCP}`]],
    ['trailing slash', [`${REST}/`]],
    ['unknown', ['https://api.example.test/v1']],
  ])('rejects %s authorization resources', (_label, resources) => {
    expect(() => parseAuthorizationResource(resources, MCP, REST)).toThrow('invalid_target');
  });

  it('uses the stored binding when token resource is omitted', () => {
    expect(resolveTokenResource(undefined, REST, MCP, REST)).toBe(REST);
  });

  it('rejects token-resource substitution', () => {
    expect(() => resolveTokenResource(MCP, REST, MCP, REST)).toThrow('invalid_target');
  });

  it.each([undefined, null, '', 'https://api.example.test/v1'])(
    'rejects an invalid stored token resource binding: %s',
    (bound) => {
      expect(() => resolveTokenResource(undefined, bound, MCP, REST)).toThrow('invalid_grant');
    },
  );
});
