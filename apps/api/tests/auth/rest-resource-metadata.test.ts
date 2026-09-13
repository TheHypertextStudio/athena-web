import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { restProtectedResourceMetadata } from '../../src/auth/rest-resource-metadata';

describe('REST protected-resource metadata', () => {
  it('publishes the path-derived REST resource, canonical issuer, and shared scope catalog', async () => {
    const app = new Hono();
    app.get('/.well-known/oauth-protected-resource/v1', restProtectedResourceMetadata);

    const response = await app.request(
      'https://api.docket.localhost/.well-known/oauth-protected-resource/v1',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: 'https://api.docket.localhost/v1',
      authorization_servers: ['https://api.docket.localhost/api/auth'],
      scopes_supported: [
        'work:read',
        'work:write',
        'agents:run',
        'connectors:link',
        'offline_access',
      ],
      bearer_methods_supported: ['header'],
    });
  });
});
