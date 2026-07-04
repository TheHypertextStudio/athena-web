/**
 * `@docket/api` — runtime entrypoint.
 *
 * @remarks
 * Boot order: CORS (first) → session middleware → `/api/auth/*` (Better Auth) → the
 * `/internal/*` machine edges (webhooks/ingest/cron/oauth-callback, each self-authed) → the
 * `/admin` staff app → the `/v1` public app → health/openapi/docs → the Problem `onError`.
 * Three typed surfaces are kept apart: the public `/v1` app (`AppType`), the staff `/admin`
 * app (`AdminAppType`), and the un-typed `/internal/*` machine edges.
 * Importing `@docket/api` (the package entry) does NOT run this; only `node dist/server.js`
 * / `tsx watch src/server.ts` does.
 */
import { serve } from '@hono/node-server';
import { auth } from '@docket/auth';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { adminApp, app } from './app';
import { sessionMiddleware } from './auth/session-middleware';
import type { AppEnv } from './context';
import { startDevScheduler } from './dev-scheduler';
import { env } from './env';
import { onError } from './error';
import { cimdAuthorizeMiddleware } from './mcp/cimd';
import { mcpConsentGuard } from './mcp/consent-guard';
import { authorizationServerMetadata, mcpHandler, protectedResourceMetadata } from './mcp/server';
import { registerOpenapi } from './openapi';
import calendarWebhook from './routes/calendar-webhook';
import cron from './routes/cron';
import ingest from './routes/ingest';
import { meAccountExportDownload } from './routes/me-account';
import streamSse from './routes/stream-sse';
import integrationsGithub from './routes/integrations-github';
import integrationsSlack from './routes/integrations-slack';
import webhooks from './routes/webhooks';

const trustedOrigins =
  env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

/** The root HTTP server: global middleware, the auth mount, the `/v1` app, and docs. */
export const server = new Hono<AppEnv>();

server.use(
  '*',
  cors({
    origin: trustedOrigins,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Authorization', 'WWW-Authenticate'],
  }),
);
server.use('*', sessionMiddleware);
// CIMD preflight (mcp-surface.md §2.6): Better Auth resolves authorize clients by exact
// `client_id`, so URL-form MCP client ids must be fetched/validated/upserted into the OAuth
// application table BEFORE the authorize handler runs. Registered ahead of `/api/auth/*` so
// it wraps only the MCP authorize route; non-URL client ids pass straight through.
server.use('/api/auth/mcp/authorize', cimdAuthorizeMiddleware);
// Consent gate (mcp-surface.md §2.2): Better Auth's mcp() authorize only shows the consent
// page when the client sends `prompt=consent`; this guard 302s consent-less authorize
// requests back with it set unless a stored oauth_consent already covers the scopes.
server.use('/api/auth/mcp/authorize', mcpConsentGuard);
server.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
// The MCP Streamable HTTP endpoint lives OUTSIDE the typed `AppType` routes (like
// `/api/auth`): it carries its own Origin + session guard and is not part of the RPC
// contract consumed by `hc<AppType>`.
server.on(['POST', 'GET'], '/mcp', mcpHandler);
// OAuth 2.1 RS discovery (mcp-surface.md §2.3): the Protected Resource Metadata document
// (RFC 9728, served at both the bare path and the `/mcp` sub-path) the `WWW-Authenticate`
// challenge points at, plus the Authorization Server metadata pointer (RFC 8414).
server.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
server.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);
server.get('/.well-known/oauth-authorization-server', authorizationServerMetadata);
// Internal machine edges (webhooks, ingestion, cron, OAuth callback) live OUTSIDE the public
// `/v1` API and outside any typed contract, under a single `/internal/*` umbrella. Each carries
// its own auth (Stripe/provider signatures, `CRON_SECRET`, signed OAuth state) — they are NOT
// session-gated by `requireAuth` (which only guards the `/v1` app).
server.route('/internal/billing', webhooks);
server.route('/internal/ingest', ingest);
server.route('/internal/integrations/github', integrationsGithub);
server.route('/internal/integrations/slack', integrationsSlack);
server.route('/internal/cron', cron);
// Provider push-notification webhooks: NOT under `/internal` (Docket registers this exact URL
// directly with each provider, e.g. Google's `channels.watch`, rather than calling it itself),
// but still outside `/v1`/OpenAPI — a machine edge like the ones above, self-authed per provider
// (Google: the channel/token/resource-id headers, never the request body).
server.route('/webhooks/calendar', calendarWebhook);
// User-facing non-RPC edges that stay on `/v1`: the SSE live stream, and the binary account
// export download (GET registered before the typed app so its path matches; the typed app still
// owns POST /v1/me/account/exports).
server.route('/v1/stream', streamSse);
server.route('/v1/me/account/exports', meAccountExportDownload);
// The internal staff back-office (`AdminAppType`) under `/admin`, self-gated by staffMiddleware
// — separate from the public `/v1` app and absent from the public spec.
server.route('/', adminApp);
server.route('/', app);
server.get('/v1/health', (c) => c.json({ status: 'ok' as const }));
registerOpenapi(server, app, adminApp);
server.onError(onError);

const nodeServer = serve({ fetch: server.fetch, port: env.PORT });

console.log(`▶ Docket API listening on :${String(env.PORT)}`);

// Local dev has no Cloud Scheduler, so run the account sweeps in-process (export/deletion).
if (env.APP_MODE === 'local') startDevScheduler();

// Cloud Run sends SIGTERM before SIGKILL; finish in-flight requests then exit cleanly.
process.on('SIGTERM', () => {
  nodeServer.close(() => process.exit(0));
});
