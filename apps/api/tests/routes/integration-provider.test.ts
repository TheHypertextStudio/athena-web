import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ConnectorProvider } from '@docket/integrations';

import type * as ProviderModule from '../../src/routes/integration-provider';
import { getDb, seedBaseOrg } from '../support/routes-harness';

// The production token-resolution path (Actor → Better Auth `user` → access token + refresh)
// is gated behind `APP_MODE` and bypassed by the mock sentinel in `local`/`test`, so it was
// never exercised. `resolveLiveConnectorToken` drops the env gate and accepts an injected
// fetcher, letting us drive every branch with a real DB actor and a fake token fetch.

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let resolveLiveConnectorToken!: typeof ProviderModule.resolveLiveConnectorToken;
let resolveConnectorToken!: typeof ProviderModule.resolveConnectorToken;
let resolveActorConnectorIdentity!: typeof ProviderModule.resolveActorConnectorIdentity;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/integration-provider');
  resolveLiveConnectorToken = mod.resolveLiveConnectorToken;
  resolveConnectorToken = mod.resolveConnectorToken;
  resolveActorConnectorIdentity = mod.resolveActorConnectorIdentity;
});

let userSeq = 0;

/** Seed a global `user` plus a human `actor` linked to it; returns both ids. */
async function seedLinkedActor(orgId: string): Promise<{ actorId: string; userId: string }> {
  const email = `linked-${userSeq++}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const userId = u!.id;
  const [a] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId })
    .returning({ id: schema.actor.id });
  return { actorId: a!.id, userId };
}

/** Link one provider grant to a test user. */
async function seedProviderAccount(
  userId: string,
  providerId: string,
  accountId = `${providerId}-${Math.random().toString(36).slice(2)}`,
): Promise<string> {
  await db.insert(schema.account).values({ userId, providerId, accountId });
  return accountId;
}

/** Seed a human `actor` with NO linked global user (the "never signed in" case). */
async function seedUnlinkedActor(orgId: string): Promise<string> {
  const [a] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'NoLink' })
    .returning({ id: schema.actor.id });
  return a!.id;
}

describe('resolveLiveConnectorToken', () => {
  it('returns the fetched access token for a linked actor', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId, userId } = await seedLinkedActor(orgId);
    const accountId = await seedProviderAccount(userId, 'github');

    const calls: { providerId: string; userId: string; accountId?: string }[] = [];
    const res = await resolveLiveConnectorToken(actorId, 'github', async (input) => {
      calls.push(input);
      return { accessToken: 'live-token' };
    });

    expect(res).toEqual({ ok: true, token: 'live-token' });
    // The Actor was resolved to its global user id and that drove the token fetch.
    expect(calls).toEqual([{ providerId: 'github', userId, accountId }]);
  });

  it('asks for re-auth when the actor has no linked user (never touches the fetcher)', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const actorId = await seedUnlinkedActor(orgId);

    const fetcher = vi.fn();
    const res = await resolveLiveConnectorToken(actorId, 'github', fetcher);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('needs_reauth');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks for re-auth when the actor does not exist', async () => {
    const fetcher = vi.fn();
    const res = await resolveLiveConnectorToken('actor_missing', 'github', fetcher);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('needs_reauth');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks for re-auth when an integration no longer has a credential owner', async () => {
    const fetcher = vi.fn();
    const res = await resolveLiveConnectorToken(null, 'linear', fetcher, 'linear-account');

    expect(res).toMatchObject({ ok: false, reason: 'needs_reauth' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks for re-auth when the grant yields no access token', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId, userId } = await seedLinkedActor(orgId);
    await seedProviderAccount(userId, 'linear');

    const res = await resolveLiveConnectorToken(actorId, 'linear', async () => ({
      accessToken: null,
    }));

    expect(res.ok).toBe(false);
    // The user-facing remediation names the provider to reconnect.
    if (!res.ok) expect(res.message).toContain('linear');
  });

  it('asks for re-auth when the token fetch throws (revoked / refresh failure)', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId, userId } = await seedLinkedActor(orgId);
    await seedProviderAccount(userId, 'github');

    const res = await resolveLiveConnectorToken(actorId, 'github', async () => {
      throw new Error('refresh-token exchange failed');
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('needs_reauth');
  });

  it('maps each connector provider to its Better Auth social providerId', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId, userId } = await seedLinkedActor(orgId);

    const cases: [ConnectorProvider, string][] = [
      ['github', 'github'],
      ['linear', 'linear'],
      ['calendar', 'google'],
      ['gmail', 'google'],
      ['gtasks', 'google'],
      ['drive', 'google'],
    ];

    for (const [provider, expected] of cases) {
      const accountId = await seedProviderAccount(userId, expected);
      let seen: string | undefined;
      await resolveLiveConnectorToken(
        actorId,
        provider,
        async (input) => {
          seen = input.providerId;
          expect(input.accountId).toBe(accountId);
          return { accessToken: 't' };
        },
        accountId,
      );
      expect(seen).toBe(expected);
    }
  });

  it('requires an exact account selection when several same-provider identities are linked', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId, userId } = await seedLinkedActor(orgId);
    const first = await seedProviderAccount(userId, 'linear');
    await seedProviderAccount(userId, 'linear');

    const ambiguous = await resolveLiveConnectorToken(actorId, 'linear', vi.fn());
    expect(ambiguous).toMatchObject({ ok: false, reason: 'account_selection_required' });

    const fetcher = vi.fn(async () => ({ accessToken: 'selected-token' }));
    await expect(resolveLiveConnectorToken(actorId, 'linear', fetcher, first)).resolves.toEqual({
      ok: true,
      token: 'selected-token',
    });
    expect(fetcher).toHaveBeenCalledWith({ providerId: 'linear', userId, accountId: first });
  });
});

describe('resolveActorConnectorIdentity', () => {
  it('auto-selects the actor’s single linked account for onboarding-style creates', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId, userId } = await seedLinkedActor(orgId);
    const accountId = await seedProviderAccount(userId, 'linear');

    await expect(resolveActorConnectorIdentity(actorId, 'linear')).resolves.toBe(accountId);
  });

  it('requires an explicit selection when the actor linked several provider accounts', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId, userId } = await seedLinkedActor(orgId);
    await seedProviderAccount(userId, 'linear');
    await seedProviderAccount(userId, 'linear');

    await expect(resolveActorConnectorIdentity(actorId, 'linear')).rejects.toThrow(
      /Choose which linear account/,
    );
  });
});

describe('resolveConnectorToken (env gate)', () => {
  it('short-circuits to the mock token in test mode without resolving the actor', async () => {
    // A non-existent actor still yields the sentinel, proving the gate returns before any
    // DB lookup or token fetch — exactly the local/test behaviour the mock connector expects.
    const res = await resolveConnectorToken('actor_irrelevant', 'github');
    expect(res).toEqual({ ok: true, token: 'mock' });
  });
});
