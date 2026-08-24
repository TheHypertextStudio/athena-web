'use client';

/**
 * Let a detail page name its own tab.
 *
 * @remarks
 * The open-documents store resolves titles for itself, which is enough to name a tab when it
 * opens but not to keep it named. A document renamed from its own detail page left every open
 * tab still showing the old title, because the store had no way to hear about it — and a
 * document whose read the store could not complete stayed labelled by its kind even while the
 * page beside it displayed the real name.
 *
 * This is that channel: the page that is already showing a name reports it, and the tab follows.
 */
import { useEffect } from 'react';

import { useOptionalOpenDocuments } from './open-documents';
import { parseTabRef, type TabDocType } from './types';

/**
 * Keep this document's tab titled with the name the page is displaying.
 *
 * @param kind - The document kind, matching the tab route segment.
 * @param orgId - The workspace the document belongs to.
 * @param id - The document id.
 * @param title - The name currently on screen, or `null`/`undefined` while unknown.
 *
 * @example
 * ```ts
 * useRegisterTabTitle('project', orgId, projectId, project?.name);
 * ```
 */
export function useRegisterTabTitle(
  kind: TabDocType,
  orgId: string,
  id: string,
  title: string | null | undefined,
): void {
  // Optional: the store belongs to the app shell, and a page rendered outside it should still
  // render. Naming a tab that does not exist is simply nothing to do.
  const store = useOptionalOpenDocuments();
  const registerTitle = store?.registerTitle;
  useEffect(() => {
    if (!title || !registerTitle) return;
    registerTitle(parseTabRef(kind, orgId, id), title);
  }, [registerTitle, kind, orgId, id, title]);
}
