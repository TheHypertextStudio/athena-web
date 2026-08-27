import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface EntitlementRow {
  organization_id: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  source: 'stripe' | 'complimentary';
}

interface SyncRow {
  organization_id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  last_error: string | null;
  completed_at: Date | null;
  payload: Record<string, unknown>;
}

describe('billing orphan entitlement repair migration', () => {
  let client: PGlite;

  beforeEach(async () => {
    client = new PGlite('memory://');
    await client.exec(`
      CREATE TYPE product_entitlement_source AS ENUM ('stripe', 'complimentary');
      CREATE TYPE product_entitlement_status AS ENUM ('trialing', 'active', 'past_due', 'canceled');
      CREATE TABLE organization (
        id text PRIMARY KEY
      );
      CREATE TABLE organization_billing_account (
        organization_id text PRIMARY KEY REFERENCES organization(id),
        stripe_customer_id text
      );
      CREATE TABLE organization_product_entitlement (
        organization_id text NOT NULL REFERENCES organization(id),
        product_key text NOT NULL,
        status product_entitlement_status NOT NULL,
        source product_entitlement_source NOT NULL,
        stripe_subscription_id text,
        trial_ends_at timestamp,
        current_period_end timestamp,
        cancel_at_period_end boolean NOT NULL DEFAULT false,
        grace_ends_at timestamp,
        provider_observed_at timestamp,
        canceled_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        PRIMARY KEY (organization_id, product_key)
      );
      CREATE TABLE billing_provider_sync (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organization(id),
        operation text NOT NULL,
        status text NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        last_error text,
        next_attempt_at timestamp,
        completed_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );

      INSERT INTO organization (id) VALUES
        ('orphan_trial'),
        ('orphan_active'),
        ('paid_trial'),
        ('canceled_history'),
        ('past_due_history'),
        ('complimentary');

      INSERT INTO organization_billing_account (organization_id, stripe_customer_id)
      VALUES ('paid_trial', 'cus_paid');

      INSERT INTO organization_product_entitlement (
        organization_id,
        product_key,
        status,
        source,
        stripe_subscription_id,
        trial_ends_at,
        current_period_end,
        grace_ends_at,
        provider_observed_at,
        canceled_at
      ) VALUES
        ('orphan_trial', 'docket_pro', 'trialing', 'stripe', NULL, NULL, NULL, NULL, NULL, NULL),
        ('orphan_active', 'docket_pro', 'active', 'stripe', NULL, NULL, NULL, NULL, NULL, NULL),
        ('paid_trial', 'docket_pro', 'trialing', 'stripe', 'sub_paid', '2026-09-10',
          '2026-09-10', NULL, '2026-08-27', NULL),
        ('canceled_history', 'docket_pro', 'canceled', 'stripe', NULL, NULL, NULL, NULL,
          '2026-08-20', '2026-08-20'),
        ('past_due_history', 'docket_pro', 'past_due', 'stripe', NULL, NULL, NULL,
          '2026-09-03', '2026-08-27', NULL),
        ('complimentary', 'docket_pro', 'active', 'complimentary', NULL, NULL, NULL, NULL,
          NULL, NULL);

      INSERT INTO billing_provider_sync (
        id, organization_id, operation, status, payload, last_error, next_attempt_at
      ) VALUES
        ('sync_orphan_trial', 'orphan_trial', 'reconcile_billing', 'failed', '{}',
          'Legacy entitlement has no customer.', now()),
        ('sync_orphan_active', 'orphan_active', 'reconcile_billing', 'pending', '{}', NULL, now()),
        ('sync_paid_trial', 'paid_trial', 'reconcile_billing', 'failed', '{}',
          'Provider is temporarily unavailable.', now()),
        ('sync_other_operation', 'orphan_trial', 'apply_discount', 'failed', '{}',
          'Provider write failed.', now());
    `);
  });

  afterEach(async () => {
    await client.close();
  });

  it('removes only provider-less legacy grants and closes only their reconciliation retries', async () => {
    const migration = await readFile(
      resolve(import.meta.dirname, '../../drizzle/0107_billing-orphan-entitlement-repair.sql'),
      'utf8',
    );

    await client.exec(migration.replaceAll('--> statement-breakpoint', ''));
    await client.exec(migration.replaceAll('--> statement-breakpoint', ''));

    const entitlements = await client.query<EntitlementRow>(
      `SELECT organization_id, status, source
       FROM organization_product_entitlement
       ORDER BY organization_id`,
    );
    expect(entitlements.rows).toEqual([
      {
        organization_id: 'canceled_history',
        status: 'canceled',
        source: 'stripe',
      },
      {
        organization_id: 'complimentary',
        status: 'active',
        source: 'complimentary',
      },
      {
        organization_id: 'paid_trial',
        status: 'trialing',
        source: 'stripe',
      },
      {
        organization_id: 'past_due_history',
        status: 'past_due',
        source: 'stripe',
      },
    ]);

    const syncs = await client.query<SyncRow>(
      `SELECT organization_id, status, last_error, completed_at, payload
       FROM billing_provider_sync
       ORDER BY id`,
    );
    expect(syncs.rows).toEqual([
      {
        organization_id: 'orphan_active',
        status: 'succeeded',
        last_error: null,
        completed_at: expect.any(Date),
        payload: {
          resolution: 'legacy_orphan_entitlement_removed',
          resolvedBy: '0107_billing-orphan-entitlement-repair',
        },
      },
      {
        organization_id: 'orphan_trial',
        status: 'succeeded',
        last_error: null,
        completed_at: expect.any(Date),
        payload: {
          resolution: 'legacy_orphan_entitlement_removed',
          resolvedBy: '0107_billing-orphan-entitlement-repair',
        },
      },
      {
        organization_id: 'orphan_trial',
        status: 'failed',
        last_error: 'Provider write failed.',
        completed_at: null,
        payload: {},
      },
      {
        organization_id: 'paid_trial',
        status: 'failed',
        last_error: 'Provider is temporarily unavailable.',
        completed_at: null,
        payload: {},
      },
    ]);
  });
});
