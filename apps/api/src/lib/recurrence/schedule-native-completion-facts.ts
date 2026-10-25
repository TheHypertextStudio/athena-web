import { task, workStatus } from '@docket/db';
import type { BlueprintCompletionFact } from '@docket/work/blueprints';
import { and, eq, inArray } from 'drizzle-orm';
import type { TemplateTransaction } from '../templates/persistence';
import { requireNativeScheduleFacts, type NativeScheduleFacts } from './schedule-native-facts';

/** Read only actual accepted Task completion facts; checked occurrence authority never reveals work prose. */
export async function loadNativeScheduleCompletionFacts(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
): Promise<readonly BlueprintCompletionFact[] | undefined> {
  requireNativeScheduleFacts(tx, facts.authority);
  if (facts.document.kind !== 'forest' || facts.document.revision !== 2) return undefined;
  const accepted = new Map(
    facts.roots.flatMap((root) =>
      [root, ...(root.selectedWork ?? [])]
        .filter((work) => work.kind === 'task')
        .map((work) => [work.id, 'path' in work ? work.path : []] as const),
    ),
  );
  if (!accepted.size) return [];
  const rows = await tx
    .select({
      id: task.id,
      completedAt: task.completedAt,
      canceledAt: task.canceledAt,
      category: workStatus.category,
    })
    .from(task)
    .leftJoin(
      workStatus,
      and(eq(workStatus.id, task.statusId), eq(workStatus.organizationId, facts.organizationId)),
    )
    .where(
      and(eq(task.organizationId, facts.organizationId), inArray(task.id, [...accepted.keys()])),
    )
    .orderBy(task.id)
    .for('no key update', { of: task });
  const legacy = facts.document.completionPolicy.kind === 'legacy_authored_tasks';
  return rows.map((row) => ({
    id: row.id,
    path: accepted.get(row.id) ?? [],
    completedAt: row.completedAt?.toISOString() ?? null,
    state: legacy
      ? row.completedAt
        ? 'completed'
        : 'open'
      : row.canceledAt || row.category === 'canceled'
        ? 'canceled'
        : row.completedAt || row.category === 'completed'
          ? 'completed'
          : 'open',
  }));
}
