import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../src/env';
import { latticeClientMetadata } from '../../src/routes/lattice-client-metadata';

const mutableEnv = env as {
  LATTICE_GATEWAY_URL: string | undefined;
  LATTICE_RESOURCE_URL: string | undefined;
};
const previousResource = mutableEnv.LATTICE_GATEWAY_URL;
const previousResourceId = mutableEnv.LATTICE_RESOURCE_URL;
afterEach(() => {
  mutableEnv.LATTICE_GATEWAY_URL = previousResource;
  mutableEnv.LATTICE_RESOURCE_URL = previousResourceId;
});

describe('Docket-owned Lattice client metadata', () => {
  it('publishes a public PKCE client with exact environment-owned endpoints and minimal scopes', async () => {
    mutableEnv.LATTICE_GATEWAY_URL = 'https://gateway.example.test';
    const response = await latticeClientMetadata.request('/.well-known/lattice-client.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(await response.json()).toEqual({
      client_id: new URL('/.well-known/lattice-client.json', env.WEB_URL).href,
      client_name: 'Docket',
      client_uri: env.WEB_URL,
      policy_uri: new URL('/privacy', env.WEB_URL).href,
      tos_uri: new URL('/terms', env.WEB_URL).href,
      redirect_uris: [new URL('/internal/integrations/lattice/callback', env.API_URL).href],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'openid offline_access lattice:compute:inference lattice:compute:catalog:read',
      resource: ['https://gateway.example.test'],
    });
  });

  it('does not advertise a usable client when the resource is unconfigured', async () => {
    mutableEnv.LATTICE_GATEWAY_URL = undefined;
    const response = await latticeClientMetadata.request('/.well-known/lattice-client.json');
    expect(response.status).toBe(503);
  });

  it('keeps the OAuth resource identifier separate from the callable gateway', async () => {
    mutableEnv.LATTICE_GATEWAY_URL = 'https://gateway.example.test';
    mutableEnv.LATTICE_RESOURCE_URL = 'https://resources.example.test/inference';
    const response = await latticeClientMetadata.request('/.well-known/lattice-client.json');
    expect(await response.json()).toMatchObject({
      resource: ['https://resources.example.test/inference'],
    });
  });
});
