import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { ApiError } from '../../src/error';
import type * as AuthModule from '../../src/mcp/auth';
import type * as ResultModule from '../../src/mcp/result';
import { getSession, resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb, grantDocketPro } from '../support/db';

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

afterEach(() => {
  resetAuthMocks();
});

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

  it('allows any valid HTTPS origin without a vendor allowlist', () => {
    expect(authMod.isOriginAllowed(hdrs('https://app.example.com'))).toBe(true);
    expect(authMod.isOriginAllowed(hdrs('https://some-new-client.example'))).toBe(true);
  });

  it('allows localhost in non-production', () => {
    expect(authMod.isOriginAllowed(hdrs('http://localhost:3000'))).toBe(true);
    expect(authMod.isOriginAllowed(hdrs('http://127.0.0.1:5173'))).toBe(true);
  });

  it('rejects a malformed origin URL (URL parse throws → false)', () => {
    expect(authMod.isOriginAllowed(hdrs('::::not a url'))).toBe(false);
  });

  it('rejects an insecure non-local origin', () => {
    expect(authMod.isOriginAllowed(hdrs('http://client.example.com'))).toBe(false);
  });
});

describe('resolveMcpContext', () => {
  it('returns forbidden for an invalid origin', async () => {
    await expect(
      authMod.resolveMcpContext(hdrs('http://client.example.com')),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('requires an OAuth bearer token and never consults the cookie session', async () => {
    await expect(authMod.resolveMcpContext(hdrs())).rejects.toMatchObject({ status: 401 });
    expect(getSession).not.toHaveBeenCalled();
  });

  it('rejects a Bearer token when the RS is not configured for OAuth (no issuer/resource)', async () => {
    // This RS deploy never advertised an issuer + canonical resource, so a Bearer token
    // cannot have been minted by *this* AS for *this* resource → 401 (mcp-surface.md §2.5).
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
    await grantDocketPro(schema, org!.id);
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'A', email: `${slug}@e.com` })
      .returning({ id: schema.user.id });
    const [a] = await db
      .insert(schema.actor)
      .values({ organizationId: org!.id, kind: 'human', displayName: 'A', userId: u!.id })
      .returning({ id: schema.actor.id });
    const actor = await authMod.resolveActor(
      {
        principal: { kind: 'user', userId: u!.id, userName: 'A', userEmail: 'a@e.com' },
        scopes: ['work:read'],
      },
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
    await grantDocketPro(schema, org!.id);
    await expect(
      authMod.resolveActor(
        {
          principal: { kind: 'user', userId: 'ghost', userName: null, userEmail: 'g@e.com' },
          scopes: ['work:read'],
        },
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

  it('runTool maps an ApiError by code without exposing its message', async () => {
    const res = await resultMod.runTool(async () => {
      throw new ApiError(404, 'not_found', 'DATABASE_URL is missing');
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toBe(
      'not_found: That item could not be found.',
    );
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
  it('accepts valid HTTPS origins without configuration and rejects insecure origins', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const fresh = await import('../../src/mcp/auth');
      expect(fresh.isOriginAllowed(hdrs('http://localhost:3000'))).toBe(false);
      expect(fresh.isOriginAllowed(hdrs('https://app.example.com'))).toBe(true);
      expect(fresh.isOriginAllowed(hdrs('https://previously-unknown.example'))).toBe(true);
    } finally {
      vi.resetModules();
    }
  });
});
