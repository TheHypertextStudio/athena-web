/**
 * `@docket/api` — OpenAPI document + Scalar docs UI.
 *
 * @remarks
 * The foundation serves a minimal but valid OpenAPI 3.1 document (info, env-driven
 * server, the bearer + MCP-OAuth security schemes); the P6 api lane fills per-route
 * paths via `describeRoute`. Scalar renders it at `/v1/docs`.
 */
import { apiReference } from '@scalar/hono-api-reference';
import type { Hono } from 'hono';

import type { AppEnv } from './context';
import { env } from './env';

/** Build the OpenAPI 3.1 document for the Docket API. */
export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Docket API',
      version: '0.0.0',
      description: 'Docket — the calm command center for work.',
    },
    servers: [{ url: `${env.API_URL}/v1` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        mcpOAuth: {
          type: 'oauth2',
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
    paths: {},
  };
}

/** Register `/v1/openapi.json` (the spec) and `/v1/docs` (Scalar) on the root server. */
export function registerOpenapi(server: Hono<AppEnv>): void {
  server.get('/v1/openapi.json', (c) => c.json(buildOpenApiDocument()));
  // Scalar's config is a union whose object-literal excess-property check is over-strict;
  // the `{ url }` form is the documented runtime usage, so cast past the type quirk.
  const docsConfig = { url: '/v1/openapi.json' } as unknown as Parameters<typeof apiReference>[0];
  server.get('/v1/docs', apiReference(docsConfig));
}
