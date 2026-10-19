import { randomBytes } from 'node:crypto';

import { expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  authorizationCode,
  exchangeCode,
  readOrganizations,
} from './oauth-ceremony.postgres.protocol';
import { controlB, origin, registerPublicClient, request } from './oauth-ceremony.postgres.runtime';

const tokenPair = z.looseObject({ access_token: z.string(), refresh_token: z.string() });

it('recovers lost device saves with fresh access under the PostgreSQL client lock', async () => {
  const client = await registerPublicClient();
  const resource = `${origin}/v1`;
  const code = await authorizationCode(client, resource, 'device-recovery', true);
  const initial = await exchangeCode(client, code, resource);
  const key = randomBytes(32).toString('base64url');
  const refresh = () =>
    request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Docket-Refresh-Recovery': key,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: client.clientId,
        refresh_token: initial.refreshToken,
        resource,
      }),
    });
  const rotated = await refresh();
  expect(rotated.status, await rotated.clone().text()).toBe(200);
  const first = tokenPair.parse(await rotated.json());
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(Date.now() + 16 * 60_000);
    const responses = await Promise.all([refresh(), refresh()]);
    for (const response of responses)
      expect(response.status, await response.clone().text()).toBe(200);
    const values = await Promise.all(
      responses.map(async (response) => tokenPair.parse(await response.json())),
    );
    expect(values[0]?.refresh_token).toBe(values[1]?.refresh_token);
    expect(values[0]?.refresh_token).not.toBe(first.refresh_token);
    const accessToken = values[0]?.access_token;
    if (!accessToken) throw new Error('Missing recovered access credential.');
    expect((await readOrganizations(accessToken)).status).toBe(200);
    const rows = await controlB<{ count: number }[]>`
      select count(*)::int as count from oauth_refresh_token
      where client_id = ${client.clientId} and revoked is null
    `;
    expect(rows).toEqual([{ count: 1 }]);
  } finally {
    vi.useRealTimers();
  }
});
