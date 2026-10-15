import type { BlueprintDifference } from '@docket/work/blueprints';
import { BlueprintError, assertBlueprintDateWindow } from '@docket/work/blueprints';
import type { RecordedChange } from '../../mcp/change-set';
import type { TemplateTransaction } from '../templates/persistence';
import { requireWorkAccess } from '../work-template-selection';
import { loadStatusSets, resolveTaskStatus } from '../work-status';
import { taskUpdateChange } from '../provenance/task-change-sets';
import {
  writeTaskStateTransition,
  closeCompletingUserTaskTimers,
  emitCompletedTaskTimerStops,
  finishTaskStateTransition,
} from '../task-state';
import type { DeferredWorkEffect } from '../work-creation/types';
import type { PreparedSelectiveReview } from './selective-review';
import type { BlueprintStoredWork } from './snapshot-types';
import { writeBlueprintDerivedDate } from './reflow-write';

/** Existing-row changes, projections and state effects kept inside the single assignment action. */
export interface SelectiveExistingWrites {
  readonly changes: RecordedChange[];
  readonly effects: DeferredWorkEffect[];
  readonly parentTaskIds: (string | null)[];
  readonly afterCommit: (() => Promise<void>)[];
}
function workFor(review: PreparedSelectiveReview, id: string): BlueprintStoredWork {
  const work = [...review.snapshot.rowsByRef.values()].find((entry) => entry.id === id);
  if (!work) throw new BlueprintError('blueprint_invalid', 'Reviewed work changed.');
  return work;
}
/** Recheck all selected row rights before any identity, date, state or child insert. */
export async function authorizeSelectiveWrites(
  tx: TemplateTransaction,
  review: PreparedSelectiveReview,
  accepted: ReadonlySet<string>,
): Promise<void> {
  const dates = new Map(
    review.current.map((node) => [node.id, { kind: node.kind, dates: { ...node.dates } }]),
  );
  const changedDates = new Set<string>();
  for (const change of review.differences) {
    if (!accepted.has(change.changeId) || !('id' in change)) continue;
    const work = workFor(review, change.id);
    if (change.kind === 'set_derived_date') {
      const current = dates.get(change.id);
      if (current) {
        current.dates[change.field] = change.value;
        changedDates.add(change.id);
      }
    }
    await requireWorkAccess(
      tx,
      review.caller,
      work.kind === 'milestone' ? 'project' : work.kind,
      work.kind === 'milestone' ? work.row.projectId : work.id,
    );
  }
  for (const id of changedDates) {
    const current = dates.get(id);
    if (current) assertBlueprintDateWindow(current.kind, current.dates);
  }
}
async function cancelTask(
  tx: TemplateTransaction,
  review: PreparedSelectiveReview,
  work: BlueprintStoredWork,
  result: SelectiveExistingWrites,
): Promise<void> {
  if (work.kind !== 'task')
    throw new BlueprintError(
      'blueprint_invalid',
      'Only reviewed cancellable work can be canceled.',
    );
  const sets = await loadStatusSets(
    review.caller.orgId,
    { teamIds: [work.row.teamId], entityTypes: ['task'] },
    tx,
  );
  const status = sets.for('task', work.row.teamId).find((entry) => entry.category === 'canceled');
  if (!status)
    throw new BlueprintError('blueprint_invalid', 'No cancellation status is available.');
  const transition = await resolveTaskStatus(
    review.caller.orgId,
    work.row.teamId,
    status.key,
    'state',
    tx,
  );
  const mutation = await writeTaskStateTransition(tx, { before: work.row, ...transition });
  if (!mutation) throw new BlueprintError('blueprint_invalid', 'Reviewed work changed.');
  const change = taskUpdateChange(mutation);
  if (change) result.changes.push(change);
  result.parentTaskIds.push(work.row.parentTaskId);
  const stops = await closeCompletingUserTaskTimers(tx, review.caller.actorId, mutation);
  result.afterCommit.push(async () => {
    await finishTaskStateTransition({ actorId: review.caller.actorId }, mutation);
    await emitCompletedTaskTimerStops(stops);
  });
}
/** Write only individually accepted derived bindings or safe cancellation through existing mutation helpers. */
export async function writeSelectiveExisting(
  tx: TemplateTransaction,
  review: PreparedSelectiveReview,
  choices: readonly BlueprintDifference[],
): Promise<SelectiveExistingWrites> {
  const result: SelectiveExistingWrites = {
    changes: [],
    effects: [],
    parentTaskIds: [],
    afterCommit: [],
  };
  const current = new Map([...review.snapshot.rowsByRef.values()].map((work) => [work.id, work]));
  for (const choice of choices) {
    if (!('id' in choice)) continue;
    const work = current.get(choice.id);
    if (!work) throw new BlueprintError('blueprint_invalid', 'Reviewed work changed.');
    if (choice.kind === 'cancel_removed_child') {
      await cancelTask(tx, review, work, result);
      continue;
    }
    const mutation = await writeBlueprintDerivedDate(tx, {
      organizationId: review.caller.orgId,
      work,
      dates: { [choice.field]: choice.value },
      bindings: { ...work.row.blueprintDateBindings, [choice.field]: choice.binding },
    });
    result.changes.push(...mutation.changes);
    for (const after of mutation.rows) {
      current.set(after.id, after);
      result.effects.push({
        kind: 'search',
        dedupeKey: `search:${after.kind}:${after.id}`,
        work: after,
      });
    }
  }
  return result;
}
