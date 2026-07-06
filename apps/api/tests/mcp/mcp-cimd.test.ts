import { db, oauthApplication } from '@docket/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CimdDeps } from '../../src/mcp/cimd';
import type * as CimdModule from '../../src/mcp/cimd';
import type * as McpServerModule from '../../src/mcp/server';
import { getMigratedDb } from '../support/db';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';
process.env['MCP_CIMD_STRICT'] = 'true';
process.env['MCP_CIMD_TRUST_ALLOWLIST'] = 'allowed.example';

let cimd!: typeof CimdModule;
let serverMod!: typeof McpServerModule;

beforeAll(async () => {
  await getMigratedDb();
  cimd = await import('../../src/mcp/cimd');
  serverMod = await import('../../src/mcp/server');
});

function deps(metadata: Record<string, unknown>, addresses = ['93.184.216.34']): CimdDeps {
  return {
    resolveHost: vi.fn(async () => addresses.map((address) => ({ address, family: 4 as const }))),
    fetchJson: vi.fn(async () => metadata),
  };
}

describe('CIMD client metadata validation', () => {
  it('rejects non-https client_id values', async () => {
    await expect(
      cimd.resolveCimdClient(
        'http://allowed.example/client.json',
        deps({ client_id: 'http://allowed.example/client.json', redirect_uris: [] }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('rejects private or loopback DNS results before fetching the document', async () => {
    const d = deps(
      {
        client_id: 'https://allowed.example/client.json',
        redirect_uris: ['https://allowed.example/callback'],
      },
      ['127.0.0.1'],
    );
    await expect(
      cimd.resolveCimdClient('https://allowed.example/client.json', d),
    ).rejects.toMatchObject({
      code: 'invalid_client',
    });
    expect(d.fetchJson).not.toHaveBeenCalled();
  });

  it('rejects documents whose client_id does not exactly match the URL', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json',
        deps({
          client_id: 'https://allowed.example/other.json',
          redirect_uris: ['https://allowed.example/callback'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('rejects non-https redirect URIs', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json',
        deps({
          client_id: 'https://allowed.example/client.json',
          redirect_uris: ['http://allowed.example/callback'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
  });

  it('accepts localhost redirect URIs for native MCP clients', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json',
        deps({
          client_id: 'https://allowed.example/client.json',
          client_name: 'Native Client',
          redirect_uris: ['http://127.0.0.1:3000/callback', 'http://localhost:8400/callback'],
        }),
      ),
    ).resolves.toMatchObject({
      clientId: 'https://allowed.example/client.json',
      redirectUris: ['http://127.0.0.1:3000/callback', 'http://localhost:8400/callback'],
    });
  });

  it('rejects non-allowlisted hosts when strict mode is enabled', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://outside.example/client.json',
        deps({
          client_id: 'https://outside.example/client.json',
          redirect_uris: ['https://outside.example/callback'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('upserts a validated public CIMD client into oauth_application', async () => {
    const client = await cimd.resolveCimdClient(
      'https://allowed.example/client.json',
      deps({
        client_id: 'https://allowed.example/client.json',
        client_name: 'Allowed Client',
        logo_uri: 'https://allowed.example/logo.png',
        redirect_uris: ['https://allowed.example/callback'],
        token_endpoint_auth_method: 'none',
      }),
    );

    await cimd.upsertCimdClient(client);

    const rows = await db
      .select()
      .from(oauthApplication)
      .where(eq(oauthApplication.clientId, 'https://allowed.example/client.json'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Allowed Client',
      icon: 'https://allowed.example/logo.png',
      clientId: 'https://allowed.example/client.json',
      clientSecret: '',
      redirectUrls: 'https://allowed.example/callback',
      type: 'public',
      disabled: false,
    });
    expect(JSON.parse(rows[0]!.metadata ?? '{}')).toMatchObject({
      cimd: true,
      cimdDocumentUrl: 'https://allowed.example/client.json',
    });
  });
});

describe('CIMD authorize preflight middleware', () => {
  /** Mounts the middleware exactly like server.ts does, in front of a stub authorize handler. */
  function authorizeApp(d?: CimdDeps): { app: Hono; downstream: ReturnType<typeof vi.fn> } {
    const downstream = vi.fn((c: { text: (s: string) => Response }) => c.text('authorize'));
    const app = new Hono();
    app.use('/api/auth/mcp/authorize', cimd.createCimdAuthorizeMiddleware(d));
    app.get('/api/auth/mcp/authorize', (c) => downstream(c));
    return { app, downstream };
  }

  it('registers a URL-form client_id and continues to the authorize handler', async () => {
    const clientId = 'https://allowed.example/preflight-client.json';
    const { app, downstream } = authorizeApp(
      deps({
        client_id: clientId,
        client_name: 'Preflight Client',
        redirect_uris: ['https://allowed.example/callback'],
        token_endpoint_auth_method: 'none',
      }),
    );

    const res = await app.request(
      `/api/auth/mcp/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code`,
    );

    expect(res.status).toBe(200);
    expect(downstream).toHaveBeenCalledTimes(1);
    const rows = await db
      .select({ type: oauthApplication.type })
      .from(oauthApplication)
      .where(eq(oauthApplication.clientId, clientId));
    expect(rows).toEqual([{ type: 'public' }]);
  });

  it('rejects an untrusted URL-form client_id with an OAuth error before Better Auth', async () => {
    const clientId = 'https://outside.example/client.json';
    const { app, downstream } = authorizeApp();

    const res = await app.request(
      `/api/auth/mcp/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code`,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
    expect(downstream).not.toHaveBeenCalled();
  });

  it('passes opaque client_id values straight through untouched', async () => {
    const { app, downstream } = authorizeApp();

    const res = await app.request('/api/auth/mcp/authorize?client_id=abc123&response_type=code');

    expect(res.status).toBe(200);
    expect(downstream).toHaveBeenCalledTimes(1);
  });
});

describe('MCP authorization server metadata', () => {
  it('advertises CIMD support in the root AS metadata document', async () => {
    process.env['MCP_ISSUER_URL'] = 'https://api.docket.test';
    process.env['MCP_RESOURCE_URL'] = 'https://api.docket.test/mcp';
    const res = serverMod.authorizationServerMetadata({
      req: { url: 'https://api.docket.test/.well-known/oauth-authorization-server' },
      json: (body: unknown) => new Response(JSON.stringify(body)),
    } as never);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['client_id_metadata_document_supported']).toBe(true);
    expect(body['authorization_endpoint']).toBe('https://api.docket.test/api/auth/mcp/authorize');
    expect(body['registration_endpoint']).toBe('https://api.docket.test/api/auth/mcp/register');
    expect(body['code_challenge_methods_supported']).toEqual(['S256']);
  });
});
