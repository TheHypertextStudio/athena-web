import type { BlueprintOccurrenceRoot } from '@docket/db';
import { BlueprintError, type BlueprintDateField } from '@docket/work/blueprints';
import type { TemplateTransaction } from '../templates/persistence';
import { loadBlueprintSnapshot } from '../work-template-blueprints/snapshot';
import { affectedBlueprintNodes } from '../work-template-blueprints/reflow-selection';
import type {
  AuthorizedBlueprintSnapshot,
  BlueprintWorkRef,
} from '../work-template-blueprints/snapshot-types';
import { requireNativeScheduleFacts, type NativeScheduleFacts } from './schedule-native-facts';
import type { NativeScheduleSnapshot } from './schedule-native-snapshot';
import {
  readNativeDependentDisposition,
  type NativeDependentDisposition,
} from './schedule-native-dependent';

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
async function loadPrivatePrerequisites(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
  initiating: {
    readonly reference: BlueprintWorkRef;
    readonly explicitDates: readonly BlueprintDateField[];
  },
  affected: ReadonlySet<string>,
  snapshots: Map<string, AuthorizedBlueprintSnapshot>,
): Promise<void> {
  const loaded = new Set(
    [...snapshots.values()].flatMap((snapshot) => snapshot.nodes.map((node) => node.id)),
  );
  for (const entry of facts.occurrence.scheduleDateOwnership ?? []) {
    if (entry.manual || !affected.has(entry.id) || entry.anchor.kind !== 'work') continue;
    if (entry.id === initiating.reference.id && initiating.explicitDates.includes(entry.field))
      continue;
    if (loaded.has(entry.anchor.id)) continue;
    const sourceId = entry.anchor.id;
    const source = facts.roots
      .flatMap((root) => [root, ...(root.selectedWork ?? [])])
      .find((work) => work.id === sourceId);
    if (!source)
      throw new BlueprintError('blueprint_invalid', 'Missing accepted private prerequisite.');
    const snapshot = await loadBlueprintSnapshot(tx, facts.authority, source, {
      scope: 'reference',
      forUpdate: true,
      access: 'view',
    });
    snapshots.set(`prerequisite:${source.id}`, snapshot);
    loaded.add(source.id);
  }
}
interface PrivateDependentSelection {
  readonly affected: Set<string>;
  readonly seeds: Map<string, BlueprintWorkRef>;
  readonly anchors: Set<string>;
  readonly manualDivergences: Set<string>;
  readonly dispositions: Map<string, NativeDependentDisposition>;
}
async function addPrivateDependents(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
  selection: PrivateDependentSelection,
): Promise<boolean> {
  const { affected, seeds, anchors, manualDivergences, dispositions } = selection;
  let expanded = false;
  for (const entry of facts.occurrence.scheduleDateOwnership ?? []) {
    if (
      entry.manual ||
      entry.anchor.kind !== 'work' ||
      !affected.has(entry.anchor.id) ||
      seeds.has(entry.id)
    )
      continue;
    const key = `${entry.id}:${entry.field}`;
    const disposition =
      dispositions.get(key) ??
      (await readNativeDependentDisposition(tx, facts.organizationId, entry));
    dispositions.set(key, disposition);
    if (disposition === 'manual') manualDivergences.add(key);
    if (disposition !== 'write') continue;
    seeds.set(entry.id, { kind: entry.kind, id: entry.id });
    anchors.add(entry.id);
    affected.add(entry.id);
    expanded = true;
  }
  return expanded;
}
/** Discover only the initiating closure and private dependents; unrelated roots never require edit authority.
 * @throws When actual affected writes exceed500 or required current work permissions fail.
 */
export async function loadNativeScheduleAffectedSnapshot(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
  reference: BlueprintWorkRef,
  explicitDates: readonly BlueprintDateField[],
): Promise<NativeScheduleAffectedSnapshot> {
  requireNativeScheduleFacts(tx, facts.authority);
  const seeds = new Map([[reference.id, reference]]);
  const anchors = new Set(explicitDates.length ? [reference.id] : []);
  const snapshots = new Map<string, AuthorizedBlueprintSnapshot>();
  const affected = new Set([reference.id]);
  const manualDivergences = new Set<string>();
  const dispositions = new Map<string, NativeDependentDisposition>();
  let expanded = true;
  while (expanded) {
    for (const root of facts.roots) {
      const local = [...seeds.values()].filter((seed) => contains(root, seed.id));
      if (!local.length) continue;
      const snapshot = await loadBlueprintSnapshot(tx, facts.authority, root, {
        scope: 'affected',
        seeds: local,
        dateAnchors: [...anchors],
        ancestorIds: ancestorIds(root, local),
        forUpdate: true,
        access: 'edit',
      });
      snapshots.set(root.id, snapshot);
      for (const id of affectedBlueprintNodes(
        snapshot.nodes,
        new Set(local.map((seed) => seed.id)),
        anchors,
      ))
        affected.add(id);
    }
    expanded = await addPrivateDependents(tx, facts, {
      affected,
      seeds,
      anchors,
      manualDivergences,
      dispositions,
    });
    if (affected.size > 500)
      throw new BlueprintError('blueprint_limit', 'Reflow at most500 affected work items.');
  }
  await loadPrivatePrerequisites(tx, facts, { reference, explicitDates }, affected, snapshots);
  return combine([...snapshots.values()], affected, manualDivergences);
}
