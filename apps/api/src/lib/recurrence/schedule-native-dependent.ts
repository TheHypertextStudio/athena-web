import { milestone, project, task, workStatus, type NativeScheduleDateOwnership } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { TemplateTransaction } from '../templates/persistence';
import { snapshotCivilDate } from '../work-template-blueprints/snapshot-map';

/** Whether an exact private consumer needs a physical date write, an inferred pin, or no action. */
export type NativeDependentDisposition = 'write' | 'manual' | 'none';
interface CurrentDependentDate {
  readonly date: Date | null;
  readonly category: string | null;
  readonly completedAt?: Date | null;
  readonly canceledAt?: Date | null;
}
async function currentDependentDate(
  tx: TemplateTransaction,
  organizationId: string,
  entry: NativeScheduleDateOwnership,
): Promise<CurrentDependentDate | undefined> {
  if (entry.kind === 'milestone') {
    const [row] = await tx
      .select({ date: milestone.targetDate })
      .from(milestone)
      .where(
        and(
          eq(milestone.organizationId, organizationId),
          eq(milestone.id, entry.id),
          isNull(milestone.archivedAt),
        ),
      )
      .limit(1);
    return row ? { ...row, category: null } : undefined;
  }
  if (entry.kind === 'task') {
    const [row] = await tx
      .select({
        date: entry.field === 'startDate' ? task.startDate : task.dueDate,
        completedAt: task.completedAt,
        canceledAt: task.canceledAt,
        category: workStatus.category,
      })
      .from(task)
      .leftJoin(
        workStatus,
        and(eq(workStatus.id, task.statusId), eq(workStatus.organizationId, organizationId)),
      )
      .where(
        and(
          eq(task.organizationId, organizationId),
          eq(task.id, entry.id),
          isNull(task.archivedAt),
        ),
      )
      .limit(1);
    return row;
  }
  const [row] = await tx
    .select({
      date: entry.field === 'startDate' ? project.startDate : project.targetDate,
      category: workStatus.category,
    })
    .from(project)
    .leftJoin(
      workStatus,
      and(eq(workStatus.id, project.statusId), eq(workStatus.organizationId, organizationId)),
    )
    .where(
      and(
        eq(project.organizationId, organizationId),
        eq(project.id, entry.id),
        isNull(project.archivedAt),
      ),
    )
    .limit(1);
  return row;
}
/** Inspect only actual lifecycle/date facts before expanding a private edit closure; hidden prose is never loaded.
 * Caller supplies ownership from a checked persisted native occurrence; this projection grants no work write.
 */
export async function readNativeDependentDisposition(
  tx: TemplateTransaction,
  organizationId: string,
  entry: NativeScheduleDateOwnership,
): Promise<NativeDependentDisposition> {
  if (entry.manual) return 'none';
  const row = await currentDependentDate(tx, organizationId, entry);
  if (
    !row ||
    row.completedAt ||
    row.canceledAt ||
    row.category === 'completed' ||
    row.category === 'canceled'
  )
    return 'none';
  return snapshotCivilDate(row.date) === entry.lastDerivedDate ? 'write' : 'manual';
}
