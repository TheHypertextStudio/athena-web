import { readFileSync } from 'node:fs';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';

import { assertWorkerArtifactConfig } from '../../worker-artifact-config';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Workers provider configuration', () => {
  it('keeps a prebuilt deployment configuration available before the build', () => {
    const source: unknown = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    const prebuilt: unknown = JSON.parse(readFileSync('wrangler.site.jsonc', 'utf8'));
    expect(() => {
      assertWorkerArtifactConfig(source, prebuilt);
    }).not.toThrow();
    expect(() => {
      assertWorkerArtifactConfig(source, { ...(prebuilt as object), images: undefined });
    }).toThrow('Prebuilt Workers configuration drifted');
    expect(() => {
      assertWorkerArtifactConfig(null, prebuilt);
    }).toThrow('Workers source configuration must be an object');
    expect(prebuilt).toEqual({
      ...(source as Record<string, unknown>),
      main: 'worker.js',
      no_bundle: true,
      find_additional_modules: true,
      base_dir: '.',
      rules: [
        { type: 'ESModule', globs: ['*.js', '*.mjs'], fallthrough: true },
        { type: 'CompiledWasm', globs: ['*.wasm'], fallthrough: true },
        { type: 'Data', globs: ['*.bin'], fallthrough: true },
      ],
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
