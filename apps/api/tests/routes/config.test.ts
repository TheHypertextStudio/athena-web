import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PublicConfigOut } from '@docket/identity-access/public-config-contract';

import type configRouter from '../../src/routes/config';
import { appWithSession } from '../support/routes-harness';

let config!: typeof configRouter;

beforeAll(async () => {
  config = (await import('../../src/routes/config')).default;
});

describe('GET /config', () => {
  it('is public (no session) and returns a valid, env-derived PublicConfig', async () => {
    const app = appWithSession(config, null);
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = PublicConfigOut.parse(await res.json());
    // The test env configures no OAuth credentials, so nothing is offered — and crucially there is
    // no fabricated availability: the list reflects only real, configured providers.
    expect(body.appMode).toBe('test');
    expect(body.oauthProviders).toEqual([]);
    expect(body.googleServerClientId).toBeNull();
    expect(body.connectors).toEqual([]);
    expect(body.stripePublishableKey).toBeNull();
  });

  it('exposes the Google server client ID when native Google sign-in is offerable', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'native-client.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'configured-secret');
    vi.resetModules();
    try {
      const freshConfig = (await import('../../src/routes/config')).default;
      const app = appWithSession(freshConfig, null);
      const res = await app.request('/', { method: 'GET' });
      const body = PublicConfigOut.parse(await res.json());

      expect(body.googleServerClientId).toBe('native-client.apps.googleusercontent.com');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('withholds the Google server client ID behind the production-public gate', async () => {
    const { resolveGoogleServerClientId } = await import('../../src/routes/config');

    expect(
      resolveGoogleServerClientId(
        {
          APP_MODE: 'production',
          GOOGLE_CLIENT_ID: 'native-client.apps.googleusercontent.com',
          GOOGLE_OAUTH_PUBLIC: false,
        },
        ['google'],
      ),
    ).toBeNull();
  });

  it('returns the browser-safe Stripe key from runtime API configuration', async () => {
    vi.stubEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_runtime');
    vi.resetModules();
    try {
      const freshConfig = (await import('../../src/routes/config')).default;
      const app = appWithSession(freshConfig, null);
      const res = await app.request('/', { method: 'GET' });
      const body = PublicConfigOut.parse(await res.json());
      expect(body.stripePublishableKey).toBe('pk_test_runtime');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
