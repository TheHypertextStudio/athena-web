/** Product-capability eligibility backed by the migrated database schema. */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import {
  PRODUCT_CAPABILITIES,
  type ProductEntitlementSource,
  type ProductEntitlementStatus,
} from '../../src/contracts';

import { resolveProductCapability } from '../../src/application/entitlement';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

type LifecycleState = (typeof schema.organization.$inferSelect)['lifecycleState'];

/** Create an organization whose data lifecycle is independent of product ownership. */
async function seedOrg(lifecycleState: LifecycleState = 'active'): Promise<string> {
  const slug = `product-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState })
    .returning({ id: schema.organization.id });
  const row = rows[0];
  if (!row) throw new Error('failed to seed an organization');
  return row.id;
}

/** Give an organization Docket Pro in a chosen ownership state. */
async function seedDocketPro(
  organizationId: string,
  status: ProductEntitlementStatus,
  source: ProductEntitlementSource = 'stripe',
  graceEndsAt?: Date,
): Promise<void> {
  await db.insert(schema.organizationProductEntitlement).values({
    organizationId,
    productKey: 'docket_pro',
    status,
    source,
    graceEndsAt,
  });
}

describe('Docket Pro capabilities', () => {
  it.each(PRODUCT_CAPABILITIES)('grants %s from one active product record', async (capability) => {
    const orgId = await seedOrg();
    await seedDocketPro(orgId, 'active');

    await expect(resolveProductCapability(db, orgId, capability)).resolves.toEqual({
      kind: 'entitled',
      productKey: 'docket_pro',
      source: 'stripe',
    });
  });

  it('grants capabilities during the Docket Pro trial', async () => {
    const orgId = await seedOrg();
    await seedDocketPro(orgId, 'trialing');

    await expect(resolveProductCapability(db, orgId, 'athena')).resolves.toMatchObject({
      kind: 'entitled',
      productKey: 'docket_pro',
    });
  });

  it('keeps capabilities during the seven-day payment grace period', async () => {
    const orgId = await seedOrg();
    await seedDocketPro(orgId, 'past_due', 'stripe', new Date('2026-09-01T00:00:00.000Z'));

    await expect(
      resolveProductCapability(db, orgId, 'athena', new Date('2026-08-31T23:59:59.000Z')),
    ).resolves.toMatchObject({ kind: 'entitled' });
  });

  it.each([
    ['past_due', new Date('2026-08-30T00:00:00.000Z')],
    ['canceled', undefined],
  ] as const)('does not grant capabilities after %s access ends', async (status, graceEndsAt) => {
    const orgId = await seedOrg();
    await seedDocketPro(orgId, status, 'stripe', graceEndsAt);

    await expect(
      resolveProductCapability(db, orgId, 'athena', new Date('2026-08-31T00:00:00.000Z')),
    ).resolves.toEqual({ kind: 'product-required' });
  });

  it('keeps organization lifecycle separate from product ownership', async () => {
    const orgId = await seedOrg('export_window');
    await seedDocketPro(orgId, 'active');

    await expect(resolveProductCapability(db, orgId, 'mcp')).resolves.toMatchObject({
      kind: 'entitled',
    });
  });
});

describe('complimentary Docket Pro', () => {
  it('grants the same product capabilities with explicit provenance', async () => {
    const orgId = await seedOrg();
    await seedDocketPro(orgId, 'active', 'complimentary');

    await expect(resolveProductCapability(db, orgId, 'voice')).resolves.toEqual({
      kind: 'entitled',
      productKey: 'docket_pro',
      source: 'complimentary',
    });
  });

  it('does not leak a complimentary product to another organization', async () => {
    const complimentaryOrgId = await seedOrg();
    const otherOrgId = await seedOrg();
    await seedDocketPro(complimentaryOrgId, 'active', 'complimentary');

    await expect(resolveProductCapability(db, otherOrgId, 'voice')).resolves.toEqual({
      kind: 'product-required',
    });
  });
});

describe('an organization that is not there', () => {
  it('is reported as missing rather than as a purchase opportunity', async () => {
    await expect(resolveProductCapability(db, 'org_does_not_exist', 'athena')).resolves.toEqual({
      kind: 'organization-not-found',
    });
  });

  it('stays missing after the organization is deleted', async () => {
    const orgId = await seedOrg();
    await db.delete(schema.organization).where(eq(schema.organization.id, orgId));

    await expect(resolveProductCapability(db, orgId, 'athena')).resolves.toEqual({
      kind: 'organization-not-found',
    });
  });
});
