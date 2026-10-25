import type { BlueprintOccurrenceRoot } from '@docket/db';
import { BlueprintError, type BlueprintDateField } from '@docket/work/blueprints';
import type { TemplateTransaction } from '../templates/persistence';
import { loadBlueprintSnapshot } from '../work-template-blueprints/snapshot';
import { affectedBlueprintNodes } from '../work-template-blueprints/reflow-selection';
import { affectedBlueprintDateFields } from '../work-template-blueprints/reflow-selection';
import { loadNativeScheduleCompletionFacts } from './schedule-native-completion-facts';
import type {
  AuthorizedBlueprintSnapshot,
  BlueprintWorkRef,
} from '../work-template-blueprints/snapshot-types';
import { requireNativeScheduleFacts, type NativeScheduleFacts } from './schedule-native-facts';
import type { NativeScheduleSnapshot } from './schedule-native-snapshot';
import {
  addNativePrivateDependents,
  type NativePrivateDependentSelection,
} from './schedule-native-field-dependent';
import { loadNativeSchedulePrerequisites } from './schedule-native-prerequisites';

/** Native foreground closure: affected writes plus read-only actual ancestors and date prerequisites. */
export interface NativeScheduleAffectedSnapshot extends NativeScheduleSnapshot {
  readonly affectedWorkIds: ReadonlySet<string>;
  readonly manualDivergences: ReadonlySet<string>;
}
function contains(root: BlueprintOccurrenceRoot, id: string): boolean {
  return root.id === id || Boolean(root.selectedWork?.some((work) => work.id === id));
}
function ancestorIds(root: BlueprintOccurrenceRoot, seeds: readonly BlueprintWorkRef[]): string[] {
  const paths = seeds.flatMap(
    (seed) =>
      root.selectedWork?.filter((work) => work.id === seed.id).map((work) => work.path) ?? [],
  );
  return [
    root.id,
    ...(root.selectedWork ?? [])
      .filter((work) =>
        paths.some(
          (path) =>
            work.path.length < path.length &&
            work.path.every((part, index) => part === path[index]),
        ),
      )
      .map((work) => work.id),
  ];
}
function combine(
  snapshots: readonly AuthorizedBlueprintSnapshot[],
  affected: ReadonlySet<string>,
  manualDivergences: ReadonlySet<string>,
): NativeScheduleAffectedSnapshot {
  const first = snapshots[0];
  return {
    nodes: [
      ...new Map(
        snapshots.flatMap((snapshot) => snapshot.nodes.map((node) => [node.id, node] as const)),
      ).values(),
    ],
    rowsByRef: new Map(snapshots.flatMap((snapshot) => [...snapshot.rowsByRef])),
    context: first
      ? {
          ...first.context,
          completions: snapshots.flatMap((snapshot) => snapshot.context.completions),
        }
      : null,
    affectedWorkIds: affected,
    manualDivergences,
  };
}
function initialSelection(
  facts: NativeScheduleFacts,
  reference: BlueprintWorkRef,
  request: { readonly dates: readonly BlueprintDateField[]; readonly completion: boolean },
): NativePrivateDependentSelection {
  const v2 = facts.document.kind === 'forest' && facts.document.revision === 2;
  const fieldChanges = v2
    ? {
        dates: new Map([[reference.id, new Set(request.dates)]]),
        completions: new Set(request.completion ? [reference.id] : []),
      }
    : undefined;
  const anchor = v2
    ? request.dates.includes(reference.kind === 'task' ? 'dueDate' : 'targetDate')
    : request.dates.length > 0;
  return {
    affected: new Set([reference.id]),
    seeds: new Map([[reference.id, reference]]),
    anchors: new Set(anchor ? [reference.id] : []),
    manualDivergences: new Set(),
    dispositions: new Map(),
    ...(fieldChanges ? { fieldChanges } : {}),
  };
}
function rememberPublicFields(
  snapshot: AuthorizedBlueprintSnapshot,
  seeds: ReadonlySet<string>,
  selection: NativePrivateDependentSelection,
): void {
  if (selection.fieldChanges)
    for (const [id, fields] of affectedBlueprintDateFields(
      snapshot.nodes,
      seeds,
      selection.fieldChanges,
    )) {
      const previous = selection.fieldChanges.dates.get(id) ?? new Set<BlueprintDateField>();
      for (const field of fields) previous.add(field);
      selection.fieldChanges.dates.set(id, previous);
    }
  for (const id of affectedBlueprintNodes(
    snapshot.nodes,
    seeds,
    selection.anchors,
    selection.fieldChanges,
  ))
    selection.affected.add(id);
}
async function loadAffectedRoots(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
  selection: NativePrivateDependentSelection,
  snapshots: Map<string, AuthorizedBlueprintSnapshot>,
): Promise<void> {
  for (const root of facts.roots) {
    const local = [...selection.seeds.values()].filter((seed) => contains(root, seed.id));
    if (!local.length) continue;
    const snapshot = await loadBlueprintSnapshot(tx, facts.authority, root, {
      scope: 'affected',
      seeds: local,
      dateAnchors: [...selection.anchors],
      ...(selection.fieldChanges ? { fieldChanges: selection.fieldChanges } : {}),
      ancestorIds: ancestorIds(root, local),
      forUpdate: true,
      access: 'edit',
    });
    snapshots.set(root.id, snapshot);
    rememberPublicFields(snapshot, new Set(local.map((seed) => seed.id)), selection);
  }
}
/** Discover only the initiating closure and private dependents; unrelated roots never require edit authority.
 * @throws When actual affected writes exceed500 or required current work permissions fail.
 */
export async function loadNativeScheduleAffectedSnapshot(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
  reference: BlueprintWorkRef,
  change:
    | readonly BlueprintDateField[]
    | { readonly dates: readonly BlueprintDateField[]; readonly completion: boolean },
): Promise<NativeScheduleAffectedSnapshot> {
  requireNativeScheduleFacts(tx, facts.authority);
  const request = 'dates' in change ? change : { dates: change, completion: true };
  const selection = initialSelection(facts, reference, request);
  const snapshots = new Map<string, AuthorizedBlueprintSnapshot>();
  let expanded = true;
  while (expanded) {
    await loadAffectedRoots(tx, facts, selection, snapshots);
    expanded = await addNativePrivateDependents(tx, facts, selection);
    if (selection.affected.size > 500)
      throw new BlueprintError('blueprint_limit', 'Reflow at most500 affected work items.');
  }
  await loadNativeSchedulePrerequisites(tx, {
    facts,
    reference,
    explicitDates: request.dates,
    affected: selection.affected,
    snapshots,
  });
  const snapshot = combine(
    [...snapshots.values()],
    selection.affected,
    selection.manualDivergences,
  );
  const privateCompletions = await loadNativeScheduleCompletionFacts(tx, facts);
  return {
    ...snapshot,
    context: snapshot.context ? { ...snapshot.context, timezone: facts.timezone } : null,
    ...(privateCompletions ? { privateCompletions } : {}),
  };
}
