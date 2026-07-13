import { describe, expect, it } from 'vitest';

import { anthropicConfigFromEnv } from '../src/container';

describe('anthropicConfigFromEnv', () => {
  it('uses Gateway only when both Gateway settings are present', () => {
    expect(
      anthropicConfigFromEnv({
        ANTHROPIC_API_KEY: 'sk-ant-provider',
        CLOUDFLARE_AI_GATEWAY_BASE_URL:
          'https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic',
        CLOUDFLARE_AI_GATEWAY_TOKEN: 'cf-token',
      }),
    ).toEqual({
      apiKey: 'sk-ant-provider',
      baseURL: 'https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic',
      gatewayToken: 'cf-token',
    });
  });
});
