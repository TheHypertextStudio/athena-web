/** Chronological contributions retain session identity without moving interleaved discussion. */
import type { TaskActivityOut, TaskActivitySession } from '@docket/connections/activity-contract';
import { activityContributorKey } from './activity-contributor';

/** One contiguous contribution; another actor's entry always starts a new contribution. */
export interface ActivitySessionGroup {
  readonly key: string;
  readonly session: TaskActivitySession | null;
  readonly entries: TaskActivityOut[];
  readonly continued: boolean;
}

/** Extend only one performer's adjacent contribution; a session itself is never its author. */
function canExtend(previous: ActivitySessionGroup, entry: TaskActivityOut): boolean {
  const first = previous.entries[0];
  return Boolean(
    first &&
    entry.session &&
    previous.session?.id === entry.session.id &&
    activityContributorKey(first) === activityContributorKey(entry),
  );
}

/** Group loaded pages together; continuation and counts describe only the loaded filtered history. */
export function activitySessionGroups(entries: readonly TaskActivityOut[]): ActivitySessionGroup[] {
  const groups: ActivitySessionGroup[] = [];
  const seenEntries = new Set<string>();
  const seenSessions = new Set<string>();
  for (const entry of entries) {
    if (seenEntries.has(entry.id)) continue;
    seenEntries.add(entry.id);
    const session = entry.session ?? null;
    const previous = groups.at(-1);
    if (previous && canExtend(previous, entry)) {
      previous.entries.push(entry);
      continue;
    }
    groups.push({
      key: entry.id,
      session,
      entries: [entry],
      continued: session ? seenSessions.has(session.id) : false,
    });
    if (session) seenSessions.add(session.id);
  }
  return groups;
}
