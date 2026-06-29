import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as ProviderModule from '../../src/routes/integration-provider';
import { getDb, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let googleIdentities!: typeof ProviderModule.googleIdentities;
let resolveIdentityLabel!: typeof ProviderModule.resolveIdentityLabel;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/integration-provider');
  googleIdentities = mod.googleIdentities;
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

describe('googleIdentities', () => {
  it('lists a linked Google account by the email decoded from its id token', async () => {
    const userId = await seedUser(`gid-${Math.random().toString(36).slice(2)}@x.test`, 'Ada');
    await seedGoogleAccount(
      userId,
      'sub-real-1',
      idToken({ email: 'ada@gmail.com', name: 'Ada G' }),
    );

    const ids = await googleIdentities(userId);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({
      accountId: 'sub-real-1',
      provider: 'google',
      email: 'ada@gmail.com',
      name: 'Ada G',
    });
    expect(ids[0]!.scopes).toContain('https://www.googleapis.com/auth/tasks');
  });

  it('returns a synthetic identity (labeled by the user email) when none is linked, in test mode', async () => {
    const email = `solo-${Math.random().toString(36).slice(2)}@x.test`;
    const userId = await seedUser(email, 'Solo');

    const ids = await googleIdentities(userId);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({ accountId: 'mock-google', provider: 'google', email });
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
