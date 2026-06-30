/**
 * `@docket/api` — OpenAPI document + Scalar docs UI.
 *
 * @remarks
 * The spec is generated from the typed `/v1` app by `hono-openapi`'s `openAPIRouteHandler`,
 * which walks the chained routers and reads the `validator` (request) and `describeRoute`
 * (response + tags + capability) annotations attached to each route. Scalar renders it at
 * `/v1/docs`. The bearer requirement is declared once via `defaultOptions` (public routes
 * opt out with `security: []` in their `apiDoc`).
 *
 * Only the typed `AppType` app is documented. The non-RPC external edges mounted directly on
 * the root server (webhooks, ingest, stream, cron, github integration, the binary account
 * export) are intentionally excluded — they are machine/webhook endpoints, not the public RPC
 * contract, and `openAPIRouteHandler(app)` only sees the routes registered on `app`.
 */
import { Scalar } from '@scalar/hono-api-reference';
import { openAPIRouteHandler } from 'hono-openapi';
import type { Hono } from 'hono';

import type { AppInstance } from './app';
import type { AppEnv } from './context';
import { env } from './env';

/**
 * The resource-group tags, in sidebar order. Each route tags itself with one of these (via
 * `apiDoc({ tag })`), so Scalar renders a clean grouped sidebar.
 */
const TAGS = [
  { name: 'Config', description: 'Public client configuration.' },
  { name: 'Orgs', description: 'Organizations.' },
  { name: 'Members', description: 'Organization membership and invitations.' },
  { name: 'Roles', description: 'Organization roles.' },
  { name: 'Grants', description: 'Per-resource permission grants.' },
  { name: 'Teams', description: 'Teams and team membership.' },
  { name: 'Initiatives', description: 'Cross-team initiatives.' },
  { name: 'Programs', description: 'Programs grouping projects.' },
  { name: 'Projects', description: 'Projects and their rollups.' },
  { name: 'Milestones', description: 'Project milestones.' },
  { name: 'Cycles', description: 'Iteration cycles.' },
  { name: 'Tasks', description: 'Tasks, subtasks, dependencies, and attachments.' },
  { name: 'Labels', description: 'Labels and tagging.' },
  { name: 'Comments', description: 'Comments on work items.' },
  { name: 'Updates', description: 'Status updates that drive health.' },
  { name: 'Views', description: 'Saved views.' },
  { name: 'Agents', description: 'Agents and agent sessions.' },
  { name: 'Capture', description: 'Quick capture into the inbox.' },
  { name: 'Integrations', description: 'Connected external integrations.' },
  { name: 'Billing', description: 'Subscription and billing lifecycle.' },
  { name: 'Activity', description: 'Per-org activity feed.' },
  { name: 'Stream', description: 'Server-sent event streams.' },
  { name: 'Notifications', description: 'Notification inbox.' },
  { name: 'DailyPlan', description: 'The personal daily plan.' },
  { name: 'Hub', description: 'Cross-org aggregation surfaces.' },
  { name: 'Me', description: 'The current actor: account, identities, connected apps.' },
  { name: 'Admin', description: 'Administrative operations.' },
];

/** Build the base OpenAPI 3.1 documentation (paths are filled by route annotations). */
function buildDocumentation() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Docket API',
      version: '0.0.0',
      description: 'Docket — the calm command center for work.',
    },
    // `app` has basePath `/v1`, so generated paths already carry `/v1` — the server URL must
    // NOT repeat it (else paths resolve to `/v1/v1/...`).
    servers: [{ url: env.API_URL }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http' as const, scheme: 'bearer' },
        mcpOAuth: {
          type: 'oauth2' as const,
          flows: {
            authorizationCode: {
              authorizationUrl: `${env.API_URL}/api/auth/mcp/authorize`,
              tokenUrl: `${env.API_URL}/api/auth/mcp/token`,
              scopes: {},
            },
          },
        },
      },
    },
    tags: TAGS,
  };
}

/** Register `/v1/openapi.json` (the generated spec) and `/v1/docs` (Scalar) on the root server. */
export function registerOpenapi(server: Hono<AppEnv>, app: AppInstance): void {
  server.get(
    '/v1/openapi.json',
    openAPIRouteHandler(app, {
      documentation: buildDocumentation(),
      // Declare the bearer requirement once for every route; public routes override with
      // `security: []` in their `apiDoc`.
      defaultOptions: { ALL: { security: [{ bearerAuth: [] }] } },
    }),
  );
  // Scalar's config is a union whose object-literal excess-property check is over-strict;
  // the `{ url }` form is the documented runtime usage, so cast past the type quirk.
  const docsConfig = { url: '/v1/openapi.json' } as unknown as Parameters<typeof Scalar>[0];
  server.get('/v1/docs', Scalar(docsConfig));
}
