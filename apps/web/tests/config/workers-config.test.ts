import { readFileSync } from 'node:fs';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';
import { workerHostRedirect } from '../../worker-gateway';
import { readWorkerRuntimeConfig } from '../../worker-runtime-config';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Workers provider configuration', () => {
  it('redirects the legacy Athena alias directly to the configured canonical app', () => {
    const config = readWorkerRuntimeConfig({
      STUDIO_DEPLOYMENT_ENV: 'production',
      WEB_URL: 'https://clearthedocket.com',
      API_URL: 'https://api.clearthedocket.com',
      PUBLIC_BRIEF_HOST: 'briefs.clearthedocket.com',
      BETTER_AUTH_PASSKEY_RP_ID: 'clearthedocket.com',
      BETTER_AUTH_PASSKEY_LEGACY_RP_ID: 'hypertext.studio',
    });
    const response = workerHostRedirect(
      new URL(
        'https://athena.hypertext.studio/api/auth/callback/github?code=fixture&state=fixture',
      ),
      config,
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get('location')).toBe(
      'https://clearthedocket.com/api/auth/callback/github?code=fixture&state=fixture',
    );
  });

  it('preserves the existing exact www alias redirect without capturing other hosts', () => {
    const config = readWorkerRuntimeConfig({
      STUDIO_DEPLOYMENT_ENV: 'production',
      WEB_URL: 'https://clearthedocket.com',
      API_URL: 'https://api.clearthedocket.com',
      PUBLIC_BRIEF_HOST: 'briefs.clearthedocket.com',
      BETTER_AUTH_PASSKEY_RP_ID: 'clearthedocket.com',
      BETTER_AUTH_PASSKEY_LEGACY_RP_ID: 'hypertext.studio',
    });
    const response = workerHostRedirect(
      new URL('https://www.clearthedocket.com/sign-in?callbackURL=%2Ftoday'),
      config,
    );
    expect(response?.status).toBe(308);
    expect(response?.headers.get('location')).toBe(
      'https://clearthedocket.com/sign-in?callbackURL=%2Ftoday',
    );
    expect(response?.headers.get('x-content-type-options')).toBe('nosniff');
    for (const host of [
      'clearthedocket.com',
      'api.clearthedocket.com',
      'briefs.clearthedocket.com',
      'www.briefs.clearthedocket.com',
      'www.customer.example',
    ]) {
      expect(workerHostRedirect(new URL(`https://${host}/sign-in`), config)).toBeUndefined();
    }
    expect(
      workerHostRedirect(
        new URL('http://www.clearthedocket.com/docs?from=www'),
        config,
      )?.headers.get('location'),
    ).toBe('https://clearthedocket.com/docs?from=www');
  });

  it('preserves the old application redirect without capturing canonical or recovery hosts', () => {
    const values = {
      STUDIO_DEPLOYMENT_ENV: 'production',
      WEB_URL: 'https://clearthedocket.com',
      API_URL: 'https://api.clearthedocket.com',
      PUBLIC_BRIEF_HOST: 'briefs.clearthedocket.com',
      BETTER_AUTH_PASSKEY_RP_ID: 'clearthedocket.com',
      BETTER_AUTH_PASSKEY_LEGACY_RP_ID: 'hypertext.studio',
    };
    const config = readWorkerRuntimeConfig(values);
    const alias = new URL('https://docket.hypertext.studio/sign-in?callbackURL=%2Ftoday');
    const response = workerHostRedirect(alias, config);
    expect(response?.status).toBe(308);
    expect(response?.headers.get('location')).toBe(
      'https://clearthedocket.com/sign-in?callbackURL=%2Ftoday',
    );
    expect(response?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(
      workerHostRedirect(
        new URL('https://hypertext.studio/.well-known/apple-app-site-association'),
        config,
      ),
    ).toBeUndefined();
    expect(
      workerHostRedirect(
        alias,
        readWorkerRuntimeConfig({
          ...values,
          WEB_URL: 'https://docket.hypertext.studio',
          BETTER_AUTH_PASSKEY_RP_ID: 'docket.hypertext.studio',
        }),
      ),
    ).toBeUndefined();
    expect(
      workerHostRedirect(
        alias,
        readWorkerRuntimeConfig({ ...values, BETTER_AUTH_PASSKEY_RP_ID: 'hypertext.studio' }),
      ),
    ).toBeUndefined();
    expect(
      workerHostRedirect(
        alias,
        readWorkerRuntimeConfig({
          STUDIO_DEPLOYMENT_ENV: 'staging',
          WEB_URL: 'https://docket-staging.hypertext.studio',
          API_URL: 'https://docket-api-staging-770668668034.us-central1.run.app',
          BETTER_AUTH_PASSKEY_RP_ID: 'docket-staging.hypertext.studio',
        }),
      ),
    ).toBeUndefined();
  });

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
