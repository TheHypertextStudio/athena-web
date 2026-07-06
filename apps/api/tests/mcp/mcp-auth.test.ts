import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn<
  () => Promise<{ user: { id: string; name: string; email: string } } | null>
>(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';

import { ApiError } from '../../src/error';
import type * as AuthModule from '../../src/mcp/auth';
import type * as ResultModule from '../../src/mcp/result';
import { getMigratedDb } from '../support/db';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';
// Configure an allowed origin BEFORE the env module is imported so the slice picks it up.
process.env['MCP_ALLOWED_ORIGINS'] = 'https://app.docket.dev, https://admin.docket.dev';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let authMod!: typeof AuthModule;
let resultMod!: typeof ResultModule;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  authMod = await import('../../src/mcp/auth');
  resultMod = await import('../../src/mcp/result');
});

afterEach(() => getSession.mockReset());

/** Build a Headers object carrying the given origin (or none). */
function hdrs(origin?: string): Headers {
  const h = new Headers();
  if (origin !== undefined) h.set('origin', origin);
  return h;
}

describe('isOriginAllowed', () => {
  it('allows a missing origin (non-browser clients)', () => {
    expect(authMod.isOriginAllowed(hdrs())).toBe(true);
  });

  it('allows a configured origin', () => {
    expect(authMod.isOriginAllowed(hdrs('https://app.docket.dev'))).toBe(true);
  });

  it('allows localhost in non-production', () => {
    expect(authMod.isOriginAllowed(hdrs('http://localhost:3000'))).toBe(true);
    expect(authMod.isOriginAllowed(hdrs('http://127.0.0.1:5173'))).toBe(true);
  });

  it('rejects a malformed origin URL (URL parse throws → false)', () => {
    expect(authMod.isOriginAllowed(hdrs('::::not a url'))).toBe(false);
  });

  it('rejects a non-localhost, non-configured origin', () => {
    expect(authMod.isOriginAllowed(hdrs('https://evil.example.com'))).toBe(false);
  });
});

describe('resolveMcpContext', () => {
  it('throws on a rejected origin', async () => {
    await expect(authMod.resolveMcpContext(hdrs('https://evil.example.com'))).rejects.toMatchObject(
      { status: 401 },
    );
  });

  it('throws when there is no session', async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(authMod.resolveMcpContext(hdrs())).rejects.toMatchObject({ status: 401 });
  });

  it('resolves a cookie-session context with the full scope set, mapping an empty name to null', async () => {
    getSession.mockResolvedValueOnce({ user: { id: 'u1', name: '', email: 'u1@e.com' } });
    const ctx = await authMod.resolveMcpContext(hdrs());
    // A consented first-party cookie session is granted the full scope set (the per-org
    // grant cascade remains the binding layer for it).
    expect(ctx).toEqual({
      userId: 'u1',
      userName: null,
      userEmail: 'u1@e.com',
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    });
  });

  it('keeps a present name', async () => {
    getSession.mockResolvedValueOnce({
      user: { id: 'u2', name: 'Ada', email: 'u2@e.com' },
    });
    const ctx = await authMod.resolveMcpContext(hdrs());
    expect(ctx.userName).toBe('Ada');
  });

  it('rejects a Bearer token when the RS is not configured for OAuth (no issuer/resource)', async () => {
    // This RS deploy never advertised an issuer + canonical resource, so a Bearer token
    // cannot have been minted by *this* AS for *this* resource → 401 (mcp-surface.md §2.5).
    delete process.env['MCP_ISSUER_URL'];
    delete process.env['MCP_RESOURCE_URL'];
    const h = new Headers();
    h.set('authorization', 'Bearer some-token');
    await expect(authMod.resolveMcpContext(h)).rejects.toMatchObject({ status: 401 });
    // The cookie resolver was never consulted on the Bearer path.
    expect(getSession).not.toHaveBeenCalled();
  });
});

describe('resolveActor', () => {
  it('resolves the caller actor in an org', async () => {
    const slug = `ra-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'A', email: `${slug}@e.com` })
      .returning({ id: schema.user.id });
    const [a] = await db
      .insert(schema.actor)
      .values({ organizationId: org!.id, kind: 'human', displayName: 'A', userId: u!.id })
      .returning({ id: schema.actor.id });
    const actor = await authMod.resolveActor(
      { userId: u!.id, userName: 'A', userEmail: 'a@e.com', scopes: ['work:read'] },
      org!.id,
    );
    expect(actor).toEqual({ orgId: org!.id, actorId: a!.id });
  });

  it('404s when the caller is not a member', async () => {
    const slug = `ra2-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    await expect(
      authMod.resolveActor(
        { userId: 'ghost', userName: null, userEmail: 'g@e.com', scopes: ['work:read'] },
        org!.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('result helpers', () => {
  it('jsonResult wraps data as pretty text', () => {
    const res = resultMod.jsonResult({ a: 1 });
    expect(res.content[0]).toMatchObject({ type: 'text' });
    expect((res.content[0] as { text: string }).text).toContain('"a": 1');
  });

  it('errorResult flags isError', () => {
    const res = resultMod.errorResult('boom');
    expect(res.isError).toBe(true);
  });

  it('runTool maps an ApiError to a readable isError result', async () => {
    const res = await resultMod.runTool(async () => {
      throw new ApiError(404, 'not_found', 'gone');
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toBe('not_found: gone');
  });

  it('runTool maps an unexpected error to a generic Internal error', async () => {
    const res = await resultMod.runTool(async () => {
      throw new Error('unexpected');
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toBe('Internal error');
  });

  it('runTool returns the body result on success', async () => {
    const res = await resultMod.runTool(async () => resultMod.jsonResult({ ok: true }));
    expect(res.isError).toBeFalsy();
  });
});

describe('isOriginAllowed in production', () => {
  it('rejects localhost when NODE_ENV is production', async () => {
    vi.resetModules();
    process.env['NODE_ENV'] = 'production';
    vi.doMock('@docket/auth', () => ({ auth: { api: { getSession: vi.fn(async () => null) } } }));
    const fresh = await import('../../src/mcp/auth');
    expect(fresh.isOriginAllowed(hdrs('http://localhost:3000'))).toBe(false);
    // A configured origin is still allowed in production.
    expect(fresh.isOriginAllowed(hdrs('https://app.docket.dev'))).toBe(true);
    process.env['NODE_ENV'] = 'test';
    vi.doUnmock('@docket/auth');
    vi.resetModules();
  });
});
