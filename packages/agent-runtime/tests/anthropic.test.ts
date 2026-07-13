import { describe, expect, it } from 'vitest';

import { anthropicClientOptions } from '../src/anthropic';

describe('anthropicClientOptions', () => {
  it('adds gateway authorization without replacing the Anthropic provider key', () => {
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
});
