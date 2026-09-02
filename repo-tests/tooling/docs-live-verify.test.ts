/**
 * The post-deployment documentation check.
 *
 * @remarks
 * The behaviour under test is a split: documentation failures fail the run, everything else on the
 * public production surface is reported without failing it. The retry loop exists for one specific
 * race — Vercel promotes the web build only after the release's API check passes — so the tests
 * pin both that it waits and that waiting cannot rescue a genuinely broken origin.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  formatReport,
  pollDocs,
  verifyDocsLive,
  type DocsVerificationOptions,
} from '../../scripts/docs-live-verify';
import { checkDocs, DOCS_CHECK_NAMES } from '../../scripts/production-verify';

const APP = 'https://docket.hypertext.studio';
const API = 'https://docket-api.hypertext.studio';

function response(body: string, init: ResponseInit, url: string): Response {
  const value = new Response(body, init);
  Object.defineProperty(value, 'url', { value: url });
  return value;
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** Every response a fully healthy production returns, keyed by request URL. */
function healthyResponses(): Record<string, Response> {
  return {
    [APP]: response('<script src="/_next/static/chunks/app.js"></script>', { status: 200 }, APP),
    [`${APP}/docs`]: response(
      '<title>What Docket is</title>',
      { status: 200 },
      `${APP}/docs/guides/what-docket-is`,
    ),
    [`${APP}/docs/llms.txt`]: response(
      'x'.repeat(1000),
      { status: 200, headers: { 'content-type': 'text/plain' } },
      `${APP}/docs/llms.txt`,
    ),
    [`${APP}/docs/llms-full.txt`]: response(
      'x'.repeat(20_000),
      { status: 200, headers: { 'content-type': 'text/plain' } },
      `${APP}/docs/llms-full.txt`,
    ),
    [`${APP}/_next/static/chunks/app.js`]: response(
      'compiled',
      { status: 200, headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      `${APP}/_next/static/chunks/app.js`,
    ),
    [`${API}/v1/health`]: response(
      JSON.stringify({ status: 'ok' }),
      { status: 200 },
      `${API}/v1/health`,
    ),
    [`${API}/v1/config`]: response(
      JSON.stringify({ appMode: 'production', mcpUrl: `${API}/mcp` }),
      { status: 200 },
      `${API}/v1/config`,
    ),
    [`${API}/v1/openapi.json`]: response(
      JSON.stringify({
        info: { title: 'Docket API' },
        servers: [{ url: API }],
        paths: Object.fromEntries(
          Array.from({ length: 300 }, (_, index) => [`/v1/path-${index}`, {}]),
        ),
      }),
      { status: 200 },
      `${API}/v1/openapi.json`,
    ),
    [`${API}/v1/docs`]: response(
      '<script>openapi.json</script>',
      { status: 200 },
      `${API}/v1/docs`,
    ),
    [`${API}/.well-known/oauth-authorization-server/api/auth`]: response(
      JSON.stringify({ issuer: `${API}/api/auth` }),
      { status: 200 },
      `${API}/.well-known/oauth-authorization-server/api/auth`,
    ),
    [`${API}/.well-known/oauth-protected-resource/mcp`]: response(
      JSON.stringify({ resource: `${API}/mcp` }),
      { status: 200 },
      `${API}/.well-known/oauth-protected-resource/mcp`,
    ),
  };
}

/**
 * The gateway error Vercel returns when a rewrite destination has no DNS record: a plain-text body
 * on the requested URL, with no redirect to a canonical documentation page.
 */
function unresolvedRewrite(url: string): Response {
  return response('DNS_HOSTNAME_NOT_FOUND', { status: 502 }, url);
}

/**
 * A fetcher over healthy production, with the named URLs overridden.
 *
 * @remarks
 * The response set is rebuilt per request rather than shared. A `Response` body can be read only
 * once, and the retry loop reads the same URL on every attempt — a shared set would make the second
 * probe fail on a disturbed stream and look exactly like a site that never came up.
 */
function fetcherWith(overrides: (url: string) => Response | null) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = requestUrl(input);
    return overrides(url) ?? healthyResponses()[url] ?? response('missing', { status: 404 }, url);
  });
}

/** Options that keep the retry loop instant and count how often it waited. */
function instantRetries(attempts: number): DocsVerificationOptions & { waits: number[] } {
  const waits: number[] = [];
  return {
    attempts,
    delayMs: 30_000,
    waits,
    sleep: async (milliseconds: number) => {
      waits.push(milliseconds);
    },
  };
}

describe('documentation gating list', () => {
  it('names every check the documentation probe produces', async () => {
    const checks = await checkDocs(fetcherWith(() => null));

    expect(checks.map((check) => check.name)).toEqual([...DOCS_CHECK_NAMES]);
  });
});

describe('polling for the web promotion', () => {
  it('passes on the first probe and never waits when docs are already live', async () => {
    const options = instantRetries(10);

    const result = await pollDocs(
      fetcherWith(() => null),
      options,
    );

    expect(result.attempts).toBe(1);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    expect(options.waits).toEqual([]);
  });

  it('keeps probing while Vercel is still promoting the web build', async () => {
    let probes = 0;
    const fetcher = fetcherWith((url) => {
      if (url !== `${APP}/docs`) return null;
      probes += 1;
      return probes < 3 ? response('', { status: 503 }, url) : null;
    });
    const options = instantRetries(10);

    const result = await pollDocs(fetcher, options);

    expect(result.attempts).toBe(3);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    expect(options.waits).toEqual([30_000, 30_000]);
  });

  it('gives up after the configured attempts when the rewrite destination does not resolve', async () => {
    const options = instantRetries(4);

    const result = await pollDocs(
      fetcherWith((url) => (url.startsWith(`${APP}/docs`) ? unresolvedRewrite(url) : null)),
      options,
    );

    expect(result.attempts).toBe(4);
    expect(result.checks.find((check) => check.name === 'docs')?.passed).toBe(false);
    expect(options.waits).toHaveLength(3);
  });
});

describe('what fails the run', () => {
  it('passes when the whole public surface is healthy', async () => {
    const report = await verifyDocsLive(
      fetcherWith(() => null),
      instantRetries(1),
    );

    expect(report.passed).toBe(true);
    expect(report.gating.map((check) => check.name)).toEqual([...DOCS_CHECK_NAMES]);
    expect(report.advisory.every((check) => check.passed)).toBe(true);
  });

  it('fails when the documentation site is unreachable', async () => {
    const report = await verifyDocsLive(
      fetcherWith((url) => (url.startsWith(`${APP}/docs`) ? unresolvedRewrite(url) : null)),
      instantRetries(2),
    );

    expect(report.passed).toBe(false);
    expect(report.gating.filter((check) => check.passed)).toEqual([]);
  });

  it('fails when the machine-readable indexes are served but truncated', async () => {
    const report = await verifyDocsLive(
      fetcherWith((url) =>
        url === `${APP}/docs/llms-full.txt`
          ? response('too short', { status: 200, headers: { 'content-type': 'text/plain' } }, url)
          : null,
      ),
      instantRetries(2),
    );

    expect(report.passed).toBe(false);
    expect(report.gating.find((check) => check.name === 'llms-full')?.passed).toBe(false);
  });

  it('reports an API-contract regression without failing the run', async () => {
    const report = await verifyDocsLive(
      fetcherWith((url) =>
        url === `${API}/v1/openapi.json` ? response('', { status: 500 }, url) : null,
      ),
      instantRetries(1),
    );

    expect(report.passed).toBe(true);
    expect(report.advisory.find((check) => check.name === 'openapi')?.passed).toBe(false);
    expect(report.gating.every((check) => check.passed)).toBe(true);
  });

  it('keeps no documentation check on the advisory side', async () => {
    const report = await verifyDocsLive(
      fetcherWith(() => null),
      instantRetries(1),
    );

    expect(report.advisory.map((check) => check.name)).not.toContain('docs');
    expect(report.advisory.map((check) => check.name)).toEqual(
      expect.arrayContaining(['app', 'api-health', 'immutable-asset']),
    );
  });
});

describe('report rendering', () => {
  it('marks gating failures FAIL and advisory failures WARN', () => {
    const text = formatReport({
      generatedAt: '2026-09-02T20:00:00.000Z',
      passed: false,
      attempts: 3,
      gating: [{ name: 'docs', passed: false, detail: 'HTTP 502' }],
      advisory: [
        { name: 'app', passed: true, detail: 'primary app returned 200' },
        { name: 'openapi', passed: false, detail: 'HTTP 500' },
      ],
    });

    expect(text).toContain('settled after 3 attempt(s)');
    expect(text).toContain('FAIL\tdocs\tHTTP 502');
    expect(text).toContain('PASS\tapp\tprimary app returned 200');
    expect(text).toContain('WARN\topenapi\tHTTP 500');
  });
});
