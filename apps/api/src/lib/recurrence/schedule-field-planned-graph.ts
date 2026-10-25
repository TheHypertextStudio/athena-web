import type { BlueprintDateField, PlannedWorkTree } from '@docket/work/blueprints';
import type {
  WorkScheduleFieldRule,
  WorkScheduleFieldTarget,
  WorkScheduleFieldTiming,
} from '@docket/work/work-schedule-field-timing';

function key(target: WorkScheduleFieldTarget): string {
  return JSON.stringify([target.rootKey, target.path, target.field]);
}
function publicRules(rootKey: string, tree: PlannedWorkTree): WorkScheduleFieldRule[] {
  return tree.nodes.flatMap((node) =>
    Object.entries(node.dateBindings).flatMap(([field, binding]): WorkScheduleFieldRule[] => {
      if (!binding || binding.manual || binding.rule.kind === 'none') return [];
      const target = { rootKey, path: [...node.path], field: field as BlueprintDateField };
      const rule = binding.rule;
      if (rule.kind === 'after_completion')
        return [
          {
            target,
            source: {
              kind: 'after_completion' as const,
              works: rule.stepKeys.map((part) => ({
                rootKey,
                path: [...node.path.slice(0, -1), part],
              })),
            },
            offset: rule.offset,
          },
        ];
      const sourcePath =
        rule.anchor.kind === 'parent'
          ? node.parentPath
          : [...node.path.slice(0, -1), rule.anchor.stepKey];
      const source = tree.nodes.find(
        (entry) => JSON.stringify(entry.path) === JSON.stringify(sourcePath),
      );
      if (!source || source.kind === 'program' || source.kind === 'initiative') return [];
      return [
        {
          target,
          source: {
            kind: 'work_date' as const,
            work: { rootKey, path: [...source.path] },
            field: source.kind === 'task' ? ('dueDate' as const) : ('targetDate' as const),
          },
          offset: rule.offset,
        },
      ];
    }),
  );
}
/** Include inherited public date edges in semantic validation without making containment a timing edge. */
export function plannedScheduleFieldGraph(
  roots: readonly { readonly key: string }[],
  trees: readonly PlannedWorkTree[],
  timing: WorkScheduleFieldTiming,
  absent: readonly WorkScheduleFieldTarget[],
): WorkScheduleFieldTiming {
  const privateFields = new Set([...timing.rules.map((rule) => rule.target), ...absent].map(key));
  return {
    ...timing,
    rules: [
      ...timing.rules,
      ...absent.map((target) => ({
        target,
        source: { kind: 'run' as const },
        offset: { days: 0, unit: 'calendar' as const },
      })),
      ...roots.flatMap((root, index) => {
        const tree = trees[index];
        return tree
          ? publicRules(root.key, tree).filter((rule) => !privateFields.has(key(rule.target)))
          : [];
      }),
    ],
  };
}
