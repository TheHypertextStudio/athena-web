import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['API_URL'] = 'https://docket-api.hypertext.studio';
  process.env['NEXT_PUBLIC_APP_URL'] = 'https://docket.hypertext.studio';
});

import nextConfig from '../../next.config';

afterEach(() => vi.unstubAllEnvs());

async function configuredRewrites() {
  return nextConfig.rewrites?.();
}

describe('canonical production host redirects', () => {
  it.each(['https://clearthedocket.com', 'https://app.example.test'])(
    'redirects the legacy Athena OAuth request directly to configured origin %s',
    async (origin) => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
      const response = await unstable_getResponseFromNextConfig({
        url: 'https://athena.hypertext.studio/api/auth/callback/github?code=fixture&state=fixture',
        nextConfig,
      });

      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe(
        `${origin}/api/auth/callback/github?code=fixture&state=fixture`,
      );
    },
  );

  it('proxies the GitHub App setup callback through the canonical product origin', async () => {
    await expect(configuredRewrites()).resolves.toEqual(
      expect.arrayContaining([
        {
          source: '/internal/integrations/github/:path*',
          destination: 'https://docket-api.hypertext.studio/internal/integrations/github/:path*',
        },
      ]),
    );
  });
});
