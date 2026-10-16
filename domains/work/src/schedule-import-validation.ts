import type {
  LegacyScheduleImportInput,
  LegacyScheduleImportDisposition,
} from './contracts/work-schedule-import';
import { scheduleTimingRefKey } from './schedule-field-timing-types';
function distinct(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
function sourceStructure(input: LegacyScheduleImportInput): boolean {
  const mappings = new Map(input.sourceMappings.map((mapping) => [mapping.sourceKey, mapping]));
  const selected = new Map(
    input.selectedWork.map((work) => [scheduleTimingRefKey(work.reference), work.kind]),
  );
  if (
    !distinct(input.steps.map((step) => step.key)) ||
    !distinct(input.sourceMappings.map((mapping) => mapping.alias)) ||
    mappings.size !== input.sourceMappings.length ||
    selected.size !== input.selectedWork.length ||
    input.steps.length !== mappings.size
  )
    return false;
  if (!distinct(input.sourceMappings.map((mapping) => scheduleTimingRefKey(mapping.reference))))
    return false;
  return input.steps.every((step) => {
    const mapping = mappings.get(step.key);
    return (
      mapping?.kind === step.kind &&
      selected.get(scheduleTimingRefKey(mapping.reference)) === mapping.kind &&
      typeof step.fieldOverrides[step.kind === 'task' ? 'title' : 'name'] === 'string'
    );
  });
}
function rootsStructure(input: LegacyScheduleImportInput): boolean {
  const roots = new Set(input.roots.map((root) => root.key));
  if (
    roots.size !== input.roots.length ||
    input.selectedWork.some((work) => !roots.has(work.reference.rootKey))
  )
    return false;
  const selected = new Map(
    input.selectedWork.map((work) => [scheduleTimingRefKey(work.reference), work.kind]),
  );
  if (
    input.selectedWork.some(
      ({ reference }) =>
        reference.path.length > 0 &&
        !selected.has(
          scheduleTimingRefKey({ rootKey: reference.rootKey, path: reference.path.slice(0, -1) }),
        ),
    )
  )
    return false;
  return input.roots.every((root) => {
    const mapping = input.sourceMappings.find(
      (row) => row.reference.rootKey === root.key && row.reference.path.length === 0,
    );
    if (!mapping || mapping.kind !== root.root?.kind || root.template?.targetType !== mapping.kind)
      return false;
    return root.stepOverrides.every(
      (override) =>
        selected.get(scheduleTimingRefKey({ rootKey: root.key, path: override.path })) ===
        override.kind,
    );
  });
}
/** Refuse ambiguous source/closure structure before shared timing translation; missing selections never resolve latest. */
export function legacyImportDisposition(
  input: LegacyScheduleImportInput,
): LegacyScheduleImportDisposition | null {
  if (input.state === 'pending_draft') return 'pending_source';
  if (
    input.selectedWork.length > 500 ||
    input.sourceMappings.length > 500 ||
    input.roots.length > 500
  )
    return 'oversized_source';
  if (input.roots.some((root) => !root.root || root.template?.selection.kind !== 'pinned'))
    return 'missing_selection';
  if (
    !input.roots.length ||
    !input.steps.length ||
    !sourceStructure(input) ||
    !rootsStructure(input)
  )
    return 'invalid_structure';
  return null;
}
