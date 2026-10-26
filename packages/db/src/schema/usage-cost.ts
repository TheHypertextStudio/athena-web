/**
 * `@docket/db` — the usage ledger and the rate card that prices it.
 *
 * @remarks
 * Quantities are facts and prices are opinions, so they live in different tables. `usage_daily`
 * stores how much of each resource a person or workspace consumed on a day. `usage_rate` stores what
 * one unit costs from a date forward. Dollar cost is computed when a report is read, which lets a
 * price change reprice history and lets a resource with no price yet read as unpriced rather than
 * as free.
 *
 * Both tables are additive, so the migration is safe against live production data.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { staffUser } from './admin';
import { user } from './auth';
import { organization } from './identity';

/**
 * The resources the ledger meters.
 *
 * @remarks
 * Flows (tokens) are summed over the day. Stocks (bytes) record what was held at the nightly
 * snapshot and count as one unit-day. Later phases extend this list; the CHECK constraints below are
 * generated from it so the schema and the type cannot drift.
 */
export const USAGE_RESOURCES = [
  'ai_input_tokens',
  'ai_output_tokens',
  'ai_cache_read_tokens',
  'ai_cache_write_tokens',
  'postgres_bytes',
  'object_bytes',
] as const;
/** One metered resource key. */
export type UsageResource = (typeof USAGE_RESOURCES)[number];

const RESOURCE_LIST = sql.raw(USAGE_RESOURCES.map((key) => `'${key}'`).join(', '));

/**
 * The price of one unit of one resource from a date forward.
 *
 * @remarks
 * Append-only: correcting a price adds a row with a later `effective_from`. The price is stored as
 * millionths of a US dollar per million units, which keeps every rate in use an integer — a $0.075
 * per million token price is `75000` and $0.35 per gigabyte-month spread over byte-days is `11667`.
 * An empty `dimension` is the general rate for the resource; a named dimension (a model, a table)
 * overrides it.
 */
export const usageRate = pgTable(
  'usage_rate',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    resource: text('resource').$type<UsageResource>().notNull(),
    dimension: text('dimension').notNull().default(''),
    microsPerMillionUnits: bigint('micros_per_million_units', { mode: 'number' }).notNull(),
    effectiveFrom: timestamp('effective_from').notNull(),
    note: text('note'),
    createdBy: text('created_by').references(() => staffUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('usage_rate_key_uq').on(t.resource, t.dimension, t.effectiveFrom),
    check('usage_rate_resource_check', sql`${t.resource} IN (${RESOURCE_LIST})`),
    check('usage_rate_price_check', sql`${t.microsPerMillionUnits} >= 0`),
  ],
);

/** The passes that fill the ledger. */
export const USAGE_METERS = ['ai_tokens', 'postgres_storage', 'object_storage'] as const;
/** One ledger pass. */
export type UsageMeter = (typeof USAGE_METERS)[number];

/**
 * When each meter last completed, and how its latest attempt ended.
 *
 * @remarks
 * A pass over a day with no activity writes no ledger rows, so the ledger alone cannot tell "ran and
 * found nothing" from "did not run". This row can.
 */
export const usageMeterRun = pgTable(
  'usage_meter_run',
  {
    meter: text('meter').$type<UsageMeter>().primaryKey(),
    lastSuccessAt: timestamp('last_success_at'),
    lastAttemptAt: timestamp('last_attempt_at').notNull(),
    failed: boolean('failed').notNull().default(false),
  },
  (t) => [
    check(
      'usage_meter_run_meter_check',
      sql`${t.meter} IN (${sql.raw(USAGE_METERS.map((key) => `'${key}'`).join(', '))})`,
    ),
  ],
);

/**
 * One resource's consumption by one person in one workspace on one UTC day.
 *
 * @remarks
 * `user_id` is the person whose activity caused the usage, when the source records one, and
 * `organization_id` is the workspace it happened in. Both are nullable and set null when the row they
 * point at is deleted, so purging an account leaves totals that identify no one.
 *
 * `unmeasured_events` counts events in the day that could not be quantified. A generation that ran on
 * a person's own runtime reports no tokens, and zero would erase the difference between "nothing was
 * spent" and "we cannot see what was spent".
 *
 * Rows are written by upsert on the unique key, so recomputing a day replaces it. NULLS NOT DISTINCT
 * makes a missing person or workspace part of the key rather than a way around it.
 */
export const usageDaily = pgTable(
  'usage_daily',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    day: date('day', { mode: 'string' }).notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    resource: text('resource').$type<UsageResource>().notNull(),
    dimension: text('dimension').notNull().default(''),
    quantity: bigint('quantity', { mode: 'number' }).notNull().default(0),
    unmeasuredEvents: integer('unmeasured_events').notNull().default(0),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('usage_daily_key_uq')
      .on(t.day, t.userId, t.organizationId, t.resource, t.dimension)
      .nullsNotDistinct(),
    index('usage_daily_user_day_idx').on(t.userId, t.day),
    index('usage_daily_org_day_idx').on(t.organizationId, t.day),
    index('usage_daily_day_idx').on(t.day),
    check('usage_daily_resource_check', sql`${t.resource} IN (${RESOURCE_LIST})`),
    check('usage_daily_quantity_check', sql`${t.quantity} >= 0 AND ${t.unmeasuredEvents} >= 0`),
  ],
);
