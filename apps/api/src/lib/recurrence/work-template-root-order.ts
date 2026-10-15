import type {
  BlueprintInvocationRoot,
  BlueprintInvocationStep,
  BlueprintInvocationOverride,
} from '@docket/db';
import { ConflictError } from '../../error';
/** Order split private roots by original structural parents, without matching work by names. */
export function orderRetainedRoots(
  roots: readonly BlueprintInvocationRoot[],
  steps: readonly BlueprintInvocationStep[],
  presets: readonly BlueprintInvocationOverride[],
): readonly BlueprintInvocationRoot[] {
  const byKey = new Map(roots.map((root) => [root.key, root]));
  const sources = new Map(steps.map((step) => [step.sourceStepId, step]));
  const ordered: BlueprintInvocationRoot[] = [];
  const visiting = new Set<string>();
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    if (visiting.has(key)) throw new ConflictError('Process hierarchy changed');
    const root = byKey.get(key);
    if (!root) throw new ConflictError('Process root is missing');
    visiting.add(key);
    const fields = presets.find((preset) => preset.sourceStepId === root.sourceStepId)?.fields;
    for (const field of ['project_step_id', 'milestone_step_id', 'parent_task_step_id']) {
      const id = fields?.[field];
      const parent = typeof id === 'string' ? sources.get(id) : undefined;
      if (parent && parent.rootKey !== key) visit(parent.rootKey);
    }
    visiting.delete(key);
    seen.add(key);
    ordered.push(root);
  };
  for (const root of roots) visit(root.key);
  return ordered;
}
