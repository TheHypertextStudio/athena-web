/** Retained Workers artifact parity through the existing disposable release stack. */
import { expect, test } from '../helpers/fixtures';

test('rejects an unmarked local Worker as an accepted release', async ({ request }) => {
  const response = await request.get('/__studio/release');
  if (process.env['RELEASE_WEB_RUNTIME'] !== 'workers') {
    expect(response.status()).toBe(404);
    return;
  }
  expect(response.status()).toBe(503);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({ status: 'unavailable' });
});

test('serves dynamic health and preserves security headers', async ({ request }) => {
  const response = await request.get('/healthz');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', service: 'docket-web' });
  expect(response.headers()['content-security-policy']).toBe("frame-ancestors 'none'");
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
});

test('preserves the Node Proxy signed-out gate and legacy settings redirect', async ({
  request,
}) => {
  const protectedResponse = await request.get('/today', { maxRedirects: 0 });
  expect(protectedResponse.status()).toBe(307);
  const target = new URL(protectedResponse.headers()['location'] ?? '', process.env['APP_URL']);
  expect(target.origin).toBe(process.env['APP_URL']);
  expect(target.pathname).toBe('/sign-in');
  expect(target.searchParams.get('callbackURL')).toBe('/today');
  const legacy = await request.get('/orgs/synthetic/settings/security', { maxRedirects: 0 });
  expect(legacy.status()).toBe(307);
  expect(new URL(legacy.headers()['location'] ?? '', process.env['APP_URL']).pathname).toBe(
    '/settings/security',
  );
});

test('preserves service-worker freshness and native association JSON', async ({ request }) => {
  const worker = await request.get('/sw.js');
  expect(worker.status()).toBe(200);
  expect(worker.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
  const association = await request.get('/.well-known/apple-app-site-association');
  expect(association.status()).toBe(200);
  expect(association.headers()['content-type']).toContain('application/json');
  expect(await association.json()).toHaveProperty('webcredentials');
});

test('retains native Images negotiation and the existing four-hour cache lifetime', async ({
  request,
}) => {
  const image = await request.get('/_next/image?url=%2Fmarketing%2Ftoday.jpg&w=640&q=75', {
    headers: { Accept: 'image/webp' },
  });
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toContain('image/webp');
  expect(image.headers()['vary']).toContain('Accept');
  expect(image.headers()['cache-control']).toBe('public, max-age=14400, must-revalidate');
});

test('delegates Mintlify documents and assets while preserving the upstream CSP', async ({
  request,
}) => {
  const origin = process.env['DOCS_MINTLIFY_ORIGIN'] ?? 'https://docket.mintlify.dev';
  const upstream = await request.get(`${origin}/docs`);
  const docs = await request.get('/docs');
  expect(upstream.status()).toBe(200);
  expect(docs.status()).toBe(upstream.status());
  expect(docs.headers()['content-security-policy']).toBe(
    upstream.headers()['content-security-policy'],
  );
  const html = await docs.text();
  expect(html).toContain('Mintlify');
  const asset = /(?:src|href)=["']([^"']*\/_mintlify\/[^"']+)["']/.exec(html)?.[1];
  expect(asset).toBeTruthy();
  const path = new URL(asset ?? '', process.env['APP_URL']);
  const response = await request.get(path.pathname + path.search);
  expect(response.status()).toBe(200);
});
