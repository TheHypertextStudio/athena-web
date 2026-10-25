/** Native drill-through is distinct from the opaque identity used to group task history. */
import type { Context } from 'hono';
import type { ChangeOrigin } from '@docket/db';
import type { AppEnv } from '../context';
import type { ActivityEntry, ActivitySources } from './task-activity-entries';
import { taskActivityReferences } from './task-activity-icons';
import { sessionDetailDestinations } from './agent-session-helpers';

/**
 * Attach real, authorized native destinations without interpreting external work keys as URLs.
 * @param entries - The authorized filtered activity page, in its existing order.
 * @param sources - Persisted provenance owning the native session references.
 * @param c - Authenticated caller for full-session visibility checks.
 * @param created - Task creation provenance.
 * @returns Entries with optional native detail links and unchanged grouping identities.
 */
export async function withTaskActivitySessionLinks(
  entries: ActivityEntry[],
  sources: ActivitySources,
  c: Context<AppEnv>,
  created: { readonly taskId: string; readonly origin: ChangeOrigin | null },
): Promise<ActivityEntry[]> {
  const refs = taskActivityReferences(sources, created.taskId, created.origin);
  const ids = [
    ...new Set(
      entries.flatMap((entry) => {
        const id = entry.session?.kind === 'native' ? refs.get(entry.id)?.sessionId : null;
        return id ? [id] : [];
      }),
    ),
  ];
  const links = await sessionDetailDestinations(c, ids);
  return entries.map((entry) => {
    const id = refs.get(entry.id)?.sessionId;
    const url = id ? links.get(id) : null;
    return entry.session && url
      ? { ...entry, session: { ...entry.session, detailUrl: url } }
      : entry;
  });
}
