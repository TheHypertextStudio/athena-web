/** Deterministic field consolidation within one already-correlated chronological contribution. */
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import { activityContributorKey } from './activity-contributor';

/** One visible value transition and every recorded edit that established it. */
export interface ConsolidatedTaskChange {
  readonly entry: TaskActivityOut;
  readonly history: readonly TaskActivityOut[];
}

const SCALAR_FIELDS = new Set([
  'description',
  'title',
  'state',
  'priority',
  'assigneeId',
  'dueDate',
  'startDate',
  'estimateMinutes',
  'projectId',
  'teamId',
]);

/**
 * Consolidate scalar edits by subject and field without conflating distinct relationship writes.
 * @param entries - Ordered, loaded changes from a single contribution, never across human replies.
 * @returns Visible value transitions with lossless individual edit history.
 */
export function consolidateTaskChanges(
  entries: readonly TaskActivityOut[],
): ConsolidatedTaskChange[] {
  const changes = new Map<string, { entry: TaskActivityOut; history: TaskActivityOut[] }>();
  for (const entry of entries) {
    if (!entry.change) continue;
    const key = SCALAR_FIELDS.has(entry.change.field)
      ? JSON.stringify([
          entry.subjectTaskId ?? entry.taskId,
          entry.change.field,
          activityContributorKey(entry),
          entry.actorId,
        ])
      : entry.id;
    const previous = changes.get(key);
    if (!previous) {
      changes.set(key, { entry, history: [entry] });
      continue;
    }
    previous.history.push(entry);
    previous.entry = {
      ...entry,
      change: { ...entry.change, from: previous.entry.change?.from ?? null },
    };
    // Keep the consolidated transition at its latest source position so recent work stays visible.
    changes.delete(key);
    changes.set(key, previous);
  }
  return [...changes.values()];
}
