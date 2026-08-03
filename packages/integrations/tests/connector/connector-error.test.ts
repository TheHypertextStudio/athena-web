/**
 * Direct unit tests for {@link ConnectorError}: status classification, the `retryable` getter
 * across every {@link ConnectorErrorKind}, and the {@link isConnectorError} type guard. The
 * network-edge classification paths (429/401/5xx mapping through a real HTTP call) are exercised
 * end to end in `real-connector.test.ts`; this file covers the class's own logic directly.
 */
import { describe, expect, it } from 'vitest';

import { ConnectorError, isConnectorError } from '../../src/connector-error';

describe('ConnectorError.kindForStatus', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [500, 'provider'],
    [404, 'provider'],
  ] as const)('classifies %i as %s', (status, kind) => {
    expect(ConnectorError.kindForStatus(status)).toBe(kind);
  });
});

describe('ConnectorError.retryable', () => {
  it.each(['rate_limit', 'network', 'provider'] as const)('is true for kind=%s', (kind) => {
    const err = new ConnectorError('boom', { provider: 'github', kind });
    expect(err.retryable).toBe(true);
  });

  it.each(['auth', 'unknown'] as const)('is false for kind=%s', (kind) => {
    const err = new ConnectorError('boom', { provider: 'github', kind });
    expect(err.retryable).toBe(false);
  });
});

describe('ConnectorError construction', () => {
  it('leaves status/retryAfterSeconds undefined when not supplied', () => {
    const err = new ConnectorError('boom', { provider: 'github', kind: 'unknown' });
    expect(err.status).toBeUndefined();
    expect(err.retryAfterSeconds).toBeUndefined();
    expect(err.name).toBe('ConnectorError');
  });

  it('carries status, retryAfterSeconds, and cause when supplied', () => {
    const cause = new Error('socket hang up');
    const err = new ConnectorError('boom', {
      provider: 'linear',
      kind: 'rate_limit',
      status: 429,
      retryAfterSeconds: 30,
      cause,
    });
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(30);
    expect(err.cause).toBe(cause);
  });
});

describe('isConnectorError', () => {
  it('narrows a ConnectorError instance', () => {
    expect(
      isConnectorError(new ConnectorError('boom', { provider: 'github', kind: 'unknown' })),
    ).toBe(true);
  });

  it('rejects any other value', () => {
    expect(isConnectorError(new Error('plain'))).toBe(false);
    expect(isConnectorError('boom')).toBe(false);
    expect(isConnectorError(undefined)).toBe(false);
  });
});
