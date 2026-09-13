import { describe, expect, it } from 'vitest';

import { accessForOperation, REST_OPERATION_ACCESS } from '../../src/auth/rest-access-policy';

describe('REST OAuth operation access', () => {
  it('allows the organization-list canary with work:read for GET and HEAD', () => {
    expect(accessForOperation('GET', '/v1/orgs')).toEqual({
      kind: 'session-or-oauth',
      scopes: ['work:read'],
    });
    expect(accessForOperation('HEAD', '/v1/orgs')).toEqual({
      kind: 'session-or-oauth',
      scopes: ['work:read'],
    });
  });

  it('keeps every unknown method and path session-only', () => {
    expect(accessForOperation('POST', '/v1/orgs')).toEqual({ kind: 'session-only' });
    expect(accessForOperation('GET', '/v1/me/account')).toEqual({ kind: 'session-only' });
    expect(accessForOperation('GET', '/v1/orgs/unknown')).toEqual({ kind: 'session-only' });
  });

  it('keeps public time status on its existing share token', () => {
    expect(accessForOperation('GET', '/v1/public/time/status')).toEqual({
      kind: 'share-token',
      header: 'X-Docket-Share-Token',
    });
    expect(accessForOperation('HEAD', '/v1/public/time/status')).toEqual({
      kind: 'session-only',
    });
  });

  it('contains no lifecycle-only scope in a resource policy', () => {
    for (const access of REST_OPERATION_ACCESS.values()) {
      if (access.kind === 'session-or-oauth') {
        expect(access.scopes).not.toContain('offline_access');
      }
    }
  });
});
