import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('complimentary customer nullability repair migration', () => {
  let client: PGlite;

  beforeEach(async () => {
    client = new PGlite('memory://');
    await client.exec(`
      CREATE TABLE organization_billing_account (
        organization_id text PRIMARY KEY,
        stripe_customer_id text NOT NULL
      );
      INSERT INTO organization_billing_account (organization_id, stripe_customer_id)
      VALUES ('paid', 'cus_paid');
    `);
  });

  afterEach(async () => {
    await client.close();
  });

  it('restores the Stripe-independent account invariant and remains idempotent', async () => {
    const migration = await readFile(
      resolve(
        import.meta.dirname,
        '../../drizzle/0108_complimentary-customer-nullability-repair.sql',
      ),
      'utf8',
    );

    await client.exec(migration);
    await client.exec(migration);
    await client.exec(`
      INSERT INTO organization_billing_account (organization_id, stripe_customer_id)
      VALUES ('founder', NULL);
    `);

    const result = await client.query<{
      organization_id: string;
      stripe_customer_id: string | null;
    }>(
      `SELECT organization_id, stripe_customer_id
       FROM organization_billing_account
       ORDER BY organization_id`,
    );
    expect(result.rows).toEqual([
      { organization_id: 'founder', stripe_customer_id: null },
      { organization_id: 'paid', stripe_customer_id: 'cus_paid' },
    ]);
  });
});
