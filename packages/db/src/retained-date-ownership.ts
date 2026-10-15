import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client';
import { retainedDateOwnership } from './schema/retained-date-ownership';
import { migrationRows } from './work-template-blueprint-migration/query';

/** Exact private source identity; callers must first authorize its persisted occurrence and mapping. */
export interface RetainedDateSourceScope {
  readonly organizationId: string;
  readonly occurrenceId: string;
  readonly invocationId: string;
  readonly sourceStepId: string;
  readonly workKind: 'project' | 'task' | 'milestone';
  readonly workId: string;
}
/** Trusted retained registration facts after physical mappings exist in this same transaction. */
export interface RetainedDateRegistration extends RetainedDateSourceScope {
  readonly dates: Readonly<Partial<Record<'startDate' | 'dueDate' | 'targetDate', string | null>>>;
  readonly manualFields?: ReadonlySet<'startDate' | 'dueDate' | 'targetDate'>;
}
type Connection = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;
/** Register accepted private timing without resetting ownership on replay or inventing public bindings. */
export async function registerRetainedDateOwnership(
  tx: Connection,
  input: RetainedDateRegistration,
): Promise<void> {
  const sources = await migrationRows<{
    field: 'startDate' | 'dueDate' | 'targetDate';
    source_fingerprint: string;
  }>(
    tx,
    sql`select s.field,s.source_fingerprint from docket_retained_date_sources s where s.organization_id=${input.organizationId} and s.occurrence_id=${input.occurrenceId} and s.invocation_id=${input.invocationId} and s.source_step_id=${input.sourceStepId} and s.work_kind=${input.workKind} and s.work_id=${input.workId}`,
  );
  for (const source of sources)
    await tx
      .insert(retainedDateOwnership)
      .values({
        organizationId: input.organizationId,
        occurrenceId: input.occurrenceId,
        invocationId: input.invocationId,
        sourceStepId: input.sourceStepId,
        field: source.field,
        workKind: input.workKind,
        workId: input.workId,
        manual: input.manualFields?.has(source.field) ?? false,
        lastDerivedDate: input.dates[source.field] ?? null,
        sourceFingerprint: source.source_fingerprint,
      })
      .onConflictDoNothing();
}
/** One exact private ownership mutation to include in the caller's existing reversible receipt. */
export interface RetainedDateOwnershipMutation {
  readonly before: typeof retainedDateOwnership.$inferSelect;
  readonly after: typeof retainedDateOwnership.$inferSelect;
}
/** Mark explicit ordinary dates private-manual after authorizing the exact physical work mutation. */
export async function markRetainedDatesManual(
  tx: Connection,
  input: {
    readonly organizationId: string;
    readonly workKind: 'project' | 'task' | 'milestone';
    readonly workId: string;
    readonly fields: readonly ('startDate' | 'dueDate' | 'targetDate')[];
  },
): Promise<readonly RetainedDateOwnershipMutation[]> {
  const changes: RetainedDateOwnershipMutation[] = [];
  for (const field of input.fields) {
    const where = and(
      eq(retainedDateOwnership.organizationId, input.organizationId),
      eq(retainedDateOwnership.workKind, input.workKind),
      eq(retainedDateOwnership.workId, input.workId),
      eq(retainedDateOwnership.field, field),
    );
    const rows = await tx.select().from(retainedDateOwnership).where(where).for('update');
    for (const before of rows) {
      if (before.manual) continue;
      const [after] = await tx
        .update(retainedDateOwnership)
        .set({ manual: true })
        .where(
          and(
            where,
            eq(retainedDateOwnership.occurrenceId, before.occurrenceId),
            eq(retainedDateOwnership.sourceStepId, before.sourceStepId),
          ),
        )
        .returning();
      if (!after) throw new Error('Retained date ownership is unavailable.');
      changes.push({ before, after });
    }
  }
  return changes;
}
