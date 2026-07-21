import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as ResolveModule from '../../../src/lib/identity/resolve-external-actor';
import { addMember, getDb, seedBaseOrg } from '../../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let resolveExternalActor!: typeof ResolveModule.resolveExternalActor;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  resolveExternalActor = (await import('../../../src/lib/identity/resolve-external-actor'))
    .resolveExternalActor;
});

let seq = 0;

/** Insert a bare `linear` connector integration for the org; returns its id. */
async function seedIntegration(orgId: string, actorId: string): Promise<string> {
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'linear',
      pattern: 'connector',
      roles: ['work'],
      createdBy: actorId,
    })
    .returning({ id: schema.integration.id });
  return row!.id;
}

/** Seed an active human org member whose Better Auth user has EXACTLY `email`. */
async function seedMemberWithEmail(
  orgId: string,
  email: string,
  status: 'active' | 'suspended' = 'active',
): Promise<{ actorId: string; userId: string }> {
  seq += 1;
  const [u] = await db
    .insert(schema.user)
    .values({ name: `Member-${String(seq)}`, email })
    .returning({ id: schema.user.id });
  const userId = u!.id;
  const actorId = await addMember(db, schema, orgId, userId, 'member', status);
  return { actorId, userId };
}

/** Insert an `external_actor` row directly (this module never writes; tests seed by hand). */
async function seedExternalActor(
  orgId: string,
  integrationId: string,
  externalId: string,
  overrides: Partial<typeof DbModule.externalActor.$inferInsert> = {},
): Promise<void> {
  await db.insert(schema.externalActor).values({
    organizationId: orgId,
    integrationId,
    externalId,
    displayName: 'External User',
    ...overrides,
  });
}

/** Link a Better Auth `account` (OAuth identity) to a user for the given provider + native id. */
async function seedLinkedAccount(userId: string, providerId: string, accountId: string) {
  await db.insert(schema.account).values({ userId, providerId, accountId });
}

describe('resolveExternalActor', () => {
  it('rung 1 — resolves a manually-bound external_actor row, even with no other signal', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const { actorId: targetActorId } = await seedMemberWithEmail(orgId, 'manual-1@example.com');
    const intgId = await seedIntegration(orgId, humanActorId);
    await seedExternalActor(orgId, intgId, 'ext-manual-1', {
      actorId: targetActorId,
      matchedBy: 'manual',
    });

    const result = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: 'ext-manual-1',
    });
    expect(result).toEqual({ actorId: targetActorId, matchedBy: 'manual' });
  });

  it('rung 1 — an explicitly unbound manual row (null actorId) resolves to no-match and does NOT fall through to a linked account', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const intgId = await seedIntegration(orgId, humanActorId);
    await seedExternalActor(orgId, intgId, 'ext-manual-null', {
      actorId: null,
      matchedBy: 'manual',
    });
    // A linked Better Auth account for the SAME externalId that would otherwise match at rung 2.
    const { userId, actorId: wouldHaveMatchedActorId } = await seedMemberWithEmail(
      orgId,
      'would-match@example.com',
    );
    await seedLinkedAccount(userId, 'linear', 'ext-manual-null');

    const result = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: 'ext-manual-null',
    });
    expect(result).toEqual({ actorId: null, matchedBy: null });
    expect(result.actorId).not.toBe(wouldHaveMatchedActorId);
  });

  it('rung 1 — a manual override outranks a linked Better Auth account for the same identity', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const intgId = await seedIntegration(orgId, humanActorId);
    const { actorId: manualTargetActorId } = await seedMemberWithEmail(
      orgId,
      'manual-wins@example.com',
    );
    const { userId: linkedUserId, actorId: linkedActorId } = await seedMemberWithEmail(
      orgId,
      'linked-loses@example.com',
    );
    await seedExternalActor(orgId, intgId, 'ext-both', {
      actorId: manualTargetActorId,
      matchedBy: 'manual',
    });
    await seedLinkedAccount(linkedUserId, 'linear', 'ext-both');

    const result = await resolveExternalActor(orgId, { source: 'linear', externalId: 'ext-both' });
    expect(result).toEqual({ actorId: manualTargetActorId, matchedBy: 'manual' });
    expect(result.actorId).not.toBe(linkedActorId);
  });

  it('rung 2 — resolves via a linked Better Auth account when no external_actor row exists', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId, actorId } = await seedMemberWithEmail(orgId, 'oauth@example.com');
    await seedLinkedAccount(userId, 'linear', 'ext-oauth-1');

    const result = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: 'ext-oauth-1',
    });
    expect(result).toEqual({ actorId, matchedBy: 'linked_account' });
  });

  it('rung 2 — never resolves to a suspended actor, even with a valid account link', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { userId } = await seedMemberWithEmail(orgId, 'susp-oauth@example.com', 'suspended');
    await seedLinkedAccount(userId, 'linear', 'ext-oauth-susp');

    const result = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: 'ext-oauth-susp',
    });
    expect(result).toEqual({ actorId: null, matchedBy: null });
  });

  it('rung 2 — a linked account outranks an email-matched external_actor row for the same identity', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const intgId = await seedIntegration(orgId, humanActorId);
    const { userId: linkedUserId, actorId: linkedActorId } = await seedMemberWithEmail(
      orgId,
      'linked-wins@example.com',
    );
    const { actorId: emailMatchedActorId } = await seedMemberWithEmail(
      orgId,
      'email-loses@example.com',
    );
    await seedLinkedAccount(linkedUserId, 'linear', 'ext-both-2');
    await seedExternalActor(orgId, intgId, 'ext-both-2', {
      actorId: emailMatchedActorId,
      matchedBy: 'email',
    });

    const result = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: 'ext-both-2',
    });
    expect(result).toEqual({ actorId: linkedActorId, matchedBy: 'linked_account' });
  });

  it('rung 3 — resolves via an email-matched external_actor row from the sync engine', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const intgId = await seedIntegration(orgId, humanActorId);
    const { actorId } = await seedMemberWithEmail(orgId, 'synced@example.com');
    await seedExternalActor(orgId, intgId, 'ext-synced-1', {
      actorId,
      matchedBy: 'email',
      email: 'synced@example.com',
    });

    const result = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: 'ext-synced-1',
    });
    expect(result).toEqual({ actorId, matchedBy: 'email' });
  });

  it('rung 4 — falls back to an ad-hoc, case-insensitive email match when no external_actor row exists', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { actorId } = await seedMemberWithEmail(orgId, 'adhoc@example.com');

    const result = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: 'ext-never-seen',
      email: 'ADHOC@EXAMPLE.COM',
    });
    expect(result).toEqual({ actorId, matchedBy: 'email' });
  });

  it('rung 4 — the ad-hoc email fallback never resolves to a suspended actor', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    await seedMemberWithEmail(orgId, 'susp-adhoc@example.com', 'suspended');

    const result = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: 'ext-never-seen-2',
      email: 'susp-adhoc@example.com',
    });
    expect(result).toEqual({ actorId: null, matchedBy: null });
  });

  it('no match anywhere resolves to { actorId: null, matchedBy: null }', async () => {
    const { orgId } = await seedBaseOrg(db, schema);

    const result = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: 'ext-nobody',
    });
    expect(result).toEqual({ actorId: null, matchedBy: null });

    const withEmail = await resolveExternalActor(orgId, {
      source: 'linear',
      externalId: 'ext-nobody-2',
      email: 'nobody-at-all@example.com',
    });
    expect(withEmail).toEqual({ actorId: null, matchedBy: null });
  });

  it('scopes lookups to the requesting org — a same-externalId row in another org never matches', async () => {
    const { orgId: orgA, humanActorId: humanA } = await seedBaseOrg(db, schema);
    const { orgId: orgB } = await seedBaseOrg(db, schema);
    const intgIdA = await seedIntegration(orgA, humanA);
    const { actorId } = await seedMemberWithEmail(orgA, 'cross-org@example.com');
    await seedExternalActor(orgA, intgIdA, 'ext-cross-org', { actorId, matchedBy: 'manual' });

    const result = await resolveExternalActor(orgB, {
      source: 'linear',
      externalId: 'ext-cross-org',
    });
    expect(result).toEqual({ actorId: null, matchedBy: null });
  });
});
