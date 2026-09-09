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
    expect(body.appleAppClientId).toBeNull();
    expect(body.passkeyRpId).toBe('docket.localhost');
    expect(body.legacyPasskeyRpId).toBeNull();
    expect(body.googleServerClientId).toBeNull();
    expect(body.connectors).toEqual([]);
    expect(body.stripePublishableKey).toBeNull();
  });

  it('exposes the native Apple app id only when Apple sign-in is configured', async () => {
    const { resolveAppleAppClientId } = await import('../../src/routes/config');

    expect(
      resolveAppleAppClientId({ APPLE_APP_CLIENT_ID: 'studio.hypertext.docket' }, ['apple']),
    ).toBe('studio.hypertext.docket');
    expect(
      resolveAppleAppClientId({ APPLE_APP_CLIENT_ID: 'studio.hypertext.docket' }, []),
    ).toBeNull();
  });

  it('exposes a distinct configured legacy passkey RP and hides every inactive value', async () => {
    const { resolveLegacyPasskeyRpId } = await import('../../src/routes/config');

    expect(
      resolveLegacyPasskeyRpId({
        BETTER_AUTH_PASSKEY_RP_ID: 'clearthedocket.com',
        BETTER_AUTH_PASSKEY_LEGACY_RP_ID: 'docket.hypertext.studio',
      }),
    ).toBe('docket.hypertext.studio');
    expect(
      resolveLegacyPasskeyRpId({
        BETTER_AUTH_PASSKEY_RP_ID: 'clearthedocket.com',
        BETTER_AUTH_PASSKEY_LEGACY_RP_ID: 'clearthedocket.com',
      }),
    ).toBeNull();
    expect(
      resolveLegacyPasskeyRpId({
        BETTER_AUTH_PASSKEY_RP_ID: 'clearthedocket.com',
      }),
    ).toBeNull();
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
