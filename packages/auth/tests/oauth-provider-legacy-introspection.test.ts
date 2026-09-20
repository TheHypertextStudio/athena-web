import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import { describe, expect, it, vi } from 'vitest';

import { ensureIntrospectionLegacyGrant } from '../src/oauth-provider-legacy-introspection';

const MCP = 'https://api.clearthedocket.com/mcp';
const RESOURCES = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: MCP,
  restResource: 'https://api.clearthedocket.com/v1',
};

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return { azp: 'client_1', sub: 'user_1', aud: MCP, iat: now - 30, exp: now + 30, ...overrides };
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'client_1',
    disabled: false,
    skipConsent: true,
    docketLegacyTrusted: true,
    docketLegacyBefore: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function adapter(evidence: {
  clients?: unknown[];
  existing?: unknown[];
  users?: unknown[];
  consents?: unknown[];
  refreshes?: unknown[];
}) {
  const create = vi.fn(async () => ({}));
  const findMany = vi.fn(async (input: { model: string }) => {
    if (input.model === 'oauthClient') return evidence.clients ?? [client()];
    if (input.model === 'oauthResourceGrant') return evidence.existing ?? [];
    if (input.model === 'user') return evidence.users ?? [{ id: 'user_1' }];
    if (input.model === 'oauthConsent') return evidence.consents ?? [];
    if (input.model === 'oauthRefreshToken') return evidence.refreshes ?? [];
    throw new Error(`Unexpected model ${input.model}`);
  });
  return { adapter: { findMany, create } as unknown as DBTransactionAdapter, create };
}

describe('legacy OAuth introspection materialization', () => {
  it.each([
    ['non-string client', { azp: 1 }],
    ['non-string user', { sub: 1 }],
    ['wrong audience', { aud: RESOURCES.restResource }],
    ['non-number issuance', { iat: 'now' }],
    ['unsafe issuance', { iat: Number.MAX_VALUE }],
    ['non-number expiration', { exp: 'later' }],
    ['unsafe expiration', { exp: Number.MAX_VALUE }],
  ])('rejects %s claims before storage access', async (_label, patch) => {
    const harness = adapter({});
    await expect(
      ensureIntrospectionLegacyGrant(harness.adapter, claims(patch), RESOURCES),
    ).resolves.toBe(false);
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('accepts the one existing legacy grant without creating another', async () => {
    const harness = adapter({ existing: [{ id: 'grant_1' }] });
    await expect(
      ensureIntrospectionLegacyGrant(harness.adapter, claims(), RESOURCES),
    ).resolves.toBe(true);
    expect(harness.create).not.toHaveBeenCalled();
  });

  it.each([
    ['multiple existing grants', { existing: [{ id: 'one' }, { id: 'two' }] }],
    ['missing client', { clients: [] }],
    ['multiple clients', { clients: [client(), client()] }],
    ['empty client row', { clients: [undefined] }],
    ['disabled client', { clients: [client({ disabled: true })] }],
    ['consent-required client', { clients: [client({ skipConsent: false })] }],
    ['untrusted client', { clients: [client({ docketLegacyTrusted: false })] }],
    ['missing cutoff', { clients: [client({ docketLegacyBefore: null })] }],
    ['missing user', { users: [] }],
    ['multiple users', { users: [{ id: 'one' }, { id: 'two' }] }],
    ['standing consent', { consents: [{ id: 'consent_1' }] }],
    ['standing refresh', { refreshes: [{ id: 'refresh_1' }] }],
  ])('rejects %s evidence', async (_label, evidence) => {
    const harness = adapter(evidence);
    await expect(
      ensureIntrospectionLegacyGrant(harness.adapter, claims(), RESOURCES),
    ).resolves.toBe(false);
    expect(harness.create).not.toHaveBeenCalled();
  });

  it.each([
    ['issuance after cutoff', { iat: 2_000_001 }, new Date(2_000_000 * 1_000)],
    ['nonpositive lifetime', { iat: 2_000_000, exp: 2_000_000 }, new Date(2_000_001 * 1_000)],
    [
      'lifetime over fifteen minutes',
      { iat: 2_000_000, exp: 2_000_901 },
      new Date(2_000_001 * 1_000),
    ],
    ['expired credential', { iat: 1, exp: 2 }, new Date(Date.now() + 60_000)],
    ['closed compatibility deadline', { iat: 1, exp: 2 }, new Date(0)],
  ])('rejects a legacy grant with %s', async (_label, patch, cutoff) => {
    const harness = adapter({ clients: [client({ docketLegacyBefore: cutoff })] });
    await expect(
      ensureIntrospectionLegacyGrant(harness.adapter, claims(patch), RESOURCES),
    ).resolves.toBe(false);
    expect(harness.create).not.toHaveBeenCalled();
  });

  it('creates one bounded trusted MCP grant from eligible evidence', async () => {
    const cutoff = new Date(Date.now() + 60_000);
    const harness = adapter({ clients: [client({ docketLegacyBefore: cutoff })] });

    await expect(
      ensureIntrospectionLegacyGrant(harness.adapter, claims(), RESOURCES),
    ).resolves.toBe(true);
    expect(harness.create).toHaveBeenCalledWith({
      model: 'oauthResourceGrant',
      forceAllowId: true,
      data: expect.objectContaining({
        clientId: 'client_1',
        userId: 'user_1',
        authorizationKind: 'trusted_mcp',
        resourceUri: MCP,
        legacyBefore: cutoff,
      }),
    });
  });
});
