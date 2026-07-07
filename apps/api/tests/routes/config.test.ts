import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PublicConfigOut } from '@docket/types';

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
    expect(body.connectors).toEqual([]);
  });

  // Runs last: resets the module registry to pick up the stubbed env, which would orphan any
  // shared DB proxy other tests in this file depended on — this file has none.
  it('surfaces outlook once MICROSOFT_CLIENT_ID/SECRET are configured (M6: dormant until env values exist)', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'ms-client-id-123');
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'ms-client-secret-456');
    vi.resetModules();
    try {
      const freshConfig = (await import('../../src/routes/config')).default;
      const app = appWithSession(freshConfig, null);
      const res = await app.request('/', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = PublicConfigOut.parse(await res.json());
      expect(body.oauthProviders).toContain('microsoft');
      expect(body.connectors).toContain('outlook');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
