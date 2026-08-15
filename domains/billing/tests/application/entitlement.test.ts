/**
 * Paid-feature eligibility for starting an Athena session.
 *
 * @remarks
 * This is a paywall, and the two ways it can be wrong are not symmetric: too strict and a paying
 * customer is refused the feature they bought, too loose and the plan means nothing. The rules it
 * encodes are deliberately narrower than the lifecycle's "is this org still operating" set —
 * `past_due` keeps an org usable but does *not* entitle it — and a staff-issued exemption
 * overrides the plan entirely.
 *
 * The exemption is resolved by a left join with a revocation guard, so these run against an
 * embedded database: whether a revoked exemption still grants access is a property of that join,
 * not of any logic a fake could stand in for.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import {
  AGENT_SESSION_ENTITLED_LIFECYCLE_STATES,
  resolveAgentSessionEntitlement,
} from '../../src/application/entitlement';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

type LifecycleState = (typeof schema.organization.$inferSelect)['lifecycleState'];

/** Create an organization in a chosen lifecycle state. */
async function seedOrg(lifecycleState: LifecycleState): Promise<string> {
  const slug = `entitle-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState })
    .returning({ id: schema.organization.id });
  const row = rows[0];
  if (!row) throw new Error('failed to seed an organization');
  return row.id;
}

/** Grant a staff exemption, optionally already revoked. */
async function seedExemption(organizationId: string, revokedAt: Date | null = null): Promise<void> {
  await db
    .insert(schema.billingExemption)
    .values({ organizationId, reason: 'staff grant for a support escalation', revokedAt });
}

describe('what the plan alone entitles', () => {
  it.each(AGENT_SESSION_ENTITLED_LIFECYCLE_STATES)('admits %s on the subscription', async (st) => {
    const orgId = await seedOrg(st);
    expect(await resolveAgentSessionEntitlement(db, orgId)).toEqual({
      kind: 'entitled',
      source: 'subscription',
    });
  });

  it('counts a trial as entitled, because the trial is part of the paid funnel', async () => {
    const orgId = await seedOrg('trialing');
    expect(await resolveAgentSessionEntitlement(db, orgId)).toMatchObject({ kind: 'entitled' });
  });

  it.each(['past_due', 'export_window', 'pending_deletion', 'deleted'] as const)(
    'requires a plan for %s',
    async (state) => {
      // `past_due` is the one worth stating: the lifecycle keeps such an org usable, but usable is
      // not entitled. Merging the two sets is how a paywall turns into a membership list.
      const orgId = await seedOrg(state);
      expect(await resolveAgentSessionEntitlement(db, orgId)).toEqual({ kind: 'plan-required' });
    },
  );
});

describe('what a staff exemption overrides', () => {
  it.each(['past_due', 'export_window', 'pending_deletion', 'deleted'] as const)(
    'admits %s when staff have granted an exemption',
    async (state) => {
      const orgId = await seedOrg(state);
      await seedExemption(orgId);
      expect(await resolveAgentSessionEntitlement(db, orgId)).toEqual({
        kind: 'entitled',
        source: 'exemption',
      });
    },
  );

  it('attributes the entitlement to the exemption even when the plan would also allow it', async () => {
    // Provenance matters: staff need to see that access is being carried by their grant, so that
    // revoking it is known to be consequential.
    const orgId = await seedOrg('active');
    await seedExemption(orgId);
    expect(await resolveAgentSessionEntitlement(db, orgId)).toMatchObject({ source: 'exemption' });
  });

  it('stops granting access once the exemption is revoked', async () => {
    const orgId = await seedOrg('past_due');
    await seedExemption(orgId, new Date('2026-08-01T00:00:00.000Z'));
    expect(await resolveAgentSessionEntitlement(db, orgId)).toEqual({ kind: 'plan-required' });
  });

  it('does not let one workspace exemption leak to another', async () => {
    const exempt = await seedOrg('past_due');
    const other = await seedOrg('past_due');
    await seedExemption(exempt);
    expect(await resolveAgentSessionEntitlement(db, other)).toEqual({ kind: 'plan-required' });
  });
});

describe('an organization that is not there', () => {
  it('is reported as missing rather than merely unentitled', async () => {
    // The caller renders these differently — a missing workspace is not a sales opportunity.
    expect(await resolveAgentSessionEntitlement(db, 'org_does_not_exist')).toEqual({
      kind: 'organization-not-found',
    });
  });

  it('stays missing after the row is deleted', async () => {
    const orgId = await seedOrg('active');
    await db.delete(schema.organization).where(eq(schema.organization.id, orgId));
    expect(await resolveAgentSessionEntitlement(db, orgId)).toEqual({
      kind: 'organization-not-found',
    });
  });
});
