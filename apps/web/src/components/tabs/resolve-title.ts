/**
 * Open-documents store — title resolution.
 *
 * @remarks
 * A tab opened from a route or an in-page link knows only the document's {@link TabRef}, not
 * its human title. {@link resolveTabTitle} fetches the title from the typed RPC surface per
 * document kind (task → `…/tasks/:id`, project → the projects list, …), returning a stable
 * fallback when the document cannot be read so a tab always has a usable label.
 */
import { api } from '@/lib/api';

import type { TabRef } from './types';

/** A short, stable placeholder title when the document cannot be resolved. */
export function fallbackTitle(ref: TabRef): string {
  const label = ref.type.charAt(0).toUpperCase() + ref.type.slice(1);
  return `${label} ${ref.id.slice(0, 6)}`;
}

/**
 * Resolve the human display title for an open-document ref.
 *
 * @param ref - The document to resolve.
 * @returns the document's title, or a short stable fallback when it cannot be read.
 *
 * @remarks
 * Reads run against the same-origin RPC client (the session cookie rides along). Any
 * non-OK response or thrown error resolves to {@link fallbackTitle}, never rejecting, so a
 * failed resolve degrades to a labeled tab rather than breaking the bar.
 */
export async function resolveTabTitle(ref: TabRef): Promise<string> {
  const { orgId, id } = ref;
  try {
    switch (ref.type) {
      case 'task': {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].$get({ param: { orgId, id } });
        if (res.ok) return (await res.json()).title;
        break;
      }
      case 'project': {
        const res = await api.v1.orgs[':orgId'].projects.$get({ param: { orgId } });
        if (res.ok) {
          const { items } = await res.json();
          const found = items.find((p) => p.id === id);
          if (found) return found.name;
        }
        break;
      }
      case 'initiative': {
        const res = await api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId } });
        if (res.ok) {
          const { items } = await res.json();
          const found = items.find((i) => i.id === id);
          if (found) return found.name;
        }
        break;
      }
      case 'program': {
        const res = await api.v1.orgs[':orgId'].programs.$get({ param: { orgId } });
        if (res.ok) {
          const { items } = await res.json();
          const found = items.find((p) => p.id === id);
          if (found) return found.name;
        }
        break;
      }
      case 'cycle': {
        const res = await api.v1.orgs[':orgId'].cycles.$get({ param: { orgId } });
        if (res.ok) {
          const { items } = await res.json();
          const found = items.find((c) => c.id === id);
          if (found) return found.name ?? `Cycle ${String(found.number)}`;
        }
        break;
      }
      case 'session': {
        const res = await api.v1.orgs[':orgId'].sessions[':id'].$get({ param: { orgId, id } });
        if (res.ok) {
          const detail = await res.json();
          if (detail.taskId) {
            const taskRes = await api.v1.orgs[':orgId'].tasks[':id'].$get({
              param: { orgId, id: detail.taskId },
            });
            if (taskRes.ok) return `${(await taskRes.json()).title} · session`;
          }
        }
        break;
      }
    }
  } catch {
    // Non-fatal: fall through to the stable fallback below.
  }
  return fallbackTitle(ref);
}
