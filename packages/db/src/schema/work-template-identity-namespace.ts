import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
/**
 * Migrator-owned global namespace coverage receipt, containing no tenant bodies or execution authority.
 * There are deliberately no actor RLS policies. The definer exposes only a readiness boolean;
 * uniqueness and checked retained reservations enforce identity, while this hash covers fixed-size facts.
 */
export const privateIdentityNamespace = pgTable(
  'work_template_identity_namespace',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    reviewCode: text('review_code')
      .$type<'reservation_pending' | 'identity_collision'>()
      .default('reservation_pending'),
    unreservedSourceCount: integer('unreserved_source_count'),
    reservedSourceCount: integer('reserved_source_count'),
    coverageHash: text('coverage_hash'),
  },
  (table) => [
    check('work_template_identity_namespace_singleton_check', sql`${table.singleton}`),
    check(
      'work_template_identity_namespace_review_code_check',
      sql`${table.reviewCode} in('reservation_pending','identity_collision')`,
    ),
    check(
      'work_template_identity_namespace_unreserved_source_count_check',
      sql`${table.unreservedSourceCount}>=0`,
    ),
    check(
      'identity_namespace_receipt_shape',
      sql`(${table.readyAt} is null and ${table.reservedSourceCount} is null and ${table.coverageHash} is null and ${table.reviewCode} is not null) or (${table.readyAt} is not null and ${table.reservedSourceCount}>=0 and ${table.coverageHash} ~ '^sha256:[a-f0-9]{64}$' and ${table.reviewCode} is null and ${table.unreservedSourceCount}=0)`,
    ),
  ],
).enableRLS();
