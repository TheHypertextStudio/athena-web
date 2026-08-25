/** Durable Stripe identity and webhook idempotency behavior. */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { claimProviderEvent, ensureBillingCustomer } from '../../src/application/provider-state';
import type { BillingGateway } from '../../src/contracts';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

async function seedOrg(): Promise<string> {
  const slug = `provider-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const row = rows[0];
  if (!row) throw new Error('failed to seed organization');
  return row.id;
}

describe('ensureBillingCustomer', () => {
  it('creates the provider customer once and reuses its durable id', async () => {
    const orgId = await seedOrg();
    let creates = 0;
    const gateway = {
      createCustomer: async (referenceId: string) => {
        creates += 1;
        return { id: `cus_${referenceId}`, referenceId };
      },
    } as BillingGateway;

    const first = await ensureBillingCustomer(db, gateway, orgId, 'owner@example.com');
    const second = await ensureBillingCustomer(db, gateway, orgId, 'owner@example.com');

    expect(first).toEqual(second);
    expect(first.stripeCustomerId).toBe(`cus_${orgId}`);
    expect(creates).toBe(1);
  });
});

describe('claimProviderEvent', () => {
  it('claims a Stripe event once and rejects a duplicate delivery', async () => {
    const orgId = await seedOrg();
    const event = {
      id: `evt_${orgId}`,
      type: 'subscription.updated' as const,
      referenceId: orgId,
      createdAt: '2026-08-25T00:00:00.000Z',
    };

    await expect(claimProviderEvent(db, event)).resolves.toBe(true);
    await expect(claimProviderEvent(db, event)).resolves.toBe(false);
  });
});
