import { project, task } from '@docket/db';
import {
  BlueprintError,
  type BlueprintCreationContext,
  type ExistingBlueprintNode,
  type BlueprintCompletionFact,
} from '@docket/work/blueprints';
import { and, eq, isNull } from 'drizzle-orm';
import type { TemplateTransaction } from '../templates/persistence';
import { loadBlueprintSnapshot } from '../work-template-blueprints/snapshot';
import type { BlueprintStoredWork } from '../work-template-blueprints/snapshot-types';
import { requireNativeScheduleFacts, type NativeScheduleFacts } from './schedule-native-facts';
import { loadNativeScheduleCompletionFacts } from './schedule-native-completion-facts';

/** Live concrete forest, including actual descendant status and public date prerequisites. */
export interface NativeScheduleSnapshot {
  readonly nodes: readonly ExistingBlueprintNode[];
  readonly rowsByRef: ReadonlyMap<string, BlueprintStoredWork>;
  readonly context: BlueprintCreationContext | null;
  readonly privateCompletions?: readonly BlueprintCompletionFact[];
}
/**
 * Merge overlapping physical captures by actual identity, preserving the longest checked ancestry.
 * Logical selected-root aliases stay in occurrence roots; this bound counts distinct physical work.
 * @throws For more than 500 distinct actual rows or contradictory work kinds.
 */
export function mergeNativeScheduleSnapshotNodes(
  captures: readonly (readonly ExistingBlueprintNode[])[],
): ExistingBlueprintNode[] {
  const byId = new Map<string, ExistingBlueprintNode>();
  for (const nodes of captures)
    for (const node of nodes) {
      const previous = byId.get(node.id);
      if (previous && previous.kind !== node.kind)
        throw new BlueprintError('blueprint_invalid', 'Actual schedule work kind changed.');
      if (!previous || previous.path.length < node.path.length) byId.set(node.id, node);
    }
  if (byId.size > 500)
    throw new BlueprintError('blueprint_limit', 'Reflow at most 500 distinct actual work items.');
  return [...byId.values()];
}
/** Load living actual roots; missing or archived roots remain absent and never trigger replacement work. */
export async function loadNativeScheduleSnapshot(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
  access: 'view' | 'edit',
): Promise<NativeScheduleSnapshot> {
  requireNativeScheduleFacts(tx, facts.authority);
  const snapshots = [];
  for (const root of [...facts.roots].sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  )) {
    const table = root.kind === 'task' ? task : project;
    const [living] = await tx
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.id, root.id),
          eq(table.organizationId, facts.organizationId),
          isNull(table.archivedAt),
        ),
      )
      .limit(1);
    if (living)
      snapshots.push(
        await loadBlueprintSnapshot(tx, facts.authority, root, {
          scope: 'tree',
          forUpdate: true,
          access,
        }),
      );
  }
  const nodes = mergeNativeScheduleSnapshotNodes(snapshots.map((snapshot) => snapshot.nodes));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const first = snapshots[0];
  const privateCompletions = await loadNativeScheduleCompletionFacts(tx, facts);
  return {
    nodes,
    rowsByRef: new Map(snapshots.flatMap((snapshot) => [...snapshot.rowsByRef])),
    ...(privateCompletions ? { privateCompletions } : {}),
    context: first
      ? {
          ...first.context,
          timezone: facts.timezone,
          runDate: facts.occurrence.scheduledFor,
          completions: [
            ...new Map(
              snapshots
                .flatMap((snapshot) => snapshot.context.completions)
                .map((fact) => [
                  fact.id,
                  { ...fact, path: byId.get(fact.id ?? '')?.path ?? fact.path },
                ]),
            ).values(),
          ],
        }
      : null,
  };
}
