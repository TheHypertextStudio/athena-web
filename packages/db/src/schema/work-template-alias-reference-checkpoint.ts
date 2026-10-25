import { sql } from 'drizzle-orm';
import { bigint, boolean, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Owned retry reasons distinguish identity/alias coverage from executable conversion and source retirement. */
export type PrivateAliasReferenceReviewCode =
  | 'coverage_pending'
  | 'identity_unproved'
  | 'head_unregistered'
  | 'revision_unregistered'
  | 'series_mismatch'
  | 'calendar_mismatch'
  | 'private_structure_unavailable'
  | 'enforced';

/** Owned retry disposition for exact alias references; no body, execution claim or actor policy. */
export const aliasReferenceCheckpoint = pgTable(
  'work_template_alias_reference_checkpoint',
  {
    singleton: boolean('singleton').primaryKey().notNull().default(true),
    enforcedAt: timestamp('enforced_at', { withTimezone: true }),
    reviewCode: text('review_code')
      .$type<PrivateAliasReferenceReviewCode>()
      .notNull()
      .default('coverage_pending'),
    sourceDefinitionCount: bigint('source_definition_count', { mode: 'number' })
      .notNull()
      .default(0),
    sourceRevisionCount: bigint('source_revision_count', { mode: 'number' }).notNull().default(0),
    unresolvedHeadCount: bigint('unresolved_head_count', { mode: 'number' }).notNull().default(0),
    unresolvedRevisionCount: bigint('unresolved_revision_count', { mode: 'number' })
      .notNull()
      .default(0),
    unresolvedSeriesCount: bigint('unresolved_series_count', { mode: 'number' })
      .notNull()
      .default(0),
    unresolvedCalendarCount: bigint('unresolved_calendar_count', { mode: 'number' })
      .notNull()
      .default(0),
    retainedInstanceCount: bigint('retained_instance_count', { mode: 'number' })
      .notNull()
      .default(0),
  },
  (t) => [
    check('work_template_alias_reference_checkpoint_singleton_check', sql`${t.singleton}`),
    check(
      'work_template_alias_reference_checkpoint_review_code_check',
      sql`${t.reviewCode} in('coverage_pending','identity_unproved','head_unregistered','revision_unregistered','series_mismatch','calendar_mismatch','private_structure_unavailable','enforced')`,
    ),
    check(
      'work_template_alias_reference_che_source_definition_count_check',
      sql`${t.sourceDefinitionCount}>=0`,
    ),
    check(
      'work_template_alias_reference_check_source_revision_count_check',
      sql`${t.sourceRevisionCount}>=0`,
    ),
    check(
      'work_template_alias_reference_check_unresolved_head_count_check',
      sql`${t.unresolvedHeadCount}>=0`,
    ),
    check(
      'work_template_alias_reference_c_unresolved_revision_count_check',
      sql`${t.unresolvedRevisionCount}>=0`,
    ),
    check(
      'work_template_alias_reference_che_unresolved_series_count_check',
      sql`${t.unresolvedSeriesCount}>=0`,
    ),
    check(
      'work_template_alias_reference_c_unresolved_calendar_count_check',
      sql`${t.unresolvedCalendarCount}>=0`,
    ),
    check(
      'work_template_alias_reference_che_retained_instance_count_check',
      sql`${t.retainedInstanceCount}>=0`,
    ),
    check(
      'alias_reference_checkpoint_shape',
      sql`(${t.enforcedAt} is null and ${t.reviewCode}<>'enforced') or (${t.enforcedAt} is not null and ${t.reviewCode}='enforced' and ${t.unresolvedHeadCount}=0 and ${t.unresolvedRevisionCount}=0 and ${t.unresolvedSeriesCount}=0 and ${t.unresolvedCalendarCount}=0)`,
    ),
  ],
).enableRLS();
