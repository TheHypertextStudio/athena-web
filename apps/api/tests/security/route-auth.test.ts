import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { getDb } from '../support/routes-harness';

/**
 * One probe: an HTTP method plus a concrete path, derived from the published API document.
 */
interface RouteProbe {
  /** Uppercase HTTP method. */
  readonly method: string;
  /** Concrete request path, with every OpenAPI path parameter substituted. */
  readonly path: string;
  /** The templated path as the document declares it, for readable failures. */
  readonly template: string;
}

/**
 * A minimal shape of the generated OpenAPI document — only what this matrix reads.
 */
interface OpenApiDocument {
  readonly paths?: Record<string, Record<string, unknown>>;
}

/**
 * The `/v1` routes that may answer an unauthenticated request with 200.
 *
 * @remarks
 * Exactly one, and it is a deliberate product requirement rather than an oversight: the sign-in
 * page must learn which auth buttons and connectors to render *before* anyone has a session, so
 * `GET /v1/config` opts out of the global gate (`security: []`, and `/v1/config` is listed in
 * `PUBLIC_PATHS` in `src/permissions/require-auth.ts`). Its payload is asserted below to carry
 * only public deployment configuration — never user, tenant, or credential data. Anything else
 * answering 200 unauthenticated is a security hole and fails this suite.
 */
const PUBLIC_ROUTES = new Set(['GET /v1/config']);

/**
 * The only top-level keys `GET /v1/config` may return.
 *
 * @remarks
 * Pinned so the one public endpoint cannot quietly grow a field that leaks tenant, user, or
 * credential data. Mirrors `PublicConfigOut` in `packages/types/src/public-config.ts`; every entry
 * is deployment configuration a signed-out browser already needs. `stripePublishableKey` is the
 * browser-safe *publishable* key (the schema states it is never a secret key). Some fields are
 * optional, so the assertion is a subset check — a key not on this list fails.
 */
const PUBLIC_CONFIG_KEYS = new Set([
  'appMode',
  'connectors',
  'googleOAuthPublic',
  'mcpUrl',
  'oauthProviders',
  'stripePublishableKey',
]);

/**
 * Credential prefixes and words that must never appear in the public config payload.
 *
 * @remarks
 * A key-name allowlist alone would still pass if a permitted field were filled with a secret, so
 * the payload text is scanned for live-credential shapes as well.
 */
const SECRET_MARKERS = [
  /sk_live_/i,
  /sk_test_/i,
  /\bsecret\b/i,
  /client_secret/i,
  /BEGIN [A-Z ]*PRIVATE KEY/,
];

/**
 * `/v1` routes that carry user data but are mounted outside the typed app, so the generated
 * document never lists them.
 *
 * @remarks
 * `server.ts` mounts both on the root server *before* the `/v1` app, which means the app-wide
 * `requireAuth` gate never runs for them — each has to reject on its own. That is precisely the
 * shape of gap this requirement exists to catch, so they are probed explicitly rather than left
 * to document discovery.
 */
const UNDOCUMENTED_USER_DATA_ROUTES: readonly RouteProbe[] = [
  { method: 'GET', path: '/v1/stream/sse', template: '/v1/stream/sse' },
  {
    method: 'GET',
    path: '/v1/me/account/exports/01KZ0R2DY0MNFG8BX4P297NQ9J/file',
    template: '/v1/me/account/exports/{exportId}/file',
  },
];

/** Statuses that count as "rejected the anonymous caller". */
const REJECTING_STATUSES = new Set([401, 403]);

/** A syntactically valid ULID used for every path parameter, so routing matches before authz. */
const PARAM_VALUE = '01KZ0R2DY0MNFG8BX4P297NQ9J';

/** HTTP methods the matrix probes; `options`/`head` are transport concerns, not data reads. */
const PROBED_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

let server!: Hono<AppEnv>;
let probes!: RouteProbe[];

/**
 * Build a server that composes exactly what `server.ts` puts in front of the `/v1` surface.
 *
 * @remarks
 * `src/server.ts` cannot be imported: it calls `serve()` at module scope. This reproduces the
 * relevant boot order — `sessionMiddleware`, the non-RPC `/v1` mounts, the typed app (which
 * registers `requireAuth` on `*`), the Problem `onError` — so the matrix measures the real gate
 * rather than a hand-rolled stand-in. `@docket/auth` is mocked by `support/auth-mock` (imported
 * transitively through `routes-harness`) to resolve no session, which is what makes every probe
 * anonymous.
 */
async function buildServer(): Promise<Hono<AppEnv>> {
  const { app, adminApp } = await import('../../src/app');
  const { sessionMiddleware } = await import('../../src/auth/session-middleware');
  const { onError } = await import('../../src/error');
  const { registerOpenapi } = await import('../../src/openapi');
  const { meAccountExportDownload } = await import('../../src/routes/me-account');
  const streamSse = (await import('../../src/routes/stream-sse')).default;
  const billing = (await import('../../src/routes/webhooks')).default;
  const ingest = (await import('../../src/routes/ingest')).default;
  const ingestLinearAgent = (await import('../../src/routes/ingest-linear-agent')).default;
  const internalNotifications = (await import('../../src/routes/internal-notifications')).default;
  const cron = (await import('../../src/routes/cron')).default;
  const calendarWebhook = (await import('../../src/routes/calendar-webhook')).default;

  const root = new Hono<AppEnv>();
  root.use('*', sessionMiddleware);
  // The machine edges, mounted in `server.ts`'s order. They sit OUTSIDE `/v1`, so the app-wide
  // `requireAuth` gate never sees them and each must authenticate itself.
  root.route('/internal/billing', billing);
  root.route('/internal/ingest', ingest);
  root.route('/internal/ingest', ingestLinearAgent);
  root.route('/internal/notifications', internalNotifications);
  root.route('/internal/cron', cron);
  root.route('/webhooks/calendar', calendarWebhook);
  root.route('/v1/stream', streamSse);
  root.route('/v1/me/account/exports', meAccountExportDownload);
  root.route('/', adminApp);
  root.route('/', app);
  root.get('/v1/health', (c) => c.json({ status: 'ok' as const }));
  registerOpenapi(root, app, adminApp);
  root.onError(onError);
  return root;
}

/**
 * Turn the generated OpenAPI document into one probe per path/method pair.
 *
 * @remarks
 * Derived rather than hand-maintained on purpose: a route added to the typed app tomorrow is
 * probed by this suite the moment it appears in the document, with no list to remember to update.
 *
 * @param document - The parsed `/v1/openapi.json` body.
 * @returns Every probe, sorted for stable output.
 */
function probesFromDocument(document: OpenApiDocument): RouteProbe[] {
  const collected: RouteProbe[] = [];
  for (const [template, operations] of Object.entries(document.paths ?? {})) {
    for (const method of Object.keys(operations)) {
      if (!PROBED_METHODS.has(method.toLowerCase())) continue;
      collected.push({
        method: method.toUpperCase(),
        path: template.replace(/\{[^}]+\}/g, PARAM_VALUE),
        template,
      });
    }
  }
  return collected.sort((a, b) =>
    `${a.template} ${a.method}`.localeCompare(`${b.template} ${b.method}`),
  );
}

/** Issue one anonymous request — no cookie, no Authorization header. */
async function probe(route: RouteProbe): Promise<Response> {
  const init: RequestInit = { method: route.method };
  if (route.method !== 'GET') {
    init.headers = { 'content-type': 'application/json' };
    init.body = '{}';
  }
  return server.request(route.path, init);
}

beforeAll(async () => {
  await getDb();
  server = await buildServer();
  const response = await server.request('/v1/openapi.json');
  expect(response.status).toBe(200);
  probes = probesFromDocument((await response.json()) as OpenApiDocument);
}, 60_000);

describe('route auth matrix', () => {
  it('derives a substantial route list from the published API document', () => {
    expect(probes.length).toBeGreaterThan(50);
    expect(probes.some((route) => route.method === 'POST')).toBe(true);
    expect(probes.some((route) => route.method === 'PATCH')).toBe(true);
    expect(probes.some((route) => route.method === 'DELETE')).toBe(true);
    expect(probes.map((route) => `${route.method} ${route.template}`)).toContain('GET /v1/config');
  });

  it('rejects every anonymous request to a documented route except the public allowlist', async () => {
    const unexpected: string[] = [];

    for (const route of probes) {
      const response = await probe(route);
      const name = `${route.method} ${route.template}`;
      if (PUBLIC_ROUTES.has(name)) {
        if (response.status !== 200)
          unexpected.push(`${name} → ${String(response.status)} (public route must serve)`);
        continue;
      }
      if (!REJECTING_STATUSES.has(response.status)) {
        unexpected.push(`${name} → ${String(response.status)}`);
      }
    }

    expect(
      unexpected,
      [
        'Every /v1 route that returns user data must reject an unauthenticated caller with 401/403.',
        `Public allowlist: ${[...PUBLIC_ROUTES].join(', ')}`,
        unexpected.join('\n'),
      ].join('\n'),
    ).toEqual([]);
  }, 120_000);

  it('rejects anonymous requests to the user-data routes mounted outside the document', async () => {
    for (const route of UNDOCUMENTED_USER_DATA_ROUTES) {
      const response = await probe(route);
      expect(
        REJECTING_STATUSES.has(response.status),
        `${route.template} → ${String(response.status)}`,
      ).toBe(true);
    }
  });

  it('serves only public deployment configuration from the one allowlisted route', async () => {
    const response = await server.request('/v1/config');
    expect(response.status).toBe(200);

    const text = await response.text();
    const body = JSON.parse(text) as { data?: Record<string, unknown> };
    const payload = body.data ?? body;

    const unexpectedKeys = Object.keys(payload).filter((key) => !PUBLIC_CONFIG_KEYS.has(key));
    expect(
      unexpectedKeys,
      'GET /v1/config is the only unauthenticated 200; it may carry deployment config only.',
    ).toEqual([]);

    for (const marker of SECRET_MARKERS) {
      expect(marker.test(text), `public config body matched ${marker.source}`).toBe(false);
    }
  });

  it('rejects an anonymous caller on /mcp, the other surface that returns user data', async () => {
    // The Streamable HTTP MCP endpoint lives outside the typed `/v1` app (it is mounted directly
    // on the root server in `server.ts`), so `requireAuth` never sees it — it carries its own
    // Origin guard plus a cookie-or-bearer session check. Its tools read the same tenant data the
    // RPC routes do, which makes it the single most consequential route in this file.
    const { mcpHandler } = await import('../../src/mcp/server');
    const mcp = new Hono<AppEnv>();
    mcp.on(['POST', 'GET', 'DELETE'], '/mcp', mcpHandler);
    mcp.onError((await import('../../src/error')).onError);

    for (const method of ['POST', 'GET', 'DELETE']) {
      const response = await mcp.request('/mcp', {
        ...(method === 'POST'
          ? {
              body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/list' }),
              headers: { 'content-type': 'application/json' },
            }
          : {}),
        method,
      });
      expect(`${method} /mcp → ${String(response.status)}`).toBe(`${method} /mcp → 401`);
      expect(await response.text()).not.toMatch(/\b01[0-9A-HJKMNP-TV-Z]{24}\b/);
    }
  });

  it('keeps the staff back-office unreachable without a session', async () => {
    for (const path of ['/admin/openapi.json', '/admin/notifications']) {
      const response = await server.request(path);
      expect(REJECTING_STATUSES.has(response.status), `${path} → ${String(response.status)}`).toBe(
        true,
      );
    }
  });
});
/** One machine edge, with the status it must answer an unsigned and a forged caller with. */
interface MachineEdge {
  /** The request to issue. */
  readonly probe: RouteProbe;
  /** Status expected when no authentication material is presented at all. */
  readonly unsigned: number;
  /** Headers that present WRONG authentication material. */
  readonly forgedHeaders: Record<string, string>;
  /** Status expected for the forged request. */
  readonly forged: number;
  /** Why this route answers with the status it does. */
  readonly why: string;
}

/**
 * The machine edges: routes mounted OUTSIDE `/v1`, where the app-wide `requireAuth` gate never
 * runs and each endpoint must authenticate itself.
 *
 * @remarks
 * These are push endpoints — a provider or the platform scheduler calls them, and none of them
 * returns user data to its caller. They are therefore outside the letter of the auth-coverage
 * requirement that every production route returning user data reject an unauthenticated request
 * with 401/403, but they are exactly the surface where a missing gate would be easiest to
 * overlook, so each is probed twice: with NO authentication material, and with WRONG material.
 *
 * The expected statuses are not uniformly 401/403, and each difference is deliberate rather than a
 * gap — the `why` field on every entry records which. Two entries also depend on this deployment's
 * configuration rather than on its auth code, and say so; what every entry enforces regardless is
 * that an unauthenticated caller never gets a 2xx and never gets a body carrying tenant data.
 */
const MACHINE_EDGES: readonly MachineEdge[] = [
  {
    forged: 400,
    forgedHeaders: { 'stripe-signature': 't=1,v1=deadbeef' },
    probe: {
      method: 'POST',
      path: '/internal/billing/webhook',
      template: '/internal/billing/webhook',
    },
    unsigned: 400,
    why: "400 is Stripe's documented contract for a signature failure: the provider treats 4xx as final and retries 5xx, and answering 401 would advertise that a credential is what is missing.",
  },
  {
    forged: 400,
    forgedHeaders: { 'x-hub-signature-256': 'invalid', 'linear-signature': 'invalid' },
    probe: { method: 'POST', path: '/internal/ingest/linear', template: '/internal/ingest/linear' },
    unsigned: 400,
    why: "Verify-before-parse: the raw bytes are authenticated before anything reads them, so an unverifiable body is malformed rather than unauthorized. Under APP_MODE=test the bound Observer is MockObserver, whose documented contract is 'any present signature header except the literal invalid' — so this probe proves the ORDER (nothing is parsed before verification) rather than the HMAC itself, which packages/integrations' observer tests own.",
  },
  {
    forged: 400,
    forgedHeaders: { 'x-hub-signature-256': 'invalid' },
    probe: { method: 'POST', path: '/internal/ingest/github', template: '/internal/ingest/github' },
    unsigned: 400,
    why: 'Same verify-before-parse contract as the Linear ingest above: the GitHub delivery is authenticated over its raw bytes via `x-hub-signature-256` before anything parses them, and an unverifiable body is answered 400 rather than 401 so a retrying provider treats it as final.',
  },
  {
    forged: 404,
    forgedHeaders: { 'linear-signature': 'deadbeef' },
    probe: {
      method: 'POST',
      path: '/internal/ingest/linear-agent',
      template: '/internal/ingest/linear-agent',
    },
    unsigned: 404,
    why: 'Configuration-dependent: `linearAgentConfigFromEnv()` returns null in a deployment with no Linear Agent app configured (this test environment included), and the handler 404s before it reaches signature verification. It never serves an unauthenticated caller either way; where the app IS configured the next line answers 400 on a bad signature.',
  },
  {
    forged: 401,
    forgedHeaders: { 'x-docket-signature': 'sha256=deadbeef' },
    probe: {
      method: 'POST',
      path: '/internal/notifications/events/email',
      template: '/internal/notifications/events/email',
    },
    unsigned: 401,
    why: 'Provider delivery callbacks authenticate with an `x-docket-signature` HMAC over the raw body; a missing or wrong one is 401.',
  },
  {
    forged: 401,
    forgedHeaders: { authorization: 'Bearer not-the-cron-secret' },
    probe: {
      method: 'POST',
      path: '/internal/cron/sync-connectors',
      template: '/internal/cron/sync-connectors',
    },
    unsigned: 401,
    why: 'The scheduler presents `CRON_SECRET` as a bearer token (or `x-cron-secret`); anything else is 401.',
  },
  {
    forged: 404,
    forgedHeaders: { 'x-goog-channel-id': 'chan_forged', 'x-goog-channel-token': 'tok_forged' },
    probe: {
      method: 'POST',
      path: '/webhooks/calendar/google',
      template: '/webhooks/calendar/google',
    },
    unsigned: 404,
    why: "404 by design — the handler's own remarks state that an unknown channel id 404s 'without revealing which check failed', so the status cannot be used to enumerate registered push channels.",
  },
];

/** Shapes that would betray tenant data in a rejection body. */
const TENANT_DATA_MARKERS = [
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
  /\b01[0-9A-HJKMNP-TV-Z]{24}\b/,
  /"organizationId"/,
  /"userId"/,
];

describe('machine edges authenticate by signature, not by session', () => {
  it('never serves an unsigned caller, and leaks nothing in the rejection', async () => {
    const wrong: string[] = [];
    for (const edge of MACHINE_EDGES) {
      const response = await probe(edge.probe);
      const name = `${edge.probe.method} ${edge.probe.template}`;
      if (response.status !== edge.unsigned) {
        wrong.push(`${name} → ${String(response.status)} (want ${String(edge.unsigned)})`);
      }
      expect(response.status, `${name} must never serve an unsigned caller`).toBeGreaterThanOrEqual(
        400,
      );
      const text = await response.text();
      for (const marker of TENANT_DATA_MARKERS) {
        expect(marker.test(text), `${name} rejection body matched ${marker.source}`).toBe(false);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('rejects WRONG authentication material exactly as it rejects missing material', async () => {
    for (const edge of MACHINE_EDGES) {
      const response = await server.request(edge.probe.path, {
        body: '{}',
        headers: { 'content-type': 'application/json', ...edge.forgedHeaders },
        method: edge.probe.method,
      });
      const name = `${edge.probe.method} ${edge.probe.template}`;
      expect(`${name} → ${String(response.status)}`).toBe(`${name} → ${String(edge.forged)}`);
      expect(response.status, `${name} — ${edge.why}`).toBeGreaterThanOrEqual(400);
    }
  });

  it('documents a reason for every status that is not 401/403', () => {
    for (const edge of MACHINE_EDGES) {
      if (edge.unsigned === 401 || edge.unsigned === 403) continue;
      expect(edge.why.length, `${edge.probe.template} needs a written reason`).toBeGreaterThan(80);
    }
  });
});

describe('the unauthenticated surface is exactly the documented public one', () => {
  /**
   * Endpoints that legitimately answer an anonymous caller with 200.
   *
   * @remarks
   * Each carries no user, tenant, or credential data, and each has a reason it must be reachable
   * before sign-in:
   *
   * - `/v1/health` — the platform liveness probe; the deploy will not promote a revision without it.
   * - `/v1/openapi.json`, `/v1/docs` — the published API contract and its Scalar renderer.
   * - `/v1/config` — read by the sign-in page to decide which auth buttons to render (its payload
   *   is pinned field-by-field by the assertion further up this file).
   * Not probed here, because `server.ts` registers them directly on the root server and this
   * suite cannot import that module (it calls `serve()` at module scope): the RFC 9728 / RFC 8414
   * discovery documents under `/.well-known/oauth-*` and Docket's own CIMD client-metadata
   * document `/.well-known/mcp-client.json`. All four are static, env-derived documents that an
   * MCP client must fetch BEFORE it can obtain a token, so gating them would make the OAuth flow
   * unstartable; none reads the database.
   */
  const PUBLIC_SURFACE = ['/v1/health', '/v1/openapi.json', '/v1/config'];

  it('serves every documented public endpoint without a session', async () => {
    for (const path of PUBLIC_SURFACE) {
      const response = await server.request(path);
      expect(`${path} → ${String(response.status)}`).toBe(`${path} → 200`);
    }
  });

  it('carries no tenant data on any public endpoint', async () => {
    // Values, not field names: `/v1/openapi.json` publishes the *contract*, so it legitimately
    // contains schema properties called `email` and `organizationId`, and `example` ULIDs for its
    // path parameters. What no public endpoint may carry is a real address or a credential, and
    // what the two non-document endpoints may not carry is an entity id of any kind.
    const alwaysForbidden = [
      /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
      /Bearer\s+[A-Za-z0-9._-]{20,}/i,
      /ciphertext/i,
    ];
    const forbiddenOutsideTheDocument = [/\b01[0-9A-HJKMNP-TV-Z]{24}\b/];
    for (const path of PUBLIC_SURFACE) {
      const text = await (await server.request(path)).text();
      const markers =
        path === '/v1/openapi.json'
          ? alwaysForbidden
          : [...alwaysForbidden, ...forbiddenOutsideTheDocument];
      for (const marker of markers) {
        expect(marker.test(text), `${path} body matched ${marker.source}`).toBe(false);
      }
    }
  });
});
