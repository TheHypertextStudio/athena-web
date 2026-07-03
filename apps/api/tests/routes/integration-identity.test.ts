import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ExternalUser } from '@docket/boundaries';

import type * as IntegrationIdentityModule from '../../src/routes/integration-identity';
import { addMember, appWithActor, getDb, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrations!: unknown;
let syncExternalActors!: typeof IntegrationIdentityModule.syncExternalActors;
let externalActorReverseMap!: typeof IntegrationIdentityModule.externalActorReverseMap;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  integrations = (await import('../../src/routes/integrations')).default;
  const identity = await import('../../src/routes/integration-identity');
  syncExternalActors = identity.syncExternalActors;
  externalActorReverseMap = identity.externalActorReverseMap;
});

const J = { 'content-type': 'application/json' };
const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

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

/** Seed a human org member whose Better Auth user has EXACTLY `email` (for match tests). */
async function seedMemberWithEmail(
  orgId: string,
  email: string,
  name = 'Member',
): Promise<{ actorId: string; userId: string }> {
  const [u] = await db
    .insert(schema.user)
    .values({ name, email })
    .returning({ id: schema.user.id });
  const userId = u!.id;
  const actorId = await addMember(db, schema, orgId, userId, 'member');
  return { actorId, userId };
}

/** Build a fixture-shaped `ExternalUser` with sane defaults. */
function extUser(
  overrides: Partial<ExternalUser> & { externalId: string; displayName: string },
): ExternalUser {
  return { active: true, ...overrides };
}

interface ExternalActorRes {
  id: string;
  externalId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  actorId: string | null;
  matchedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Load the single `external_actor` row for an integration (tests seed exactly one). */
async function loadRow(integrationId: string) {
  const rows = await db
    .select()
    .from(schema.externalActor)
    .where(eq(schema.externalActor.integrationId, integrationId));
  return rows[0]!;
}

describe('syncExternalActors', () => {
  it('matches by email case-insensitively', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const { actorId: memberActorId } = await seedMemberWithEmail(orgId, 'sam@example.com');
    const id = await seedIntegration(orgId, humanActorId);

    const map = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-1', displayName: 'Sam', email: 'SAM@EXAMPLE.COM' }),
    ]);
    expect(map.get('ext-1')).toBe(memberActorId);

    const row = await loadRow(id);
    expect(row.actorId).toBe(memberActorId);
    expect(row.matchedBy).toBe('email');
  });

  it('leaves an unmatched row null, then updates it once a matching member appears', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);

    const first = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-2', displayName: 'Nobody', email: 'nobody@example.com' }),
    ]);
    expect(first.get('ext-2')).toBeNull();
    const unmatchedRow = await loadRow(id);
    expect(unmatchedRow.actorId).toBeNull();
    expect(unmatchedRow.matchedBy).toBeNull();

    const { actorId: memberActorId } = await seedMemberWithEmail(orgId, 'nobody@example.com');
    const second = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-2', displayName: 'Nobody', email: 'nobody@example.com' }),
    ]);
    expect(second.get('ext-2')).toBe(memberActorId);
    const matchedRow = await loadRow(id);
    expect(matchedRow.actorId).toBe(memberActorId);
    expect(matchedRow.matchedBy).toBe('email');
  });

  it('a manual match survives a re-sync whose email now points at a different member', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);
    const { actorId: manualTargetActorId } = await seedMemberWithEmail(orgId, 'target@example.com');

    await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-3', displayName: 'Manual', email: 'manual@example.com' }),
    ]);
    const row = await loadRow(id);
    // Simulate an admin's manual link (the PATCH endpoint is covered separately below).
    await db
      .update(schema.externalActor)
      .set({ actorId: manualTargetActorId, matchedBy: 'manual' })
      .where(eq(schema.externalActor.id, row.id));

    // The provider now reports a DIFFERENT email for the same external user, and a member
    // exists that matches THAT email — the manual link must not move regardless.
    const { actorId: newlyMatchingActorId } = await seedMemberWithEmail(
      orgId,
      'reassigned@example.com',
    );
    const map = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-3', displayName: 'Manual', email: 'reassigned@example.com' }),
    ]);
    expect(map.get('ext-3')).toBe(manualTargetActorId);
    expect(map.get('ext-3')).not.toBe(newlyMatchingActorId);

    const after = await loadRow(id);
    expect(after.matchedBy).toBe('manual');
    expect(after.actorId).toBe(manualTargetActorId);
    // The provider-sourced fields still refresh even on a manually-pinned row.
    expect(after.email).toBe('reassigned@example.com');
  });

  it('an email-matched row unmatches once the member email no longer agrees', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);
    const { userId: memberUserId } = await seedMemberWithEmail(orgId, 'drift@example.com');

    const first = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-4', displayName: 'Drift', email: 'drift@example.com' }),
    ]);
    expect(first.get('ext-4')).not.toBeNull();
    expect((await loadRow(id)).matchedBy).toBe('email');

    // The member's account email changes; the provider's external-user email is unchanged, so
    // no candidate matches it on the next sync.
    await db
      .update(schema.user)
      .set({ email: 'new-address@example.com' })
      .where(eq(schema.user.id, memberUserId));

    const second = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-4', displayName: 'Drift', email: 'drift@example.com' }),
    ]);
    expect(second.get('ext-4')).toBeNull();
    const row = await loadRow(id);
    expect(row.actorId).toBeNull();
    expect(row.matchedBy).toBeNull();
  });

  it('never auto-matches a suspended member, even on an exact email match', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);
    // A member whose actor is suspended: access is revoked, so email matching must skip them.
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'Suspended', email: 'suspended@example.com' })
      .returning({ id: schema.user.id });
    await addMember(db, schema, orgId, u!.id, 'member', 'suspended');

    const map = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-susp-1', displayName: 'Susp', email: 'suspended@example.com' }),
    ]);
    expect(map.get('ext-susp-1')).toBeNull();
    const row = await loadRow(id);
    expect(row.actorId).toBeNull();
    expect(row.matchedBy).toBeNull();
  });

  it('an email-matched row unmatches on the next sync after its actor is suspended', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);
    const { actorId: memberActorId } = await seedMemberWithEmail(orgId, 'later-susp@example.com');

    const first = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-susp-2', displayName: 'Later', email: 'later-susp@example.com' }),
    ]);
    expect(first.get('ext-susp-2')).toBe(memberActorId);

    // Suspending the actor drops it from the candidate set, so the match honestly dissolves.
    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, memberActorId));

    const second = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-susp-2', displayName: 'Later', email: 'later-susp@example.com' }),
    ]);
    expect(second.get('ext-susp-2')).toBeNull();
    const row = await loadRow(id);
    expect(row.actorId).toBeNull();
    expect(row.matchedBy).toBeNull();
  });

  it('dedupes duplicate externalIds within one batch (last-wins) instead of erroring', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);

    const map = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-dup', displayName: 'First' }),
      extUser({ externalId: 'ext-dup', displayName: 'Second' }),
    ]);
    expect(map.size).toBe(1);
    const row = await loadRow(id);
    expect(row.displayName).toBe('Second');
  });

  it('refreshes displayName/email/avatarUrl on every sync regardless of match state', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);

    await syncExternalActors(orgId, id, [
      extUser({
        externalId: 'ext-5',
        displayName: 'Old Name',
        email: 'x@example.com',
        avatarUrl: 'https://old.example/a.png',
      }),
    ]);
    await syncExternalActors(orgId, id, [
      extUser({
        externalId: 'ext-5',
        displayName: 'New Name',
        email: 'y@example.com',
        avatarUrl: 'https://new.example/b.png',
      }),
    ]);

    const row = await loadRow(id);
    expect(row.displayName).toBe('New Name');
    expect(row.email).toBe('y@example.com');
    expect(row.avatarUrl).toBe('https://new.example/b.png');
  });
});

describe('externalActorReverseMap', () => {
  it('contains only matched rows', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);
    const { actorId: matchedActorId } = await seedMemberWithEmail(orgId, 'matched@example.com');

    await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-matched', displayName: 'Matched', email: 'matched@example.com' }),
      extUser({ externalId: 'ext-unmatched', displayName: 'Unmatched' }),
    ]);

    const reverse = await externalActorReverseMap(id);
    expect(reverse.get(matchedActorId)).toBe('ext-matched');
    expect(reverse.size).toBe(1);
  });
});

describe('external-actor endpoints', () => {
  it('GET returns both matched and unmatched rows', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);
    const { actorId: matchedActorId } = await seedMemberWithEmail(orgId, 'get@example.com');
    await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-get-1', displayName: 'Matched', email: 'get@example.com' }),
      extUser({ externalId: 'ext-get-2', displayName: 'Unmatched' }),
    ]);

    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${id}/external-actors`);
    expect(res.status).toBe(200);
    const out = await body<{ items: ExternalActorRes[] }>(res);
    expect(out.items).toHaveLength(2);

    const matched = out.items.find((r) => r.externalId === 'ext-get-1')!;
    expect(matched.actorId).toBe(matchedActorId);
    expect(matched.matchedBy).toBe('email');

    const unmatched = out.items.find((r) => r.externalId === 'ext-get-2')!;
    expect(unmatched.actorId).toBeNull();
    expect(unmatched.matchedBy).toBeNull();
  });

  it('403 GET when the actor lacks the manage capability', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);
    const v = appWithActor(integrations, orgId, ['view'], humanActorId);
    expect((await v.request(`/${id}/external-actors`)).status).toBe(403);
  });

  it('PATCH manually links to an actor in the org, validating org membership', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);
    const { actorId: targetActorId } = await seedMemberWithEmail(orgId, 'patch-target@example.com');
    await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-patch-1', displayName: 'Unlinked' }),
    ]);
    const row = await loadRow(id);

    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${id}/external-actors/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ actorId: targetActorId }),
    });
    expect(res.status).toBe(200);
    const out = await body<ExternalActorRes>(res);
    expect(out.actorId).toBe(targetActorId);
    expect(out.matchedBy).toBe('manual');

    // Validates org membership: an actor from a DIFFERENT org 404s (existence-hiding).
    const other = await seedBaseOrg(db, schema);
    const bad = await w.request(`/${id}/external-actors/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ actorId: other.humanActorId }),
    });
    expect(bad.status).toBe(404);
  });

  it('PATCH null unlinks and clears matchedBy back to null', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);
    const { actorId: memberActorId } = await seedMemberWithEmail(orgId, 'linked@example.com');
    await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-patch-2', displayName: 'Linked', email: 'linked@example.com' }),
    ]);
    const row = await loadRow(id);
    expect(row.actorId).toBe(memberActorId);

    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${id}/external-actors/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ actorId: null }),
    });
    expect(res.status).toBe(200);
    const out = await body<ExternalActorRes>(res);
    expect(out.actorId).toBeNull();
    expect(out.matchedBy).toBeNull();

    // Unlinking is a genuine reset, not a manual pin: a later sync may re-match by email.
    const resynced = await syncExternalActors(orgId, id, [
      extUser({ externalId: 'ext-patch-2', displayName: 'Linked', email: 'linked@example.com' }),
    ]);
    expect(resynced.get('ext-patch-2')).toBe(memberActorId);
  });

  it('404 PATCH for an external-actor row that does not belong to the integration', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${id}/external-actors/${MISSING}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ actorId: null }),
    });
    expect(res.status).toBe(404);
  });

  it('404s for a wrong-org integration id on both GET and PATCH (existence-hiding)', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const id = await seedIntegration(a.orgId, a.humanActorId);

    const wB = appWithActor(integrations, b.orgId, ['manage'], b.humanActorId);
    expect((await wB.request(`/${id}/external-actors`)).status).toBe(404);
    const patchRes = await wB.request(`/${id}/external-actors/${MISSING}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ actorId: null }),
    });
    expect(patchRes.status).toBe(404);
  });
});
