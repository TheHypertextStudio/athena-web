import { db, oauthClient } from '@docket/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CimdDeps } from '../../src/mcp/cimd';
import type * as CimdModule from '../../src/mcp/cimd';
import type * as McpServerModule from '../../src/mcp/server';
import { authHandler, fakeAsMetadata } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let cimd!: typeof CimdModule;
let serverMod!: typeof McpServerModule;

beforeAll(async () => {
  vi.stubEnv('WEB_URL', 'https://docket.test');
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

describe('CIMD client_id URL validation', () => {
  it('rejects a client_id that does not parse as a URL at all', async () => {
    await expect(
      cimd.resolveCimdClient('not a url', deps({ client_id: 'not a url', redirect_uris: [] })),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('rejects a client_id URL carrying credentials or a fragment', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://user:pass@allowed.example/client.json',
        deps({ client_id: 'https://user:pass@allowed.example/client.json', redirect_uris: [] }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json#frag',
        deps({ client_id: 'https://allowed.example/client.json#frag', redirect_uris: [] }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('rejects a client_id whose host is a raw IP rather than a DNS name', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://93.184.216.34/client.json',
        deps({ client_id: 'https://93.184.216.34/client.json', redirect_uris: [] }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });
});

describe('CIMD private-network resolution guard', () => {
  const CLIENT_ID = 'https://allowed.example/client.json';
  const validDoc = {
    client_id: CLIENT_ID,
    redirect_uris: ['https://allowed.example/callback'],
  };

  it('refuses when DNS resolves to no addresses at all', async () => {
    await expect(cimd.resolveCimdClient(CLIENT_ID, deps(validDoc, []))).rejects.toMatchObject({
      code: 'invalid_client',
    });
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['this-network', '0.5.5.5'],
    ['shared-nat', '100.64.0.1'],
    ['link-local', '169.254.1.1'],
    ['private-16', '172.16.0.1'],
    ['private-24', '192.168.1.1'],
    ['benchmarking', '198.18.0.1'],
    ['documentation-3', '198.51.100.1'],
    ['documentation-1', '192.0.2.1'],
    ['documentation-2', '203.0.113.5'],
    ['multicast', '224.0.0.1'],
  ])('refuses an IPv4 %s address (%s)', async (_label, address) => {
    await expect(
      cimd.resolveCimdClient(CLIENT_ID, deps(validDoc, [address])),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('accepts an ordinary public IPv4 address', async () => {
    await expect(
      cimd.resolveCimdClient(CLIENT_ID, deps(validDoc, ['93.184.216.34'])),
    ).resolves.toMatchObject({ clientId: CLIENT_ID });
  });

  it.each([
    ['unspecified', '::'],
    ['loopback', '::1'],
    ['unique-local-fc', 'fc00::1'],
    ['unique-local-fd', 'fd12::1'],
    ['link-local-fe8', 'fe80::1'],
    ['link-local-fea', 'fea0::1'],
    ['multicast', 'ff02::1'],
    ['documentation', '2001:db8::1'],
    ['v4-mapped private', '::ffff:127.0.0.1'],
  ])('refuses an IPv6 %s address (%s)', async (_label, address) => {
    const d: CimdDeps = {
      resolveHost: vi.fn(async () => [{ address, family: 6 as const }]),
      fetchJson: vi.fn(async () => validDoc),
    };
    await expect(cimd.resolveCimdClient(CLIENT_ID, d)).rejects.toMatchObject({
      code: 'invalid_client',
    });
  });

  it('accepts an ordinary public IPv6 address, including a v4-mapped public one', async () => {
    for (const address of ['2606:4700:4700::1111', '::ffff:93.184.216.34']) {
      const d: CimdDeps = {
        resolveHost: vi.fn(async () => [{ address, family: 6 as const }]),
        fetchJson: vi.fn(async () => validDoc),
      };
      await expect(cimd.resolveCimdClient(CLIENT_ID, d)).resolves.toMatchObject({
        clientId: CLIENT_ID,
      });
    }
  });

  it('refuses when only one of several resolved addresses is private', async () => {
    await expect(
      cimd.resolveCimdClient(CLIENT_ID, deps(validDoc, ['93.184.216.34', '10.0.0.1'])),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });
});

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

  it('accepts any public HTTPS metadata host without a vendor allowlist', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://outside.example/client.json',
        deps({
          client_id: 'https://outside.example/client.json',
          redirect_uris: ['https://outside.example/callback'],
        }),
      ),
    ).resolves.toMatchObject({ clientId: 'https://outside.example/client.json' });
  });

  it('rejects a redirect_uris entry that does not parse as a URL', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json',
        deps({
          client_id: 'https://allowed.example/client.json',
          redirect_uris: ['not a url'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
  });

  it('rejects a redirect_uri carrying credentials or a fragment', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json',
        deps({
          client_id: 'https://allowed.example/client.json',
          redirect_uris: ['https://user:pass@allowed.example/callback'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json',
        deps({
          client_id: 'https://allowed.example/client.json',
          redirect_uris: ['https://allowed.example/callback#frag'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
  });

  it('rejects redirect_uris that is missing, empty, or not an array of strings', async () => {
    for (const redirectUris of [undefined, [], [42]]) {
      await expect(
        cimd.resolveCimdClient(
          'https://allowed.example/client.json',
          deps({ client_id: 'https://allowed.example/client.json', redirect_uris: redirectUris }),
        ),
      ).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
    }
  });

  it('rejects a confidential (non-"none") token_endpoint_auth_method', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json',
        deps({
          client_id: 'https://allowed.example/client.json',
          redirect_uris: ['https://allowed.example/callback'],
          token_endpoint_auth_method: 'client_secret_basic',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client_metadata' });
  });

  it('rejects grant_types that omit authorization_code', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json',
        deps({
          client_id: 'https://allowed.example/client.json',
          redirect_uris: ['https://allowed.example/callback'],
          grant_types: ['implicit'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client_metadata' });
  });

  it('rejects response_types that omit code', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json',
        deps({
          client_id: 'https://allowed.example/client.json',
          redirect_uris: ['https://allowed.example/callback'],
          response_types: ['token'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client_metadata' });
  });

  it('rejects a non-https logo_uri', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json',
        deps({
          client_id: 'https://allowed.example/client.json',
          redirect_uris: ['https://allowed.example/callback'],
          logo_uri: 'http://allowed.example/logo.png',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client_metadata' });
  });

  it('rejects a metadata document that is not a JSON object', async () => {
    for (const bad of [null, ['array'], 'a string']) {
      const d: CimdDeps = {
        resolveHost: vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]),
        fetchJson: vi.fn(async () => bad),
      };
      await expect(
        cimd.resolveCimdClient('https://allowed.example/client.json', d),
      ).rejects.toMatchObject({ code: 'invalid_client_metadata' });
    }
  });

  it('falls back to the client_id’s hostname when client_name is absent', async () => {
    const client = await cimd.resolveCimdClient(
      'https://allowed.example/client.json',
      deps({
        client_id: 'https://allowed.example/client.json',
        redirect_uris: ['https://allowed.example/callback'],
      }),
    );
    expect(client.name).toBe('allowed.example');
    expect(client.logoUri).toBeNull();
  });

  it('upserts a validated public CIMD client into oauth_client', async () => {
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
      .from(oauthClient)
      .where(eq(oauthClient.clientId, 'https://allowed.example/client.json'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Allowed Client',
      icon: 'https://allowed.example/logo.png',
      clientId: 'https://allowed.example/client.json',
      clientSecret: '',
      redirectUris: ['https://allowed.example/callback'],
      type: 'public',
      public: true,
      disabled: false,
    });
    expect(assertDefined(rows[0]).metadata).toMatchObject({
      cimd: true,
      cimdDocumentUrl: 'https://allowed.example/client.json',
    });
  });

  it('re-registering the same CIMD client updates the existing row in place', async () => {
    const clientId = 'https://allowed.example/reregister-client.json';
    const first = await cimd.resolveCimdClient(
      clientId,
      deps({
        client_id: clientId,
        client_name: 'First Name',
        redirect_uris: ['https://allowed.example/callback'],
      }),
    );
    await cimd.upsertCimdClient(first);

    const second = await cimd.resolveCimdClient(
      clientId,
      deps({
        client_id: clientId,
        client_name: 'Renamed',
        redirect_uris: ['https://allowed.example/new-callback'],
      }),
    );
    await cimd.upsertCimdClient(second);

    const rows = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Renamed',
      redirectUris: ['https://allowed.example/new-callback'],
    });
  });

  it('refuses to overwrite a client_id already registered outside CIMD', async () => {
    const clientId = 'https://allowed.example/hijack-client.json';
    await db.insert(oauthClient).values({
      clientId,
      name: 'Not a CIMD client',
      clientSecret: 'sec',
      redirectUris: ['https://allowed.example/callback'],
      type: 'web',
    });

    const client = await cimd.resolveCimdClient(
      clientId,
      deps({ client_id: clientId, redirect_uris: ['https://allowed.example/callback'] }),
    );
    await expect(cimd.upsertCimdClient(client)).rejects.toMatchObject({ code: 'invalid_client' });
  });
});

describe('CIMD authorize preflight middleware', () => {
  /** Mounts the middleware exactly like server.ts does, in front of a stub authorize handler. */
  function authorizeApp(d?: CimdDeps): { app: Hono; downstream: ReturnType<typeof vi.fn> } {
    const downstream = vi.fn((c: { text: (s: string) => Response }) => c.text('authorize'));
    const app = new Hono();
    app.use('/api/auth/oauth2/authorize', cimd.createCimdAuthorizeMiddleware(d));
    app.get('/api/auth/oauth2/authorize', (c) => downstream(c));
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
      `/api/auth/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code`,
    );

    expect(res.status).toBe(200);
    expect(downstream).toHaveBeenCalledTimes(1);
    const rows = await db
      .select({ type: oauthClient.type })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId));
    expect(rows).toEqual([{ type: 'public' }]);
  });

  it('rejects an untrusted URL-form client_id with an OAuth error before Better Auth', async () => {
    const clientId = 'https://outside.example/client.json';
    const { app, downstream } = authorizeApp();

    const res = await app.request(
      `/api/auth/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code`,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
    expect(downstream).not.toHaveBeenCalled();
  });

  it('passes opaque client_id values straight through untouched', async () => {
    const { app, downstream } = authorizeApp();

    const res = await app.request('/api/auth/oauth2/authorize?client_id=abc123&response_type=code');

    expect(res.status).toBe(200);
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('still treats an http:// client_id as URL-form (and then rejects it)', async () => {
    const { app, downstream } = authorizeApp();
    const clientId = 'http://outside.example/client.json';

    const res = await app.request(
      `/api/auth/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code`,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
    expect(downstream).not.toHaveBeenCalled();
  });

  it('reports a non-CimdError failure (e.g. a network throw) as invalid_client', async () => {
    const clientId = 'https://allowed.example/network-fail-client.json';
    const failingDeps: CimdDeps = {
      resolveHost: vi.fn(async () => {
        throw new Error('DNS server unreachable');
      }),
      fetchJson: vi.fn(),
    };
    const { app, downstream } = authorizeApp(failingDeps);

    const res = await app.request(
      `/api/auth/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code`,
    );

    expect(res.status).toBe(400);
    const problem = (await res.json()) as { error: string; error_description: string };
    expect(problem.error).toBe('invalid_client');
    expect(problem.error_description).not.toContain('DNS server unreachable');
    expect(downstream).not.toHaveBeenCalled();
  });
});

describe('MCP authorization server metadata', () => {
  it('advertises CIMD support in the root AS metadata document', async () => {
    authHandler.mockResolvedValueOnce(
      new Response(JSON.stringify(fakeAsMetadata('https://api.docket.test'))),
    );
    const res = await serverMod.authorizationServerMetadata({
      req: { url: 'https://api.docket.test/.well-known/oauth-authorization-server' },
      json: (body: unknown) => new Response(JSON.stringify(body)),
    } as never);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['client_id_metadata_document_supported']).toBe(true);
    // The web origin, not the API origin: authorization_endpoint is the one field this handler
    // rewrites, since it's the only endpoint that checks the caller's session cookie.
    expect(body['authorization_endpoint']).toBe('https://docket.test/api/auth/oauth2/authorize');
    expect(body['registration_endpoint']).toBe('https://api.docket.test/api/auth/oauth2/register');
    expect(body['code_challenge_methods_supported']).toEqual(['S256']);
  });
});
