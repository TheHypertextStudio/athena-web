import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Wrangler belongs to the web workspace; run its native binding outside the browser test realm.
const { getPlatformProxy } = createRequire(resolve('apps/web/package.json'))('wrangler') as {
  getPlatformProxy: (options: {
    configPath: string;
    persist: false;
    remoteBindings: false;
    envFiles: [];
  }) => Promise<{ env: { ASSETS: { fetch: typeof fetch } }; dispose(): Promise<void> }>;
};

const root = mkdtempSync(join(tmpdir(), 'docket-static-assets-'));
let platform: Awaited<ReturnType<typeof getPlatformProxy>>;

beforeAll(async () => {
  const assets = join(root, 'assets');
  mkdirSync(join(assets, '_next/static/chunks'), { recursive: true });
  mkdirSync(join(assets, '_next/static/media'), { recursive: true });
  const headers = resolve('apps/web/public/_headers');
  if (existsSync(headers)) copyFileSync(headers, join(assets, '_headers'));
  for (const path of [
    '_next/static/chunks/1234-abcd1234.js',
    '_next/static/chunks/abcd1234.css',
    '_next/static/media/abcd1234.woff2',
    'manifest.webmanifest',
    'offline.html',
  ]) {
    writeFileSync(join(assets, path), 'asset-body');
  }
  writeFileSync(
    join(root, 'worker.js'),
    'export default { fetch(r, env) { return env.ASSETS.fetch(r); } };',
  );
  const configPath = join(root, 'wrangler.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      name: 'docket-static-assets-test',
      main: 'worker.js',
      compatibility_date: '2026-10-10',
      assets: { directory: assets, binding: 'ASSETS', run_worker_first: true },
    }),
  );
  platform = await getPlatformProxy({
    configPath,
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
}, 30_000);

afterAll(async () => {
  await platform.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe('native Worker static asset caching', () => {
  it.each([
    '/_next/static/chunks/1234-abcd1234.js',
    '/_next/static/chunks/abcd1234.css',
    '/_next/static/media/abcd1234.woff2',
  ])('serves fingerprinted asset %s with a one-year immutable policy', async (path) => {
    const response = await platform.env.ASSETS.fetch(`https://example.test${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('etag')).toBeTruthy();
    expect(await response.text()).toBe('asset-body');
  });

  it('preserves immutable caching on HEAD without returning a body', async () => {
    const response = await platform.env.ASSETS.fetch(
      'https://example.test/_next/static/chunks/1234-abcd1234.js',
      { method: 'HEAD' },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await response.text()).toBe('');
  });

  it.each(['/offline', '/manifest.webmanifest'])(
    'keeps mutable asset %s revalidated',
    async (path) => {
      const response = await platform.env.ASSETS.fetch(`https://example.test${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
      await response.body?.cancel();
    },
  );
});
