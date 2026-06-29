/**
 * `@docket/api` — runtime entrypoint.
 *
 * @remarks
 * Boot order: CORS (first) → session middleware → `/api/auth/*` (Better Auth, outside
 * the RPC `AppType`) → the `/v1` app → health/openapi/docs → the Problem `onError`.
 * Importing `@docket/api` (the package entry) does NOT run this; only `node dist/server.js`
 * / `tsx watch src/server.ts` does.
 */
import { serve } from '@hono/node-server';
import { auth } from '@docket/auth';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { app } from './app';
import { sessionMiddleware } from './auth/session-middleware';
import type { AppEnv } from './context';
import { env } from './env';
import { onError } from './error';
import { authorizationServerMetadata, mcpHandler, protectedResourceMetadata } from './mcp/server';
import { registerOpenapi } from './openapi';
import cron from './routes/cron';
import ingest from './routes/ingest';
import integrationsGithub from './routes/integrations-github';
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
// Non-RPC external edges (webhooks, ingestion, cron) live OUTSIDE the typed `AppType` routes.
server.route('/v1/billing', webhooks);
server.route('/v1/ingest', ingest);
server.route('/v1/integrations/github', integrationsGithub);
server.route('/v1/cron', cron);
server.route('/', app);
server.get('/v1/health', (c) => c.json({ status: 'ok' as const }));
registerOpenapi(server);
server.onError(onError);

const nodeServer = serve({ fetch: server.fetch, port: env.PORT });

console.log(`▶ Docket API listening on :${String(env.PORT)}`);

// Cloud Run sends SIGTERM before SIGKILL; finish in-flight requests then exit cleanly.
process.on('SIGTERM', () => {
  nodeServer.close(() => process.exit(0));
});
