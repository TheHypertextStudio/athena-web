import type { NativeScheduleDateOwnership } from '@docket/db';
import type { BlueprintDateField } from '@docket/work/blueprints';
import type { TemplateTransaction } from '../templates/persistence';
import type { BlueprintWorkRef } from '../work-template-blueprints/snapshot-types';
import {
  readNativeDependentDisposition,
  type NativeDependentDisposition,
} from './schedule-native-dependent';
import type { NativeScheduleFacts } from './schedule-native-facts';

/** Mutable foreground selection; only checked potential writes consume the affected-work budget. */
export interface NativePrivateDependentSelection {
  readonly affected: Set<string>;
  readonly seeds: Map<string, BlueprintWorkRef>;
  readonly anchors: Set<string>;
  readonly manualDivergences: Set<string>;
  readonly dispositions: Map<string, NativeDependentDisposition>;
  readonly fieldChanges?: {
    readonly dates: Map<string, Set<BlueprintDateField>>;
    readonly completions: ReadonlySet<string>;
  };
}
function sourceChanged(
  entry: NativeScheduleDateOwnership,
  selection: NativePrivateDependentSelection,
): boolean {
  if (entry.anchor.kind === 'work') return selection.affected.has(entry.anchor.id);
  if (entry.anchor.kind !== 'field' || !selection.fieldChanges) return false;
  const source = entry.anchor.source;
  if (source.kind === 'work_date')
    return Boolean(selection.fieldChanges.dates.get(source.work.id)?.has(source.field));
  return (
    source.kind === 'after_completion' &&
    source.works.some(
      (work) => work.kind === 'task' && selection.fieldChanges?.completions.has(work.id),
    )
  );
}
function shouldSelect(
  entry: NativeScheduleDateOwnership,
  selection: NativePrivateDependentSelection,
): boolean {
  const selected = selection.fieldChanges
    ? selection.fieldChanges.dates.get(entry.id)?.has(entry.field)
    : selection.seeds.has(entry.id);
  return !entry.manual && !selected && sourceChanged(entry, selection);
}
function remember(
  entry: NativeScheduleDateOwnership,
  selection: NativePrivateDependentSelection,
): void {
  selection.seeds.set(entry.id, { kind: entry.kind, id: entry.id });
  if (entry.field === (entry.kind === 'task' ? 'dueDate' : 'targetDate'))
    selection.anchors.add(entry.id);
  if (selection.fieldChanges) {
    const fields = selection.fieldChanges.dates.get(entry.id) ?? new Set<BlueprintDateField>();
    fields.add(entry.field);
    selection.fieldChanges.dates.set(entry.id, fields);
  }
  selection.affected.add(entry.id);
}
/** Expand private date consumers only for the actual changed source field or actual lifecycle fact. */
export async function addNativePrivateDependents(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
  selection: NativePrivateDependentSelection,
): Promise<boolean> {
  let expanded = false;
  for (const entry of facts.occurrence.scheduleDateOwnership ?? []) {
    if (!shouldSelect(entry, selection)) continue;
    const key = `${entry.id}:${entry.field}`;
    const disposition =
      selection.dispositions.get(key) ??
      (await readNativeDependentDisposition(tx, facts.organizationId, entry));
    selection.dispositions.set(key, disposition);
    if (disposition === 'manual') selection.manualDivergences.add(key);
    if (disposition !== 'write') continue;
    remember(entry, selection);
    expanded = true;
  }
  return expanded;
}
