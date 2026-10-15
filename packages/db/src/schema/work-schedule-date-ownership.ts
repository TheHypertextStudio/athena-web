/** Private native date ownership registered from an applied claim and its actual work receipt.
 * Source-derived dates remain managed even if ordinary blueprint planning called their override
 * manual. Only explicit saved draft dates or subsequent foreground writes pin these facts.
 */
export interface NativeScheduleDateOwnership {
  readonly rootKey: string;
  readonly path: readonly string[];
  readonly kind: 'task' | 'project' | 'milestone';
  readonly id: string;
  readonly field: 'startDate' | 'dueDate' | 'targetDate';
  readonly anchor:
    | { readonly kind: 'run' }
    | { readonly kind: 'work'; readonly id: string; readonly offsetDays: number };
  readonly manual: boolean;
  readonly lastDerivedDate: string | null;
}
import { foreignKey, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** A stable same-tenant successor link without reusing the provider's occurrence key namespace. */
export function nativeScheduleOccurrenceConstraints(t: {
  id: AnyPgColumn;
  organizationId: AnyPgColumn;
  continuedFromOccurrenceId: AnyPgColumn;
}): (ReturnType<typeof foreignKey> | ReturnType<ReturnType<typeof uniqueIndex>['on']>)[] {
  return [
    uniqueIndex('schedule_occurrence_tenant_identity_unique').on(t.id, t.organizationId),
    uniqueIndex('schedule_occurrence_continuation_unique').on(t.continuedFromOccurrenceId),
    foreignKey({
      name: 'schedule_occurrence_continuation_tenant_fk',
      columns: [t.continuedFromOccurrenceId, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
    }).onDelete('restrict'),
  ];
}
