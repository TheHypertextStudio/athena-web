import { beforeAll, describe, expect, it } from 'vitest';

import type * as GithubApp from '../../src/lib/github-app';

let app!: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let signInstallState!: typeof GithubApp.signInstallState;

beforeAll(async () => {
  app = (await import('../../src/routes/integrations-github')).default;
  ({ signInstallState } = await import('../../src/lib/github-app'));
});

/** The callback always bounces back to the web app's integration settings with a status flag. */
describe('GET /internal/integrations/github/callback', () => {
  it('redirects to the web root with ?github=error when no state is present', async () => {
    const res = await app.request('/callback');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/?github=error');
  });

  it('redirects with an error for a tampered/garbage state', async () => {
    const res = await app.request('/callback?state=garbage&installation_id=42');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('github=error');
  });

  it('redirects with an error when a valid state arrives without an installation_id', async () => {
    const state = signInstallState({ integrationId: 'intg_1', orgId: 'org_1' });
    const res = await app.request(`/callback?state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('github=error');
  });
});
