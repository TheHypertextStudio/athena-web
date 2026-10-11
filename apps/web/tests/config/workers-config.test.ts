import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Workers provider configuration', () => {
  it('enforces the Publishing production guard outside Vercel', async () => {
    vi.stubEnv('API_URL', 'https://api.example.test');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test');
    vi.stubEnv('STUDIO_DEPLOYMENT_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_BRIEF_HOST', '');
    vi.resetModules();
    await expect(import('../../next.config')).rejects.toThrow('NEXT_PUBLIC_BRIEF_HOST is required');
  });

  it('declares separate native Images and cache bindings for each environment', () => {
    const config: unknown = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(config).toMatchObject({
      workers_dev: false,
      preview_urls: false,
      compatibility_flags: expect.arrayContaining(['nodejs_compat']),
      env: {
        staging: {
          images: { binding: 'IMAGES' },
          r2_buckets: [
            {
              binding: 'NEXT_INC_CACHE_R2_BUCKET',
              bucket_name: 'docket-web-staging-cache',
              remote: false,
            },
          ],
        },
        production: {
          images: { binding: 'IMAGES' },
          r2_buckets: [
            {
              binding: 'NEXT_INC_CACHE_R2_BUCKET',
              bucket_name: 'docket-web-production-cache',
              remote: false,
            },
          ],
        },
      },
    });
  });
});
