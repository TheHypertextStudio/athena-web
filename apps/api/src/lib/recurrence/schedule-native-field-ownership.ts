import type { BlueprintOccurrenceRoot, NativeScheduleDateOwnership } from '@docket/db';
import { BlueprintError, type ExistingBlueprintNode } from '@docket/work/blueprints';
import type { WorkScheduleForestV2 } from '@docket/work/work-schedule-forest-v2';
import type {
  WorkScheduleFieldRule,
  WorkScheduleFieldTarget,
  WorkScheduleTimingRef,
} from '@docket/work/work-schedule-field-timing';

function actual(roots: readonly BlueprintOccurrenceRoot[], ref: WorkScheduleTimingRef) {
  const root = roots.find((entry) => entry.key === ref.rootKey);
  const work = ref.path.length
    ? root?.selectedWork?.find((entry) => JSON.stringify(entry.path) === JSON.stringify(ref.path))
    : root;
  if (!work || (work.kind !== 'task' && work.kind !== 'project' && work.kind !== 'milestone'))
    throw new BlueprintError(
      'blueprint_invalid',
      'Private date policy requires its exact accepted work.',
    );
  return { kind: work.kind, id: work.id };
}
function anchor(
  rule: WorkScheduleFieldRule,
  roots: readonly BlueprintOccurrenceRoot[],
): NativeScheduleDateOwnership['anchor'] {
  const source = rule.source;
  if (source.kind === 'run') return { kind: 'field', source: { kind: 'run' }, offset: rule.offset };
  if (source.kind === 'work_date')
    return {
      kind: 'field',
      source: { kind: 'work_date', work: actual(roots, source.work), field: source.field },
      offset: rule.offset,
    };
  return {
    kind: 'field',
    source: { kind: 'after_completion', works: source.works.map((ref) => actual(roots, ref)) },
    offset: rule.offset,
  };
}
function entry(
  document: WorkScheduleForestV2,
  roots: readonly BlueprintOccurrenceRoot[],
  nodes: readonly ExistingBlueprintNode[],
  target: WorkScheduleFieldTarget,
  savedAnchor: NativeScheduleDateOwnership['anchor'],
): NativeScheduleDateOwnership {
  const work = actual(roots, target);
  const node = nodes.find((value) => value.id === work.id && value.kind === work.kind);
  if (!node)
    throw new BlueprintError('blueprint_invalid', 'Missing private date registration work.');
  const draft = document.roots.find((root) => root.key === target.rootKey)?.draft;
  const authored = target.path.length
    ? draft?.stepOverrides.find((part) => JSON.stringify(part.path) === JSON.stringify(target.path))
    : draft?.root;
  const dates = authored && 'dates' in authored ? authored.dates : undefined;
  return {
    rootKey: target.rootKey,
    path: [...target.path],
    ...work,
    field: target.field,
    anchor: savedAnchor,
    manual: Object.entries(dates ?? {}).some(
      ([field, value]) => field === target.field && value !== undefined,
    ),
    lastDerivedDate: node.dates[target.field] ?? null,
  };
}
/** Register independent fields and explicit absence only from saved v2 policy and accepted physical work. */
export function nativeFieldDateOwnership(
  document: WorkScheduleForestV2,
  roots: readonly BlueprintOccurrenceRoot[],
  nodes: readonly ExistingBlueprintNode[],
): NativeScheduleDateOwnership[] {
  return [
    ...document.timing.rules.map((rule) =>
      entry(document, roots, nodes, rule.target, anchor(rule, roots)),
    ),
    ...document.absentFields.map((target) =>
      entry(document, roots, nodes, target, { kind: 'absent' }),
    ),
  ];
}
/** Actual private prerequisite IDs; completion anchors never borrow a prerequisite's planned date. */
export function nativeScheduleAnchorSources(
  anchor: NativeScheduleDateOwnership['anchor'],
): readonly string[] {
  if (anchor.kind === 'work') return [anchor.id];
  if (anchor.kind !== 'field') return [];
  if (anchor.source.kind === 'work_date') return [anchor.source.work.id];
  return anchor.source.kind === 'after_completion'
    ? anchor.source.works.map((work) => work.id)
    : [];
}
