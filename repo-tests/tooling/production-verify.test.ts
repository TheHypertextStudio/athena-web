import { describe, expect, it, vi } from 'vitest';

import { verifyProduction } from '../../scripts/production-verify';

function response(body: BodyInit, init: ResponseInit, url: string): Response {
  const value = new Response(body, init);
  Object.defineProperty(value, 'url', { value: url });
  return value;
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

describe('production verification', () => {
  it('checks the primary app, docs, API contract, auth metadata, and immutable assets', async () => {
    const app = 'https://docket.hypertext.studio';
    const api = 'https://docket-api.hypertext.studio';
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      const responses: Record<string, Response> = {
        [app]: response(
          '<script src="/_next/static/chunks/app.js"></script>',
          { status: 200 },
          app,
        ),
        [`${app}/docs`]: response(
          '<title>What Docket is</title>',
          { status: 200 },
          `${app}/docs/guides/what-docket-is`,
        ),
        [`${app}/docs/llms.txt`]: response(
          'x'.repeat(1000),
          { status: 200, headers: { 'content-type': 'text/plain' } },
          `${app}/docs/llms.txt`,
        ),
        [`${app}/docs/llms-full.txt`]: response(
          'x'.repeat(20_000),
          { status: 200, headers: { 'content-type': 'text/plain' } },
          `${app}/docs/llms-full.txt`,
        ),
        [`${app}/_next/static/chunks/app.js`]: response(
          'compiled',
          { status: 200, headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
          `${app}/_next/static/chunks/app.js`,
        ),
        [`${api}/v1/health`]: response(
          JSON.stringify({ status: 'ok' }),
          { status: 200 },
          `${api}/v1/health`,
        ),
        [`${api}/v1/config`]: response(
          JSON.stringify({ appMode: 'production', mcpUrl: `${api}/mcp` }),
          { status: 200 },
          `${api}/v1/config`,
        ),
        [`${api}/v1/openapi.json`]: response(
          JSON.stringify({
            info: { title: 'Docket API' },
            servers: [{ url: api }],
            paths: Object.fromEntries(
              Array.from({ length: 300 }, (_, index) => [`/v1/path-${index}`, {}]),
            ),
          }),
          { status: 200 },
          `${api}/v1/openapi.json`,
        ),
        [`${api}/v1/docs`]: response(
          '<script>openapi.json</script>',
          { status: 200 },
          `${api}/v1/docs`,
        ),
        [`${api}/.well-known/oauth-authorization-server/api/auth`]: response(
          JSON.stringify({ issuer: `${api}/api/auth` }),
          { status: 200 },
          `${api}/.well-known/oauth-authorization-server/api/auth`,
        ),
        [`${api}/.well-known/oauth-protected-resource/mcp`]: response(
          JSON.stringify({ resource: `${api}/mcp` }),
          { status: 200 },
          `${api}/.well-known/oauth-protected-resource/mcp`,
        ),
      };
      return responses[url] ?? response('missing', { status: 404 }, url);
    });

    const report = await verifyProduction(fetcher);

    expect(report.passed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  it('fails when docs redirect to a demo path or OpenAPI is unavailable', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.endsWith('/docs')) return response('demo', { status: 200 }, `${url}/demo`);
      return response('unavailable', { status: 503 }, url);
    });

    const report = await verifyProduction(fetcher);

    expect(report.passed).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'docs', passed: false }),
        expect.objectContaining({ name: 'openapi', passed: false }),
      ]),
    );
  });
});
