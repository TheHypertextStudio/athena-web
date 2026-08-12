/**
 * Open-documents store — title resolution.
 *
 * @remarks
 * A tab opened from a route or an in-page link knows only the document's {@link TabRef}, not its
 * human title. {@link resolveTabTitle} reads that title from the typed RPC surface, one document
 * at a time.
 *
 * Two things it deliberately does not do. It does not fetch a whole org list to find one row —
 * every kind here has a by-id endpoint, and scanning the list meant a tab could stay unnamed
 * simply because its document sat past the end of a page. And it never invents a name from the
 * id: an unreadable document resolves to `null`, which the bar renders as the kind of thing it
 * is. See {@link titleFromCache} for the case where no request is needed at all.
 */
import type { QueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { initiativeRecordDef, programRecordDef, projectRecordDef } from '@/lib/entity-records';
import { taskDetailDef } from '@/lib/use-task-detail';

import type { TabRef } from './types';

/** A named thing, as far as a tab title is concerned. */
interface Named {
  readonly name?: unknown;
  readonly title?: unknown;
  readonly displayName?: unknown;
}

/** Pull whichever field this kind of document calls its name. */
function nameOf(value: Named | undefined): string | null {
  for (const candidate of [value?.title, value?.name, value?.displayName]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return null;
}

/**
 * Read a tab's title straight from the query cache, without a request.
 *
 * @param queryClient - The active client.
 * @param ref - The document the tab points at.
 * @returns The cached title, or `null` when nothing relevant is cached.
 *
 * @remarks
 * Usually there is nothing to fetch. Arriving at a document from a list, from search, or from the
 * composer that just created it means its record is already in the cache the detail page reads —
 * so the tab can be named in the same tick it appears, rather than after a round trip during
 * which it had to show something else.
 */
export function titleFromCache(queryClient: QueryClient, ref: TabRef): string | null {
  const { orgId, id } = ref;
  switch (ref.type) {
    case 'task':
      return nameOf(queryClient.getQueryData(taskDetailDef(orgId, id).queryKey));
    case 'project':
      return nameOf(queryClient.getQueryData(projectRecordDef(orgId, id).queryKey));
    case 'program':
      return nameOf(queryClient.getQueryData(programRecordDef(orgId, id).queryKey));
    case 'initiative':
      return nameOf(queryClient.getQueryData(initiativeRecordDef(orgId, id).queryKey));
    default:
      return null;
  }
}

/**
 * Resolve the human display title for an open-document ref.
 *
 * @param ref - The document to resolve.
 * @returns The document's title, or `null` when it cannot be read.
 *
 * @remarks
 * Reads run against the same-origin RPC client (the session cookie rides along). Any non-OK
 * response or thrown error resolves to `null` rather than rejecting, so a failed resolve leaves a
 * tab labelled by its kind instead of breaking the bar.
 */
export async function resolveTabTitle(ref: TabRef): Promise<string | null> {
  const { orgId, id } = ref;
  try {
    switch (ref.type) {
      case 'task': {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].$get({ param: { orgId, id } });
        if (res.ok) return (await res.json()).title;
        break;
      }
      case 'project': {
        const res = await api.v1.orgs[':orgId'].projects[':id'].$get({ param: { orgId, id } });
        if (res.ok) return (await res.json()).name;
        break;
      }
      case 'initiative': {
        const res = await api.v1.orgs[':orgId'].initiatives[':id'].$get({ param: { orgId, id } });
        if (res.ok) return (await res.json()).name;
        break;
      }
      case 'program': {
        const res = await api.v1.orgs[':orgId'].programs[':id'].$get({ param: { orgId, id } });
        if (res.ok) return (await res.json()).name;
        break;
      }
      case 'cycle': {
        const res = await api.v1.orgs[':orgId'].cycles[':id'].$get({ param: { orgId, id } });
        // `displayName` is the author's name when set, else the cycle's window — never the
        // stored `number`, which is the auto-roll idempotency key and read as "Cycle 1000137".
        if (res.ok) return (await res.json()).displayName;
        break;
      }
      case 'session': {
        const res = await api.v1.orgs[':orgId'].sessions[':id'].$get({ param: { orgId, id } });
        if (!res.ok) break;
        const detail = await res.json();
        // A session's name is the work it is doing; it carries no name of its own. Attached to a
        // task, that task names it. Otherwise there is genuinely nothing to call it, and the
        // right answer is to say so — the bar then reads "Session", which is true, rather than a
        // slice of its id, which was the previous behavior and told the reader nothing.
        if (!detail.taskId) break;
        const taskRes = await api.v1.orgs[':orgId'].tasks[':id'].$get({
          param: { orgId, id: detail.taskId },
        });
        if (taskRes.ok) return `${(await taskRes.json()).title} · session`;
        break;
      }
    }
  } catch {
    // Non-fatal: an unreadable document is one the bar labels by kind, not one it names wrongly.
  }
  return null;
}
