import { ProjectId, MilestoneId, TaskId } from '@docket/work/ids';
import { CapabilityError, ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { retainedRootBinding } from '../work-creation/retained-authority';
import type { OrdinaryWorkCommand } from '../work-creation/types';
import { retainedBlueprintSources } from '../work-template-blueprints/retained-paths';
import type { PreparedBlueprintCreation } from '../work-template-blueprints/preflight';
/** Concrete original structural placement resolved only from checked mappings or earlier authorized prepared roots. */
export interface RetainedRootPlacement {
  readonly projectId?: ProjectId;
  readonly milestoneId?: MilestoneId;
  readonly parentTaskId?: TaskId;
}
/** Resolve split-root relationships by immutable source identity; unresolved or mismatched parents refuse before insertion. */
export async function resolveRetainedRootPlacement(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  preparedRoots: ReadonlyMap<string, PreparedBlueprintCreation>,
): Promise<RetainedRootPlacement> {
  const bound = retainedRootBinding(tx, command);
  if (!bound) return {};
  const preset = bound.occurrence.overrides.find(
    (preset) => preset.sourceStepId === bound.root.sourceStepId,
  );
  if (!preset) throw new CapabilityError();
  const sources = await retainedBlueprintSources(tx, bound.authority);
  const result: { projectId?: ProjectId; milestoneId?: MilestoneId; parentTaskId?: TaskId } = {};
  for (const [stored, kind, key] of [
    ['project_step_id', 'project', 'projectId'],
    ['milestone_step_id', 'milestone', 'milestoneId'],
    ['parent_task_step_id', 'task', 'parentTaskId'],
  ] as const) {
    const sourceId = preset.fields[stored];
    if (typeof sourceId !== 'string') continue;
    const source = sources.find((source) => source.sourceStepId === sourceId);
    if (!source) throw new ConflictError('Retained parent mapping changed');
    const mapped = bound.occurrence.mappedWork.get(sourceId);
    const planned = preparedRoots
      .get(source.rootKey)
      ?.entries.find(
        (entry) => JSON.stringify(entry.allocated.node.path) === JSON.stringify(source.path),
      );
    const actual =
      mapped ??
      (planned ? { kind: planned.allocated.node.kind, id: planned.allocated.id } : undefined);
    if (actual?.kind !== kind) throw new ConflictError('Retained parent mapping is missing');
    assignPlacement(result, key, actual.id);
  }
  return result;
}

function assignPlacement(
  result: { projectId?: ProjectId; milestoneId?: MilestoneId; parentTaskId?: TaskId },
  key: keyof RetainedRootPlacement,
  id: string,
): void {
  if (key === 'projectId') result.projectId = ProjectId.parse(id);
  else if (key === 'milestoneId') result.milestoneId = MilestoneId.parse(id);
  else result.parentTaskId = TaskId.parse(id);
}
