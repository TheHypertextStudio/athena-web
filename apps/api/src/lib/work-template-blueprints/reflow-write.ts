import { initiative, milestone, program, project, task } from '@docket/db';
import { BlueprintError, type BlueprintDateField } from '@docket/work/blueprints';
import type { BlueprintDateBindings } from '@docket/work/work-template-blueprint';
import { and, eq } from 'drizzle-orm';
import { trackedFields, type RecordedChange } from '../../mcp/change-set';
import type { TemplateTransaction } from '../templates/persistence';
import type { BlueprintStoredWork, BlueprintWorkRef } from './snapshot-types';

/** Existing receipt entries and deferred row projections; caller owns transaction and receipt. */
export interface BlueprintReflowResult {
  readonly changes: readonly RecordedChange[];
  readonly rows: readonly BlueprintStoredWork[];
  /** Native occurrence completion is reconciled only after the enclosing ordinary mutation commits. */
  readonly nativeCompletions?: readonly {
    readonly occurrenceId: string;
    readonly actorId: string;
    readonly initiatingWork: BlueprintWorkRef;
  }[];
}
/** Exact authorized relative date writes; public and private ownership remain separate. */
export interface BlueprintDerivedDateWrite {
  readonly organizationId: string;
  readonly work: BlueprintStoredWork;
  readonly dates: Readonly<Partial<Record<BlueprintDateField, string | null>>>;
  readonly bindings?: BlueprintDateBindings;
}
const tables = { initiative, program, project, task, milestone };
/** Write only derived date columns and accepted public bindings through the caller's existing transaction. */
export async function writeBlueprintDerivedDate(
  tx: TemplateTransaction,
  input: BlueprintDerivedDateWrite,
): Promise<BlueprintReflowResult> {
  const { work } = input,
    patch: Record<string, unknown> = {};
  for (const [field, date] of Object.entries(input.dates)) {
    if (!(field in work.row))
      throw new BlueprintError(
        'blueprint_invalid',
        'Date field does not belong to this work kind.',
      );
    patch[field] = date === null ? null : new Date(date);
    if (work.kind === 'project' || work.kind === 'initiative') {
      patch[`${field}Resolution`] = null;
      patch[`${field}FiscalYearStartMonth`] = null;
    }
  }
  if (input.bindings) patch['blueprintDateBindings'] = input.bindings;
  const table = tables[work.kind];
  const [after] = await tx
    .update(table)
    .set(patch)
    .where(and(eq(table.organizationId, input.organizationId), eq(table.id, work.id)))
    .returning();
  if (!after) throw new BlueprintError('blueprint_invalid', 'Derived work is unavailable.');
  return {
    changes: [
      {
        kind: work.kind,
        id: work.id,
        op: 'update',
        before: trackedFields(work.kind, work.row),
        after: trackedFields(work.kind, after),
      },
    ],
    rows: [{ kind: work.kind, id: work.id, row: after } as BlueprintStoredWork],
  };
}
