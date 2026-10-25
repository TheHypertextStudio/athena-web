import { MilestoneId, ProjectId, TaskId } from '@docket/work/ids';
import type { PrivateScheduleRootPlacement } from '@docket/work/work-schedule-forest-v2';
import { CapabilityError, ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type { OrdinaryWorkCommand, WorkCreationBatchCommand } from '../work-creation/types';
import type { PreparedBlueprintCreation } from '../work-template-blueprints/preflight';
import { requireScheduleRootBinding } from './schedule-authority';
import type { ScheduleDocument } from './schedule-compiler';
import type { RetainedRootPlacement } from './work-template-placement';

/** Opaque nonexecuting preview context; accepted native execution uses its persisted root capability instead. */
export interface SchedulePlacementPreview {
  readonly proof: object;
}
interface Preview {
  readonly tx: TemplateTransaction;
  readonly organizationId: string;
  readonly actorId: string | null;
  readonly placement: string;
}
const previews = new WeakMap<SchedulePlacementPreview, Preview>();
/** Bind only preflight-local placement descriptions; neither the token nor its JSON registers a claim. */
export function prepareSchedulePlacementPreview(
  tx: TemplateTransaction,
  command: WorkCreationBatchCommand,
  document: ScheduleDocument,
): WorkCreationBatchCommand {
  if (document.kind !== 'forest' || document.revision !== 2 || !document.placements?.length)
    return command;
  return {
    ...command,
    roots: command.roots.map((root) => {
      const placement = document.placements?.find((entry) => entry.rootKey === root.key);
      if (!placement) return root;
      const context = root.command.invocation.scheduleContext;
      if (!context || JSON.stringify(context.rootPlacement) !== JSON.stringify(placement))
        throw new CapabilityError();
      const preview = Object.freeze({ proof: {} });
      previews.set(preview, {
        tx,
        organizationId: root.command.caller.orgId,
        actorId: root.command.caller.actorId,
        placement: JSON.stringify(placement),
      });
      return {
        ...root,
        command: {
          ...root.command,
          invocation: {
            ...root.command.invocation,
            scheduleContext: { ...context, placementPreview: preview },
          },
        },
      };
    }),
  };
}
function requirePlacement(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  placement: PrivateScheduleRootPlacement,
): void {
  if (command.invocation.scheduleBinding) {
    requireScheduleRootBinding(tx, command);
    return;
  }
  const preview = command.invocation.scheduleContext?.placementPreview,
    checked = preview ? previews.get(preview) : undefined;
  if (
    checked?.tx !== tx ||
    checked.organizationId !== command.caller.orgId ||
    checked.actorId !== command.caller.actorId ||
    checked.placement !== JSON.stringify(placement)
  )
    throw new CapabilityError();
}
/**
 * Resolve exact earlier checked prospective parent paths; descriptions never supply physical IDs or hidden work access.
 * @throws For copied/cross-transaction capability, unknown selected path or mismatched actual parent kind.
 */
export function resolveScheduleRootPlacement(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  prepared: ReadonlyMap<string, PreparedBlueprintCreation>,
): RetainedRootPlacement {
  const placement = command.invocation.scheduleContext?.rootPlacement;
  if (!placement) return {};
  requirePlacement(tx, command, placement);
  if (command.kind !== 'task')
    throw new ConflictError('Private parent placement requires a Task root.');
  const result: { projectId?: ProjectId; milestoneId?: MilestoneId; parentTaskId?: TaskId } = {};
  for (const [field, kind] of [
    ['project', 'project'],
    ['milestone', 'milestone'],
    ['parentTask', 'task'],
  ] as const) {
    const reference = placement[field];
    if (!reference) continue;
    const parent = prepared
      .get(reference.rootKey)
      ?.entries.find(
        (entry) => JSON.stringify(entry.allocated.node.path) === JSON.stringify(reference.path),
      );
    if (parent?.allocated.node.kind !== kind)
      throw new ConflictError('The private selected parent path changed.');
    const id = parent.allocated.id;
    if (field === 'project') result.projectId = ProjectId.parse(id);
    else if (field === 'milestone') result.milestoneId = MilestoneId.parse(id);
    else result.parentTaskId = TaskId.parse(id);
  }
  return result;
}
