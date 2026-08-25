/** Provider failure vocabulary belongs to Connections, not a concrete SDK adapter. */
import { describe, expect, it } from 'vitest';

import {
  isProviderAuthError,
  isProviderMissingObjectError,
  ProviderError,
  providerErrorKind,
  providerErrorKindForStatus,
  type ProviderErrorKind,
} from '../src/provider-error';
import { NOTION_API_VERSION } from '../src/notion/api-contract';

describe('Connections provider-error vocabulary', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [404, 'provider'],
    [500, 'provider'],
  ] as const satisfies readonly (readonly [number, ProviderErrorKind])[])(
    'classifies HTTP %i as %s',
    (status, kind) => {
      expect(providerErrorKindForStatus(status)).toBe(kind);
    },
  );

  it('recognizes an auth failure structurally without knowing its adapter class', () => {
    const authError = Object.assign(new Error('token rejected'), { kind: 'auth' as const });

    expect(isProviderAuthError(authError)).toBe(true);
    expect(isProviderAuthError({ kind: 'auth' })).toBe(true);
    expect(isProviderAuthError({ kind: 'network' })).toBe(false);
    expect(isProviderAuthError(new Error('token rejected'))).toBe(false);
    expect(isProviderAuthError(undefined)).toBe(false);
  });

  it('distinguishes a missing provider object from other provider failures', () => {
    expect(isProviderMissingObjectError({ kind: 'provider', status: 404 })).toBe(true);
    expect(isProviderMissingObjectError({ kind: 'provider', status: 500 })).toBe(false);
    expect(isProviderMissingObjectError({ kind: 'network', status: 404 })).toBe(false);
    expect(isProviderMissingObjectError({ kind: 'provider' })).toBe(false);
    expect(isProviderMissingObjectError(new Error('not found'))).toBe(false);
    expect(isProviderMissingObjectError({ kind: 'auth', status: 404 })).toBe(false);
    expect(isProviderMissingObjectError(undefined)).toBe(false);
  });

  it.each([
    'auth',
    'rate_limit',
    'network',
    'provider',
    'ambiguous',
    'unknown',
  ] as const satisfies readonly ProviderErrorKind[])(
    'preserves the %s kind from an adapter-shaped failure',
    (kind) => {
      expect(providerErrorKind({ kind })).toBe(kind);
    },
  );

  it('returns unknown for a failure with an unrecognized kind', () => {
    expect(providerErrorKind({ kind: 'timeout' })).toBe('unknown');
  });

  it('carries provider failure metadata and retry semantics on the domain error', () => {
    const cause = new Error('connection reset');
    const error = new ProviderError('Notion throttled the sync', {
      provider: 'notion',
      kind: ProviderError.kindForStatus(429),
      status: 429,
      retryAfterSeconds: 30,
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProviderError');
    expect(error.provider).toBe('notion');
    expect(error.kind).toBe('rate_limit');
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(true);
    expect(
      new ProviderError('Waiting for confirmation', {
        provider: 'notion',
        kind: 'ambiguous',
      }).retryable,
    ).toBe(true);
    expect(ProviderError.kindForStatus(401)).toBe('auth');
    expect(ProviderError.kindForStatus(503)).toBe('provider');
  });
});

describe('Connections Notion protocol', () => {
  it('owns the Notion API version used by every adapter', () => {
    expect(NOTION_API_VERSION).toBe('2026-03-11');
  });
});
