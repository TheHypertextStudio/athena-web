import { describe, expect, it } from 'vitest';

import { anthropicClientOptions, wrapAnthropicError } from '../src/anthropic';

describe('Athena Anthropic boundary', () => {
  it('adds AI-gateway authorization without replacing the provider key', () => {
    expect(
      anthropicClientOptions({
        apiKey: 'sk-ant-provider',
        baseURL: 'https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic',
        gatewayToken: 'cf-token',
      }),
    ).toEqual({
      apiKey: 'sk-ant-provider',
      baseURL: 'https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic',
      defaultHeaders: { Authorization: 'Bearer cf-token' },
    });
  });

  it('reports errors with an operation label but never echoes unknown thrown values', () => {
    expect(wrapAnthropicError(new Error('connection reset'), 'digest').message).toBe(
      'Anthropic digest failed: connection reset',
    );
    expect(wrapAnthropicError({ apiKey: 'secret' }, 'digest').message).toBe(
      'Anthropic digest failed: unknown error',
    );
  });
});
