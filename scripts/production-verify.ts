/** Verify Docket's public production surface without signing in or changing production data. */
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const APP_ORIGIN = 'https://docket.hypertext.studio';
const API_ORIGIN = 'https://docket-api.hypertext.studio';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** One public production invariant and its result. */
export interface ProductionCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

/** Sanitized result of the public production verification pass. */
export interface ProductionVerificationReport {
  readonly generatedAt: string;
  readonly passed: boolean;
  readonly appOrigin: string;
  readonly apiOrigin: string;
  readonly checks: readonly ProductionCheck[];
}

interface ReadResult {
  readonly response: Response | null;
  readonly body: string;
  readonly error: string | null;
}

async function read(fetcher: Fetcher, url: string): Promise<ReadResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 60_000);
  try {
    const response = await fetcher(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Docket production verification' },
    });
    return { response, body: await response.text(), error: null };
  } catch (error) {
    return {
      response: null,
      body: '',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function status(result: ReadResult): string {
  return result.response
    ? `HTTP ${String(result.response.status)}`
    : (result.error ?? 'no response');
}

function json(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function check(name: string, passed: boolean, success: string, failure: string): ProductionCheck {
  return { name, passed, detail: passed ? success : failure };
}

async function checkApp(fetcher: Fetcher): Promise<{ body: string; check: ProductionCheck }> {
  const app = await read(fetcher, APP_ORIGIN);
  const passed =
    app.response?.status === 200 && !/documentation demo|demo workspace/i.test(app.body);
  return {
    body: app.body,
    check: check('app', passed, 'primary app returned 200', status(app)),
  };
}

async function checkDocs(fetcher: Fetcher): Promise<ProductionCheck[]> {
  const docs = await read(fetcher, `${APP_ORIGIN}/docs`);
  const docsUrl = docs.response?.url ?? '';
  const passed =
    docs.response?.status === 200 &&
    docsUrl.startsWith(`${APP_ORIGIN}/docs/`) &&
    !/(?:^|\/)demo(?:\/|$)|documentation demo/im.test(`${docsUrl}\n${docs.body}`);
  const checks = [
    check(
      'docs',
      passed,
      `canonical page ${docsUrl}`,
      `${status(docs)} at ${docsUrl === '' ? 'no URL' : docsUrl}`,
    ),
  ];
  for (const [name, path, minimumBytes] of [
    ['llms', '/docs/llms.txt', 500],
    ['llms-full', '/docs/llms-full.txt', 10_000],
  ] as const) {
    const result = await read(fetcher, `${APP_ORIGIN}${path}`);
    const textPassed =
      result.response?.status === 200 &&
      result.response.headers.get('content-type')?.includes('text/plain') === true &&
      result.body.length >= minimumBytes;
    checks.push(check(name, textPassed, `${String(result.body.length)} bytes`, status(result)));
  }
  return checks;
}

async function checkApiBasics(fetcher: Fetcher): Promise<ProductionCheck[]> {
  const health = await read(fetcher, `${API_ORIGIN}/v1/health`);
  const healthPassed = health.response?.status === 200 && json(health.body)?.['status'] === 'ok';
  const config = await read(fetcher, `${API_ORIGIN}/v1/config`);
  const configBody = json(config.body);
  const configPassed =
    config.response?.status === 200 &&
    configBody?.['appMode'] === 'production' &&
    configBody['mcpUrl'] === `${API_ORIGIN}/mcp`;
  return [
    check('api-health', healthPassed, 'status ok', status(health)),
    check('api-config', configPassed, 'production origins match', status(config)),
  ];
}

function validOpenApi(
  result: ReadResult,
  body: Record<string, unknown> | null,
  pathCount: number,
): boolean {
  const info = body?.['info'] as Record<string, unknown> | undefined;
  const servers = body?.['servers'] as readonly Record<string, unknown>[] | undefined;
  return (
    result.response?.status === 200 &&
    info?.['title'] === 'Docket API' &&
    servers?.some((server) => server['url'] === API_ORIGIN) === true &&
    pathCount >= 300
  );
}

async function checkOpenApi(fetcher: Fetcher): Promise<ProductionCheck[]> {
  const openapi = await read(fetcher, `${API_ORIGIN}/v1/openapi.json`);
  const openapiBody = json(openapi.body);
  const paths = openapiBody?.['paths'] as Record<string, unknown> | undefined;
  const pathCount = paths ? Object.keys(paths).length : 0;
  const openapiPassed = validOpenApi(openapi, openapiBody, pathCount);
  const scalar = await read(fetcher, `${API_ORIGIN}/v1/docs`);
  const scalarPassed = scalar.response?.status === 200 && scalar.body.includes('openapi.json');
  return [
    check('openapi', openapiPassed, `${String(pathCount)} documented paths`, status(openapi)),
    check('api-reference', scalarPassed, 'Scalar references OpenAPI', status(scalar)),
  ];
}

async function checkAuthorizationMetadata(fetcher: Fetcher): Promise<ProductionCheck[]> {
  const authorization = await read(
    fetcher,
    `${API_ORIGIN}/.well-known/oauth-authorization-server/api/auth`,
  );
  const authorizationPassed =
    authorization.response?.status === 200 &&
    json(authorization.body)?.['issuer'] === `${API_ORIGIN}/api/auth`;
  const resource = await read(fetcher, `${API_ORIGIN}/.well-known/oauth-protected-resource/mcp`);
  const resourcePassed =
    resource.response?.status === 200 && json(resource.body)?.['resource'] === `${API_ORIGIN}/mcp`;
  return [
    check(
      'oauth-metadata',
      authorizationPassed,
      'issuer matches production API',
      status(authorization),
    ),
    check('mcp-metadata', resourcePassed, 'resource matches production MCP', status(resource)),
  ];
}

async function checkImmutableAsset(fetcher: Fetcher, appBody: string): Promise<ProductionCheck> {
  const assetPath = /(?:src|href)=["'](\/_next\/static\/[^"']+)/.exec(appBody)?.[1];
  if (!assetPath) {
    return check('immutable-asset', false, '', 'primary HTML names no Next.js static asset');
  }
  const asset = await read(fetcher, `${APP_ORIGIN}${assetPath}`);
  const cacheControl = asset.response?.headers.get('cache-control') ?? '';
  const passed = asset.response?.status === 200 && cacheControl.includes('immutable');
  return check(
    'immutable-asset',
    passed,
    cacheControl,
    `${status(asset)} with ${cacheControl === '' ? 'no cache policy' : cacheControl}`,
  );
}

/**
 * Probe the public app, Mintlify site, API contract, authorization metadata, and one immutable
 * application asset.
 *
 * @param fetcher - Fetch implementation. Tests supply a deterministic boundary double.
 * @returns A sanitized report with no response bodies, credentials, or provider identifiers.
 */
export async function verifyProduction(
  fetcher: Fetcher = fetch,
): Promise<ProductionVerificationReport> {
  const app = await checkApp(fetcher);
  const checks = [
    app.check,
    ...(await checkDocs(fetcher)),
    ...(await checkApiBasics(fetcher)),
    ...(await checkOpenApi(fetcher)),
    ...(await checkAuthorizationMetadata(fetcher)),
    await checkImmutableAsset(fetcher, app.body),
  ];

  return {
    generatedAt: new Date().toISOString(),
    passed: checks.every((check) => check.passed),
    appOrigin: APP_ORIGIN,
    apiOrigin: API_ORIGIN,
    checks,
  };
}

async function main(): Promise<void> {
  const report = await verifyProduction();
  for (const check of report.checks) {
    process.stdout.write(`${check.passed ? 'PASS' : 'FAIL'}\t${check.name}\t${check.detail}\n`);
  }
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
