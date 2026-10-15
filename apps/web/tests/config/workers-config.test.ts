import { readFileSync } from 'node:fs';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';
import { readWorkerRuntimeConfig } from '../../worker-runtime-config';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Workers provider configuration', () => {
  it('uses the source Worker and native OpenNext assets directly', () => {
    const source: unknown = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(source).toMatchObject({
      main: 'worker.ts',
      assets: { directory: '.open-next/assets', binding: 'ASSETS', run_worker_first: true },
      compatibility_flags: expect.arrayContaining([
        'nodejs_compat',
        'global_fetch_strictly_public',
      ]),
    });
  });

  it('enforces the Publishing production guard outside Vercel', async () => {
    vi.stubEnv('API_URL', 'https://api.example.test');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test');
    vi.stubEnv('STUDIO_DEPLOYMENT_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_BRIEF_HOST', '');
    vi.resetModules();
    await expect(import('../../next.config')).rejects.toThrow('NEXT_PUBLIC_BRIEF_HOST is required');
  });

  it('keeps the native image TTL aligned with the product preservation shim', () => {
    expect(imageConfigDefault.minimumCacheTTL).toBe(14_400);
    expect(readFileSync('worker.ts', 'utf8')).toContain('public, max-age=14400, must-revalidate');
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
          vars: {
            STUDIO_DEPLOYMENT_ENV: 'production',
            WEB_URL: 'https://clearthedocket.com',
            API_URL: 'https://api.clearthedocket.com',
            PUBLIC_BRIEF_HOST: 'briefs.clearthedocket.com',
            BETTER_AUTH_PASSKEY_RP_ID: 'clearthedocket.com',
            BETTER_AUTH_PASSKEY_LEGACY_RP_ID: 'hypertext.studio',
            DOCS_MINTLIFY_ORIGIN: 'https://docket.mintlify.dev',
          },
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
    const production = (config as { env: { production: { vars: Record<string, unknown> } } }).env
      .production;
    expect(readWorkerRuntimeConfig(production.vars)).toMatchObject({
      apiOrigin: 'https://api.clearthedocket.com',
      appOrigin: 'https://clearthedocket.com',
      briefHostname: 'briefs.clearthedocket.com',
      legacyRpHostname: 'hypertext.studio',
      local: false,
    });
  });
});
