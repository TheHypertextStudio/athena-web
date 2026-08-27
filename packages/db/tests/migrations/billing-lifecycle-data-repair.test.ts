import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface EntitlementRow {
  organization_id: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  source: 'stripe' | 'complimentary';
  grace_ends_at: Date | null;
  canceled_at: Date | null;
}

interface OrganizationRow {
  id: string;
  lifecycle_state:
    'trialing' | 'active' | 'past_due' | 'export_window' | 'pending_deletion' | 'deleted';
  export_ready_at: Date | null;
  delete_after_at: Date | null;
}

describe('billing lifecycle data repair migration', () => {
  let client: PGlite;

  beforeEach(async () => {
    client = new PGlite('memory://');
    await client.exec(`
      CREATE TYPE product_entitlement_source AS ENUM ('stripe', 'complimentary');
      CREATE TYPE product_entitlement_status AS ENUM ('trialing', 'active', 'past_due', 'canceled');
      CREATE TYPE org_lifecycle_state AS ENUM (
        'trialing', 'active', 'past_due', 'export_window', 'pending_deletion', 'deleted'
      );
      CREATE TABLE organization (
        id text PRIMARY KEY,
        lifecycle_state org_lifecycle_state NOT NULL,
        export_ready_at timestamp,
        delete_after_at timestamp,
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE organization_product_entitlement (
        organization_id text NOT NULL,
        product_key text NOT NULL,
        status product_entitlement_status NOT NULL,
        source product_entitlement_source NOT NULL,
        grace_ends_at timestamp,
        provider_observed_at timestamp,
        canceled_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        PRIMARY KEY (organization_id, product_key)
      );
      CREATE TABLE billing_discount_program (
        key text PRIMARY KEY,
        name text NOT NULL,
        audience text NOT NULL,
        percent_off integer NOT NULL,
        review_months integer NOT NULL,
        terms text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `);
  });

  afterEach(async () => {
    await client.close();
  });

  it('moves every legacy billing lifecycle state without scheduling deletion', async () => {
    await client.exec(`
      INSERT INTO organization (id, lifecycle_state, export_ready_at, delete_after_at) VALUES
        ('org_trialing', 'trialing', NULL, NULL),
        ('org_past_due', 'past_due', NULL, '2026-09-01T00:00:00Z'),
        ('org_export', 'export_window', '2026-08-20T00:00:00Z', '2026-09-03T00:00:00Z'),
        ('org_pending', 'pending_deletion', '2026-08-20T00:00:00Z', '2026-09-03T00:00:00Z'),
        ('org_complimentary', 'pending_deletion', '2026-08-20T00:00:00Z', '2026-09-03T00:00:00Z'),
        ('org_deleted', 'deleted', '2026-08-01T00:00:00Z', '2026-08-15T00:00:00Z');
      INSERT INTO organization_product_entitlement (
        organization_id, product_key, status, source
      ) VALUES
        ('org_trialing', 'docket_pro', 'trialing', 'stripe'),
        ('org_complimentary', 'docket_pro', 'active', 'complimentary');
    `);

    const migration = await readFile(
      resolve(import.meta.dirname, '../../drizzle/0102_billing-lifecycle-data-repair.sql'),
      'utf8',
    );
    await client.exec(migration.replaceAll('--> statement-breakpoint', ''));

    const organizations = await client.query<OrganizationRow>(
      'SELECT id, lifecycle_state, export_ready_at, delete_after_at FROM organization ORDER BY id',
    );
    expect(organizations.rows).toEqual([
      {
        id: 'org_complimentary',
        lifecycle_state: 'active',
        export_ready_at: null,
        delete_after_at: null,
      },
      {
        id: 'org_deleted',
        lifecycle_state: 'deleted',
        export_ready_at: expect.any(Date),
        delete_after_at: expect.any(Date),
      },
      {
        id: 'org_export',
        lifecycle_state: 'active',
        export_ready_at: null,
        delete_after_at: null,
      },
      {
        id: 'org_past_due',
        lifecycle_state: 'active',
        export_ready_at: null,
        delete_after_at: null,
      },
      {
        id: 'org_pending',
        lifecycle_state: 'active',
        export_ready_at: null,
        delete_after_at: null,
      },
      {
        id: 'org_trialing',
        lifecycle_state: 'active',
        export_ready_at: null,
        delete_after_at: null,
      },
    ]);

    const entitlements = await client.query<EntitlementRow>(
      `SELECT organization_id, status, source, grace_ends_at, canceled_at
       FROM organization_product_entitlement ORDER BY organization_id`,
    );
    expect(entitlements.rows).toEqual([
      {
        organization_id: 'org_complimentary',
        status: 'active',
        source: 'complimentary',
        grace_ends_at: null,
        canceled_at: null,
      },
      {
        organization_id: 'org_export',
        status: 'canceled',
        source: 'stripe',
        grace_ends_at: null,
        canceled_at: expect.any(Date),
      },
      {
        organization_id: 'org_past_due',
        status: 'past_due',
        source: 'stripe',
        grace_ends_at: expect.any(Date),
        canceled_at: null,
      },
      {
        organization_id: 'org_pending',
        status: 'canceled',
        source: 'stripe',
        grace_ends_at: null,
        canceled_at: expect.any(Date),
      },
      {
        organization_id: 'org_trialing',
        status: 'trialing',
        source: 'stripe',
        grace_ends_at: null,
        canceled_at: null,
      },
    ]);

    const pastDue = entitlements.rows.find((row) => row.organization_id === 'org_past_due');
    expect(new Date(pastDue?.grace_ends_at ?? 0).getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * 60 * 60 * 1000,
    );
  });
});
