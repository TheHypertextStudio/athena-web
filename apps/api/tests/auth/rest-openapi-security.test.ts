import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AdminInstance, AppInstance } from '../../src/app';
import { openapiDocument } from '../../src/openapi';
import { apiDoc } from '../../src/lib/openapi-route';

interface SecurityDocument {
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
  readonly components: {
    readonly securitySchemes: Readonly<Record<string, unknown>>;
  };
  readonly paths: Readonly<
    Record<
      string,
      Readonly<
        Record<
          string,
          { readonly security?: readonly Readonly<Record<string, readonly string[]>>[] }
        >
      >
    >
  >;
}

function route(summary: string) {
  return describeRoute({ summary, responses: { 200: { description: 'Fixture response.' } } });
}

function fixtureApps(): { readonly app: AppInstance; readonly adminApp: AdminInstance } {
  const app = new Hono()
    .get('/v1/config', route('Read configuration'), (c) => c.json({ ok: true }))
    .get('/v1/orgs', route('List organizations'), (c) => c.json({ ok: true }))
    .post('/v1/orgs', route('Create organization'), (c) => c.json({ ok: true }))
    .get('/v1/me/account', route('Read account'), (c) => c.json({ ok: true }))
    .get(
      '/v1/contract-public',
      apiDoc({
        operationId: 'getSecurityContractProbe',
        tag: 'Config',
        summary: 'Read the security contract probe',
        narrative: {
          purpose: 'Prove that OpenAPI security comes from the matched operation declaration.',
          behavior: ['Return a public fixture response.'],
        },
        access: { kind: 'public' },
        success: [
          {
            kind: 'json',
            status: 200,
            schema: z.object({ ok: z.boolean().describe('Whether the probe completed.') }),
            description: 'The public fixture response.',
          },
        ],
        errors: [],
        conditionalRead: false,
        conditionalWrite: false,
        idempotency: false,
        related: [],
      }),
      (c) => c.json({ ok: true }),
    )
    .get('/v1/public/time/status', route('Read shared time status'), (c) => c.json({ ok: true }));
  const adminApp = new Hono().get('/admin/session', route('Read staff session'), (c) =>
    c.json({ ok: true }),
  );
  return {
    app: app as unknown as AppInstance,
    adminApp: adminApp as unknown as AdminInstance,
  };
}

function oauthOperationNames(document: SecurityDocument): readonly string[] {
  const operations: string[] = [];
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (operation.security?.some((requirement) => 'restOAuth' in requirement)) {
        operations.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return operations;
}

function expectSessionAndOAuthAssignments(document: SecurityDocument): void {
  expect(document.security).toEqual([{ sessionCookie: [] }]);
  expect(document.paths['/v1/config']?.['get']?.security).toEqual([]);
  expect(document.paths['/v1/orgs']?.['get']?.security).toEqual([
    { restOAuth: ['work:read'] },
    { sessionCookie: [] },
  ]);
  expect(document.paths['/v1/orgs']?.['post']?.security).toEqual([{ sessionCookie: [] }]);
  expect(document.paths['/v1/me/account']?.['get']?.security).toEqual([{ sessionCookie: [] }]);
}

function expectPublicAssignments(document: SecurityDocument): void {
  expect(document.paths['/v1/contract-public']?.['get']?.security).toEqual([]);
  expect(document.paths['/v1/public/time/status']?.['get']?.security).toEqual([{ shareToken: [] }]);
  expect(oauthOperationNames(document)).toEqual(['GET /v1/orgs']);
}

describe('REST OpenAPI authentication contract', () => {
  it('publishes the first-party cookie and exact REST OAuth authorization-code schemes', async () => {
    const { app, adminApp } = fixtureApps();
    const document = (await openapiDocument(app, adminApp)) as SecurityDocument;

    expect(document.components.securitySchemes).toEqual({
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Secure-better-auth.session_token',
        description: expect.stringContaining('better-auth.session_token'),
      },
      restOAuth: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://docket.localhost/api/auth/oauth2/authorize',
            tokenUrl: 'https://api.docket.localhost/api/auth/oauth2/token',
            scopes: {
              'work:read':
                'View workspace structure, work, comments, updates, search, saved views, schedules, calendars, time, and your notifications.',
              'work:write':
                'Create and update work, comments, plans, schedules, time records, notification read state, and published brief content.',
              'agents:run':
                'Start, steer, resume, and cancel Athena or agent sessions, use voice sessions, and approve or reject proposed actions.',
              'connectors:link':
                'Connect, configure, disconnect, and run integrations with other tools you use.',
              offline_access: 'Keep working on your behalf without asking you to sign in again.',
            },
          },
        },
      },
      shareToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Docket-Share-Token',
        description: expect.stringContaining('shared time status'),
      },
    });
    expect(document.components.securitySchemes).not.toHaveProperty('bearerAuth');
    expect(document.components.securitySchemes).not.toHaveProperty('mcpOAuth');
  });

  it('derives each public operation requirement from the runtime access registry', async () => {
    const { app, adminApp } = fixtureApps();
    const document = (await openapiDocument(app, adminApp)) as SecurityDocument;

    expectSessionAndOAuthAssignments(document);
    expectPublicAssignments(document);
  });

  it('keeps the internal staff document cookie-only', async () => {
    const { app, adminApp } = fixtureApps();
    const document = (await openapiDocument(app, adminApp, 'admin')) as SecurityDocument;

    expect(document.components.securitySchemes).toEqual({
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Secure-better-auth.session_token',
        description: expect.stringContaining('better-auth.session_token'),
      },
    });
    expect(document.security).toEqual([{ sessionCookie: [] }]);
    expect(document.paths['/admin/session']?.['get']?.security ?? document.security).toEqual([
      { sessionCookie: [] },
    ]);
  });
});
