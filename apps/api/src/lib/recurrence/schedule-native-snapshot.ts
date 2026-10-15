import { project, task } from '@docket/db';
import {
  BlueprintError,
  type BlueprintCreationContext,
  type ExistingBlueprintNode,
} from '@docket/work/blueprints';
import { and, eq, isNull } from 'drizzle-orm';
import type { TemplateTransaction } from '../templates/persistence';
import { loadBlueprintSnapshot } from '../work-template-blueprints/snapshot';
import type { BlueprintStoredWork } from '../work-template-blueprints/snapshot-types';
import { requireNativeScheduleFacts, type NativeScheduleFacts } from './schedule-native-facts';

/** Live concrete forest, including actual descendant status and public date prerequisites. */
export interface NativeScheduleSnapshot {
  readonly nodes: readonly ExistingBlueprintNode[];
  readonly rowsByRef: ReadonlyMap<string, BlueprintStoredWork>;
  readonly context: BlueprintCreationContext | null;
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
  const nodes = snapshots.flatMap((snapshot) => snapshot.nodes);
  if (nodes.length > 500 || new Set(nodes.map((node) => node.id)).size !== nodes.length)
    throw new BlueprintError('blueprint_limit', 'Reflow at most 500 distinct actual work items.');
  const first = snapshots[0];
  return {
    nodes,
    rowsByRef: new Map(snapshots.flatMap((snapshot) => [...snapshot.rowsByRef])),
    context: first
      ? {
          ...first.context,
          timezone: facts.timezone,
          runDate: facts.occurrence.scheduledFor,
          completions: snapshots.flatMap((snapshot) => snapshot.context.completions),
        }
      : null,
  };
}
