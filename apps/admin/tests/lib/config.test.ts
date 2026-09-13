import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAdminGoogleSso } from '../../src/lib/config';

const config = {
  appMode: 'production',
  oauthProviders: ['google'],
  appleAppClientId: null,
  passkeyRpId: 'clearthedocket.com',
  legacyPasskeyRpId: null,
  googleOAuthPublic: true,
  googleServerClientId: 'google-client',
  adminGoogleSso: true,
  stripePublishableKey: null,
  connectors: ['gmail', 'calendar', 'gtasks'],
  mcpUrl: 'https://api.clearthedocket.com/mcp',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAdminGoogleSso', () => {
  it('reads the validated public bootstrap config without a product API client', async () => {
    const fetch = vi.fn(async () => Response.json(config));
    vi.stubGlobal('fetch', fetch);

    await expect(fetchAdminGoogleSso()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith('/v1/config', { credentials: 'include' });
  });

  it('fails closed when the public config is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ adminGoogleSso: true })),
    );

    await expect(fetchAdminGoogleSso()).resolves.toBe(false);
  });
});
