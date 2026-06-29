import { beforeAll, describe, expect, it } from 'vitest';

import { PublicConfigOut } from '@docket/types';

import type configRouter from '../../src/routes/config';
import { appWithSession } from './harness.test';

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
});
