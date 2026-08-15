import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { ApiError } from '../../src/error';
import type * as AuthModule from '../../src/mcp/auth';
import type * as ResultModule from '../../src/mcp/result';
import { getSession, resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { clearDocketPro } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

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

  it('allows any exact HTTPS origin without a vendor list', () => {
    expect(authMod.isOriginAllowed(hdrs('https://app.example.com'))).toBe(true);
    expect(authMod.isOriginAllowed(hdrs('https://outside.example'))).toBe(true);
  });

  it('allows localhost in non-production', () => {
    expect(authMod.isOriginAllowed(hdrs('http://localhost:3000'))).toBe(true);
    expect(authMod.isOriginAllowed(hdrs('http://127.0.0.1:5173'))).toBe(true);
  });

  it('rejects a malformed origin URL (URL parse throws → false)', () => {
    expect(authMod.isOriginAllowed(hdrs('::::not a url'))).toBe(false);
  });

  it('rejects non-HTTPS remote origins', () => {
    expect(authMod.isOriginAllowed(hdrs('http://outside.example'))).toBe(false);
  });
});

describe('resolveMcpContext', () => {
  it('throws on a rejected origin', async () => {
    await expect(authMod.resolveMcpContext(hdrs('http://outside.example'))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('throws when there is no session', async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(authMod.resolveMcpContext(hdrs())).rejects.toMatchObject({ status: 401 });
  });

  it('ignores browser sessions on the public MCP resource', async () => {
    getSession.mockResolvedValueOnce({ user: { id: 'u1', name: '', email: 'u1@e.com' } });
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
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'A', email: `${slug}@e.com` })
      .returning({ id: schema.user.id });
    const [a] = await db
      .insert(schema.actor)
      .values({
        organizationId: assertDefined(org).id,
        kind: 'human',
        displayName: 'A',
        userId: assertDefined(u).id,
      })
      .returning({ id: schema.actor.id });
    const actor = await authMod.resolveActor(
      {
        principal: {
          kind: 'user',
          userId: assertDefined(u).id,
          userName: 'A',
          userEmail: 'a@e.com',
        },
        scopes: ['work:read'],
      },
      assertDefined(org).id,
    );
    expect(actor).toEqual({ orgId: assertDefined(org).id, actorId: assertDefined(a).id });
  });

  it('requires Docket Pro after membership is established', async () => {
    const slug = `ra-pro-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'A', email: `${slug}@e.com` })
      .returning({ id: schema.user.id });
    await db.insert(schema.actor).values({
      organizationId: assertDefined(org).id,
      kind: 'human',
      displayName: 'A',
      userId: assertDefined(u).id,
    });
    await clearDocketPro(db, schema, assertDefined(org).id);

    await expect(
      authMod.resolveActor(
        {
          principal: {
            kind: 'user',
            userId: assertDefined(u).id,
            userName: 'A',
            userEmail: 'a@e.com',
          },
          scopes: ['work:read'],
        },
        assertDefined(org).id,
      ),
    ).rejects.toMatchObject({ status: 402, code: 'product_required' });
  });

  it('404s when the caller is not a member', async () => {
    const slug = `ra2-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    await expect(
      authMod.resolveActor(
        {
          principal: { kind: 'user', userId: 'ghost', userName: null, userEmail: 'g@e.com' },
          scopes: ['work:read'],
        },
        assertDefined(org).id,
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
  it('rejects localhost when NODE_ENV is production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const fresh = await import('../../src/mcp/auth');
      expect(fresh.isOriginAllowed(hdrs('http://localhost:3000'))).toBe(false);
      // Exact HTTPS origins remain vendor-neutral in production.
      expect(fresh.isOriginAllowed(hdrs('https://app.example.com'))).toBe(true);
    } finally {
      vi.resetModules();
    }
  });
});
