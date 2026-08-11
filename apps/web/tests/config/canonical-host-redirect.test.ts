import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['API_URL'] = 'https://docket-api.hypertext.studio';
  process.env['NEXT_PUBLIC_APP_URL'] = 'https://docket.hypertext.studio';
});

import nextConfig from '../../next.config';

async function configuredRedirects() {
  return nextConfig.redirects?.();
}

async function configuredRewrites() {
  return nextConfig.rewrites?.();
}

describe('canonical production host redirects', () => {
  it('redirects the legacy Athena alias before it can proxy an OAuth request', async () => {
    await expect(configuredRedirects()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '/:path*',
          destination: 'https://docket.hypertext.studio/:path*',
          permanent: true,
          has: [{ type: 'host', value: 'athena\\.hypertext\\.studio' }],
        }),
      ]),
    );
  });

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
