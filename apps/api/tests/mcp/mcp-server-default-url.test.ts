/**
 * `@docket/api` — the request-origin/issuer fallbacks in `src/mcp/server.ts` that only apply when
 * no explicit resource/issuer URL is configured: `canonicalResourceUrl`'s fallback to the
 * request's own origin, and `authorizationServerMetadata`'s two issuer fallbacks.
 *
 * @remarks
 * Deliberately its own file. `packages/env/src/api.ts` derives `MCP_RESOURCE_URL` and
 * `MCP_ISSUER_URL` from `API_URL` whenever `API_URL` is present — and the shared vitest env
 * config (`tests/support/env.ts`) sets `API_URL` for every other test file, so neither is ever
 * actually absent anywhere else in the suite. Reaching either fallback requires unsetting
 * `API_URL` itself (the derivation is conditioned on it) before `@docket/env/api` is first
 * imported, which happens transitively the moment `mcp/server.ts` is imported.
 */
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  authorizationServerMetadata as AuthorizationServerMetadata,
  protectedResourceMetadata as ProtectedResourceMetadata,
} from '../../src/mcp/server';
import { authHandler, fakeAsMetadata } from '../support/auth-mock';

let protectedResourceMetadata!: typeof ProtectedResourceMetadata;
let authorizationServerMetadata!: typeof AuthorizationServerMetadata;

// `process.env` is a live, shared object for the whole worker process — restore it once this
// file's own (already-memoized) `@docket/env/api` import has captured the unset state, so a
// sibling test file sharing this worker still sees the normal baseline env.
const savedApiUrl = process.env['API_URL'];
const savedResourceUrl = process.env['MCP_RESOURCE_URL'];
const savedIssuerUrl = process.env['MCP_ISSUER_URL'];

beforeAll(async () => {
  delete process.env['API_URL'];
  delete process.env['MCP_RESOURCE_URL'];
  delete process.env['MCP_ISSUER_URL'];
  ({ protectedResourceMetadata, authorizationServerMetadata } =
    await import('../../src/mcp/server'));
});

afterAll(() => {
  if (savedApiUrl !== undefined) process.env['API_URL'] = savedApiUrl;
  if (savedResourceUrl !== undefined) process.env['MCP_RESOURCE_URL'] = savedResourceUrl;
  if (savedIssuerUrl !== undefined) process.env['MCP_ISSUER_URL'] = savedIssuerUrl;
});

function app(): Hono {
  const instance = new Hono();
  instance.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);
  instance.get('/.well-known/oauth-authorization-server', authorizationServerMetadata);
  return instance;
}

describe('canonicalResourceUrl fallback (no MCP_RESOURCE_URL configured)', () => {
  it('derives the resource URI from the request origin instead of a fixed URL', async () => {
    const res = await app().request(
      new Request('https://tenant-a.docket.test/.well-known/oauth-protected-resource/mcp'),
    );
    expect(res.status).toBe(200);
    const prm = (await res.json()) as { resource: string };
    expect(prm.resource).toBe('https://tenant-a.docket.test/mcp');
  });

  it('re-derives per request, following whatever origin the caller actually used', async () => {
    const instance = app();
    const first = await instance.request(
      new Request('https://tenant-a.docket.test/.well-known/oauth-protected-resource/mcp'),
    );
    const second = await instance.request(
      new Request('https://tenant-b.docket.test/.well-known/oauth-protected-resource/mcp'),
    );
    expect(((await first.json()) as { resource: string }).resource).toBe(
      'https://tenant-a.docket.test/mcp',
    );
    expect(((await second.json()) as { resource: string }).resource).toBe(
      'https://tenant-b.docket.test/mcp',
    );
  });
});

describe('authorizationServerMetadata issuer fallbacks (no MCP_ISSUER_URL configured)', () => {
  it('derives the issuer from the request origin, and the upstream document’s own issuer field', async () => {
    authHandler.mockResolvedValueOnce(
      new Response(JSON.stringify(fakeAsMetadata('https://auth.docket.test'))),
    );
    const res = await app().request(
      new Request('https://tenant-a.docket.test/.well-known/oauth-authorization-server'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { issuer: string };
    // oauthIssuer() is null without MCP_ISSUER_URL, so this falls through to the upstream
    // Better Auth document's own `issuer` field rather than the request-derived one.
    expect(body.issuer).toBe('https://auth.docket.test/api/auth');
  });

  it('falls all the way through to the request-derived issuer when upstream omits one too', async () => {
    const withoutIssuer = fakeAsMetadata('https://auth.docket.test');
    delete withoutIssuer['issuer'];
    authHandler.mockResolvedValueOnce(new Response(JSON.stringify(withoutIssuer)));
    const res = await app().request(
      new Request('https://tenant-a.docket.test/.well-known/oauth-authorization-server'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { issuer: string };
    // Neither MCP_ISSUER_URL nor the upstream document names an issuer, so the handler falls
    // back to `${<request-origin-derived issuer>}/api/auth`.
    expect(body.issuer).toBe('https://tenant-a.docket.test/api/auth');
  });
});
