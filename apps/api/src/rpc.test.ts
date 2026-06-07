import { hc } from 'hono/client';
import { describe, expect, it } from 'vitest';

import type { AppType } from './app';

describe('rpc contract', () => {
  it('hc<AppType> exposes the typed orgs routes (RPC seam alive)', () => {
    const client = hc<AppType>('http://localhost');
    // These references fail typecheck if the router chain (AppType) is broken.
    expect(typeof client.v1.orgs.$get).toBe('function');
    expect(typeof client.v1.orgs.$post).toBe('function');
  });
});
