import { sql } from 'drizzle-orm';
import type { Database } from './client';
import {
  aliasReferenceCheckpoint,
  type PrivateAliasReferenceReviewCode,
} from './schema/work-template-alias-reference-checkpoint';

/** Counts measured under the finalizer's locked coverage check; retained instances remain separate source dependence. */
export interface PrivateAliasReferenceProgress {
  readonly enforced: boolean;
  readonly reason: PrivateAliasReferenceReviewCode;
  readonly sourceDefinitions: number;
  readonly sourceRevisions: number;
  readonly unresolvedHeads: number;
  readonly unresolvedRevisions: number;
  readonly unresolvedSeries: number;
  readonly unresolvedCalendars: number;
  readonly retainedInstances: number;
}
/** Optional private observer runs after the DDL/disposition transaction commits, including on retry. */
export interface PrivateAliasReferenceOptions {
  readonly onPrivateAliasReferenceCheckpoint?:
    ((progress: PrivateAliasReferenceProgress) => void | Promise<void>) | undefined;
}
/**
 * Verify complete alias populations and conditionally install exact references under the migration owner's privileges.
 * Missing proofs return an explicit retry disposition; this never activates a retained schedule or rewrites evidence.
 * @throws For SQL/privilege/integrity failure; ordinary actors cannot invoke the finalizer.
 */
export async function preparePrivateAliasReferences(
  database: Database,
  options: PrivateAliasReferenceOptions = {},
): Promise<PrivateAliasReferenceProgress> {
  const progress = await database.transaction(async (tx) => {
    await tx.execute(sql`select public.docket_enforce_private_alias_references()`);
    const [row] = await tx.select().from(aliasReferenceCheckpoint);
    if (!row) throw new Error('Private alias reference checkpoint is missing.');
    return {
      enforced: row.enforcedAt !== null,
      reason: row.reviewCode,
      sourceDefinitions: row.sourceDefinitionCount,
      sourceRevisions: row.sourceRevisionCount,
      unresolvedHeads: row.unresolvedHeadCount,
      unresolvedRevisions: row.unresolvedRevisionCount,
      unresolvedSeries: row.unresolvedSeriesCount,
      unresolvedCalendars: row.unresolvedCalendarCount,
      retainedInstances: row.retainedInstanceCount,
    };
  });
  await options.onPrivateAliasReferenceCheckpoint?.(Object.freeze({ ...progress }));
  return progress;
}
