import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSession, verifyAccessToken } from '../support/auth-mock';
import type { server as RootServer } from '../../src/server';
import { API_REVISION, API_VERSION } from '../../src/api-version';

const container = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('../../src/container', () => ({ getContainer: container }));
vi.mock('@hono/node-server', () => ({ serve: vi.fn(() => ({ close: vi.fn() })) }));

describe('production root server version ordering', () => {
  let server: typeof RootServer;
  beforeAll(async () => {
    server = (await import('../../src/server')).server;
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    '/v1/orgs/example/tasks',
    '/v1/stream/sse',
    '/v1/me/account/exports/example/file',
    '/v1/public/briefs/example/example',
    '/v1/public/time/status',
  ])(
    'rejects %s before the real composition can authenticate or resolve services',
    async (path) => {
      const response = await server.request(path, {
        method: 'GET',
        headers: { 'Docket-Version': 'latest', Authorization: 'Bearer example' },
      });
      expect(response.status).toBe(400);
      expect(getSession).not.toHaveBeenCalled();
      expect(verifyAccessToken).not.toHaveBeenCalled();
      expect(container).not.toHaveBeenCalled();
    },
  );

  it('canonicalizes a public URL before rejecting its version assertion', async () => {
    const response = await server.request('/v1/orgs/?limit=10', {
      headers: { 'Docket-Version': 'latest', Origin: 'https://docket.localhost' },
    });
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('http://localhost/v1/orgs?limit=10');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://docket.localhost');
    expect(response.headers.get('Docket-Version')).toBe(API_VERSION);
    expect(response.headers.get('Docket-Revision')).toBe(API_REVISION);
    expect(getSession).not.toHaveBeenCalled();
    expect(container).not.toHaveBeenCalled();
  });
});
