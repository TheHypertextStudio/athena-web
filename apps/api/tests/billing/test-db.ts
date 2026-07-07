import { fullSchema, type Database } from '@docket/db';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

/** A PGlite-backed database fixture for organization lifecycle tests. */
export interface BillingLifecycleDbFixture {
  /** Drizzle database client wired to the in-memory PGlite database. */
  readonly db: Database;
  /** Raw PGlite client so the owning suite can close worker resources. */
  readonly client: PGlite;
}

/**
 * Create the minimal schema exercised by billing lifecycle tests.
 *
 * @remarks
 * These tests only mutate `organization` lifecycle columns. Bootstrapping that table
 * directly keeps root test runs parallel without paying for every package migration.
 */
export async function createBillingLifecycleDb(): Promise<BillingLifecycleDbFixture> {
  const client = new PGlite('memory://');
  await client.exec(`
    create type org_lifecycle_state as enum (
      'trialing',
      'active',
      'past_due',
      'export_window',
      'pending_deletion',
      'deleted'
    );

    create table "organization" (
      id text primary key,
      name text not null,
      slug text not null,
      purpose text,
      avatar text,
      is_personal boolean not null default false,
      vocabulary jsonb not null default '{}'::jsonb,
      agent_guidance text,
      approval_routing jsonb,
      lifecycle_state org_lifecycle_state not null default 'trialing',
      export_ready_at timestamp,
      delete_after_at timestamp,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      archived_at timestamp
    );
  `);

  return { db: drizzle(client, { schema: fullSchema }), client };
}
