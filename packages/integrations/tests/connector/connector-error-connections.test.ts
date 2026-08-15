/** Compatibility tests for generic connector failures using Connections-owned vocabulary. */
import { describe, expect, it } from 'vitest';

import {
  isProviderAuthError,
  ProviderError,
  providerErrorKindForStatus,
} from '@docket/connections/provider-error';

import { ConnectorError, isConnectorError } from '../../src/connector-error';

describe('ConnectorError compatibility with Connections provider errors', () => {
  it('keeps existing auth ConnectorError instances recognizable by Connections', () => {
    const error = new ConnectorError('token rejected', { provider: 'linear', kind: 'auth' });

    expect(isProviderAuthError(error)).toBe(true);
  });

  it('uses the shared HTTP status classification vocabulary', () => {
    expect(ConnectorError.kindForStatus(401)).toBe(providerErrorKindForStatus(401));
    expect(ConnectorError.kindForStatus(429)).toBe(providerErrorKindForStatus(429));
    expect(ConnectorError.kindForStatus(500)).toBe(providerErrorKindForStatus(500));
  });

  it('preserves ConnectorError identity while lifting it into the domain error contract', () => {
    const cause = new Error('socket closed');
    const error = new ConnectorError('Linear throttled the sync', {
      provider: 'linear',
      kind: 'rate_limit',
      status: 429,
      retryAfterSeconds: 10,
      cause,
    });

    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.name).toBe('ConnectorError');
    expect(error.provider).toBe('linear');
    expect(error.kind).toBe('rate_limit');
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(10);
    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(true);
    expect(ConnectorError.kindForStatus(403)).toBe('auth');
    expect(isConnectorError(error)).toBe(true);
    expect(isProviderAuthError(error)).toBe(false);
  });
});
