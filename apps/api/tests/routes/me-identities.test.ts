import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as ProviderModule from '../../src/routes/integration-provider';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let linkedIdentities!: typeof ProviderModule.linkedIdentities;
let resolveIdentityLabel!: typeof ProviderModule.resolveIdentityLabel;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/integration-provider');
  linkedIdentities = mod.linkedIdentities;
  resolveIdentityLabel = mod.resolveIdentityLabel;
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
  return u!.id;
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
    });
    expect(ids[0]!.scopes).toContain('https://www.googleapis.com/auth/tasks');
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
    expect(gh!.scopes).toEqual(['read:user', 'repo']);
  });

  it('returns an empty list when nothing is linked — no synthetic/fabricated identity', async () => {
    const userId = await seedUser(`solo-${Math.random().toString(36).slice(2)}@x.test`, 'Solo');
    expect(await linkedIdentities(userId)).toEqual([]);
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
    const actorId = actorRow!.id;

    expect(await resolveIdentityLabel(actorId, 'sub-lbl-1')).toBe('lia@gmail.com');
    // An unknown sub or a null binding yields no label (the caller falls back).
    expect(await resolveIdentityLabel(actorId, 'sub-unknown')).toBeUndefined();
    expect(await resolveIdentityLabel(actorId, null)).toBeUndefined();
  });
});
