/** Display boundaries for contributors inside a correlated work session. */
import type { TaskActivityOut } from '@docket/connections/activity-contract';

/**
 * Identify a displayed performer without mistaking an agent's authorizing person for its author.
 * @param entry - A server-correlated activity record with its own authorship and provenance.
 * @returns A display grouping key; server correlation remains responsible for authority isolation.
 */
export function activityContributorKey(entry: TaskActivityOut): string {
  const origin = entry.origin;
  if (origin && origin.performerKind !== 'person') {
    return JSON.stringify([origin.performerKind, origin.performerName ?? origin.clientName]);
  }
  return JSON.stringify(['person', entry.actorId, entry.actorName]);
}
