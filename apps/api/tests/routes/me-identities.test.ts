import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as ProviderModule from '../../src/routes/integration-provider';
import { signExternalAgentControl } from '../../src/lib/external-agent-control-token';
import { ensureDefaultAgent } from '../../src/lib/default-agent';
import { appWithSession, fakeSession, getDb, seedBaseOrg } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let linkedIdentities!: typeof ProviderModule.linkedIdentities;
let resolveIdentityLabel!: typeof ProviderModule.resolveIdentityLabel;
let meIdentities!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/integration-provider');
  linkedIdentities = mod.linkedIdentities;
  resolveIdentityLabel = mod.resolveIdentityLabel;
  meIdentities = (await import('../../src/routes/me-identities')).default;
});

/** Build a JWT-shaped id token carrying the given claims. */
function idToken(claims: Record<string, unknown>): string {
  return `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
}

async function seedUser(email: string, name: string): Promise<string> {
  const [u] = await db
    .insert(schema.user)
    .values({ name, email })
    .returning({ id: schema.user.id });
  return assertDefined(u).id;
}

async function seedGoogleAccount(userId: string, accountId: string, token: string): Promise<void> {
  await db.insert(schema.account).values({
    userId,
    providerId: 'google',
    accountId,
    idToken: token,
    scope: 'openid email https://www.googleapis.com/auth/tasks',
  });
}

async function seedAccount(
  userId: string,
  providerId: string,
  accountId: string,
  scope: string,
): Promise<void> {
  await db.insert(schema.account).values({ userId, providerId, accountId, scope });
}

describe('linkedIdentities', () => {
  it('lists a linked Google account by the email decoded from its id token', async () => {
    const userId = await seedUser(`gid-${Math.random().toString(36).slice(2)}@x.test`, 'Ada');
    await seedGoogleAccount(
      userId,
      'sub-real-1',
      idToken({ email: 'ada@gmail.com', name: 'Ada G' }),
    );

    const ids = await linkedIdentities(userId);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({
      accountId: 'sub-real-1',
      provider: 'google',
      email: 'ada@gmail.com',
      name: 'Ada G',
      connectionCount: 0,
    });
    expect(assertDefined(ids[0]).scopes).toContain('https://www.googleapis.com/auth/tasks');
    expect(assertDefined(ids[0]).reauthorizationRequired).toBe(true);
  });

  it('lists every supported provider; GitHub/Linear carry null claims (no id token)', async () => {
    const userId = await seedUser(`multi-${Math.random().toString(36).slice(2)}@x.test`, 'Mira');
    await seedGoogleAccount(userId, 'g-sub', idToken({ email: 'mira@gmail.com' }));
    await seedAccount(userId, 'github', 'gh-42', 'read:user repo');
    await seedAccount(userId, 'linear', 'lin-7', 'read');

    const ids = await linkedIdentities(userId);
    expect(ids.map((i) => i.provider).sort()).toEqual(['github', 'google', 'linear']);
    const gh = ids.find((i) => i.provider === 'github');
    expect(gh).toMatchObject({ accountId: 'gh-42', email: null, name: null, picture: null });
    expect(assertDefined(gh).scopes).toEqual(['read:user', 'repo']);
  });

  it('returns an empty list when nothing is linked — no synthetic/fabricated identity', async () => {
    const userId = await seedUser(`solo-${Math.random().toString(36).slice(2)}@x.test`, 'Solo');
    expect(await linkedIdentities(userId)).toEqual([]);
  });

  it('parses provider scopes stored with commas or whitespace', async () => {
    const userId = await seedUser(`scopes-${Math.random().toString(36).slice(2)}@x.test`, 'Scope');
    await seedAccount(userId, 'github', 'gh-scopes', 'read:user,repo  user:email');
    const [identity] = await linkedIdentities(userId);
    expect(identity?.scopes).toEqual(['read:user', 'repo', 'user:email']);
  });

  it.each([
    { scope: 'read', reauthorizationRequired: true },
    { scope: 'read write', reauthorizationRequired: false },
  ])(
    'reports Linear reauthorization=$reauthorizationRequired for a $scope grant',
    async ({ scope, reauthorizationRequired }) => {
      const userId = await seedUser(
        `linear-scope-${scope.replaceAll(' ', '-')}-${Math.random().toString(36).slice(2)}@x.test`,
        'Linear Scope',
      );
      await db.insert(schema.account).values({
        userId,
        providerId: 'linear',
        accountId: `linear-${scope.replaceAll(' ', '-')}`,
        scope,
        accessToken: 'sealed-token',
      });

      const [identity] = await linkedIdentities(userId);

      expect(identity?.reauthorizationRequired).toBe(reauthorizationRequired);
    },
  );
});

describe('DELETE /me/identities/:provider/:accountId', () => {
  it('removes exactly one unused identity after fresh-session step-up', async () => {
    const userId = await seedUser(`unlink-${Math.random().toString(36).slice(2)}@x.test`, 'Uma');
    await seedAccount(userId, 'linear', 'lin-remove', 'read');
    await seedAccount(userId, 'github', 'gh-keep', 'read:user');
    const app = appWithSession(meIdentities, fakeSession(userId));

    const res = await app.request('/linear/lin-remove', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });
    const remaining = await db
      .select({ accountId: schema.account.accountId })
      .from(schema.account)
      .where(eq(schema.account.userId, userId));
    expect(remaining).toEqual([{ accountId: 'gh-keep' }]);
  });

  it('reports connectionCount and blocks unlinking an identity used by a Docket connection', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUser(`used-${Math.random().toString(36).slice(2)}@x.test`, 'Uri');
    await seedAccount(userId, 'linear', 'lin-used', 'read');
    await seedAccount(userId, 'github', 'gh-spare', 'read:user');
    const [owner] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Uri', userId })
      .returning({ id: schema.actor.id });
    await db.insert(schema.integration).values({
      organizationId: orgId,
      provider: 'linear',
      pattern: 'connector',
      externalAccountId: 'lin-used',
      createdBy: assertDefined(owner).id,
    });

    const identities = await linkedIdentities(userId);
    expect(identities).toHaveLength(2);
    expect(identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 'lin-used', connectionCount: 1 }),
        expect.objectContaining({ accountId: 'gh-spare', connectionCount: 0 }),
      ]),
    );
    const app = appWithSession(meIdentities, fakeSession(userId));
    const res = await app.request('/linear/lin-used', { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'identity_in_use' });
  });

  it('requires a fresh session for credential removal', async () => {
    const userId = await seedUser(`stale-${Math.random().toString(36).slice(2)}@x.test`, 'Stale');
    await seedAccount(userId, 'linear', 'lin-stale', 'read');
    await seedAccount(userId, 'github', 'gh-stale', 'read:user');
    const session = fakeSession(userId);
    assertDefined(session).session.createdAt = new Date(Date.now() - 10 * 60 * 1000);
    const app = appWithSession(meIdentities, session);

    const res = await app.request('/linear/lin-stale', { method: 'DELETE' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'reauth_required' });
  });
});

describe('POST /me/identities/external-agent-links', () => {
  it('binds the linked Linear identity to the waiting session and queues it once', async () => {
    const seeded = await seedBaseOrg(db, schema);
    const userId = await seedUser(
      `agent-auth-${Math.random().toString(36).slice(2)}@x.test`,
      'Lin',
    );
    await db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, seeded.humanActorId));
    await seedAccount(userId, 'linear', 'linear-user-auth', 'read write');
    const agent = await ensureDefaultAgent(seeded.orgId, seeded.humanActorId);
    const [session] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: seeded.orgId,
        agentId: agent.id,
        trigger: 'mention',
        status: 'awaiting_input',
      })
      .returning({ id: schema.agentSession.id });
    const sessionId = assertDefined(session).id;
    await db.insert(schema.agentSessionExternalLink).values({
      sessionId,
      organizationId: seeded.orgId,
      provider: 'linear',
      externalWorkspaceId: 'linear-workspace-auth',
      externalSessionId: 'linear-session-auth',
    });
    const token = signExternalAgentControl({
      kind: 'authentication',
      provider: 'linear',
      organizationId: seeded.orgId,
      sessionId,
      externalActorId: 'linear-user-auth',
    });
    const app = appWithSession(meIdentities, fakeSession(userId));

    const first = await app.request('/external-agent-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const replay = await app.request('/external-agent-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await first.json()).toEqual({ status: true, sessionId });
    const [stored] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    expect(stored).toMatchObject({ status: 'pending', initiatorId: seeded.humanActorId });
    const runs = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, sessionId));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ generation: 0, status: 'queued' });
  });

  it('rejects a signed continuation when the caller did not link its Linear identity', async () => {
    const seeded = await seedBaseOrg(db, schema);
    const userId = await seedUser(
      `agent-auth-wrong-${Math.random().toString(36).slice(2)}@x.test`,
      'No',
    );
    await db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, seeded.humanActorId));
    await seedAccount(userId, 'linear', 'different-linear-user', 'read write');
    const agent = await ensureDefaultAgent(seeded.orgId, seeded.humanActorId);
    const [session] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: seeded.orgId,
        agentId: agent.id,
        trigger: 'mention',
        status: 'awaiting_input',
      })
      .returning({ id: schema.agentSession.id });
    const sessionId = assertDefined(session).id;
    await db.insert(schema.agentSessionExternalLink).values({
      sessionId,
      organizationId: seeded.orgId,
      provider: 'linear',
      externalWorkspaceId: 'linear-workspace-wrong',
      externalSessionId: 'linear-session-wrong',
    });
    const token = signExternalAgentControl({
      kind: 'authentication',
      provider: 'linear',
      organizationId: seeded.orgId,
      sessionId,
      externalActorId: 'linear-user-required',
    });
    const app = appWithSession(meIdentities, fakeSession(userId));

    const response = await app.request('/external-agent-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'external_identity_mismatch' });
  });
});

describe('resolveIdentityLabel', () => {
  it('resolves the bound identity email via the actor → user mapping', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUser(`lbl-${Math.random().toString(36).slice(2)}@x.test`, 'Lia');
    await seedGoogleAccount(userId, 'sub-lbl-1', idToken({ email: 'lia@gmail.com' }));
    const [actorRow] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Lia', userId })
      .returning({ id: schema.actor.id });
    const actorId = assertDefined(actorRow).id;

    expect(await resolveIdentityLabel(actorId, 'gtasks', 'sub-lbl-1')).toBe('lia@gmail.com');
    // An unknown sub or a null binding yields no label (the caller falls back).
    expect(await resolveIdentityLabel(actorId, 'gtasks', 'sub-unknown')).toBeUndefined();
    expect(await resolveIdentityLabel(actorId, 'gtasks', null)).toBeUndefined();
  });
});
