'use client';

/**
 * `useComposerInterruption` — close an open composer when the page under it changes, and leave a
 * pointer to its draft.
 *
 * @remarks
 * A global composer floats over whichever page launched it. When that page navigates away (a
 * link in the sidebar, a back button) the composer has no page to belong to and is closed; its
 * text is already saved as a draft by then, and the pointer written here is what lets the next
 * composer of the same kind in this tab reopen it. This is Linear's "navigate away keeps a
 * temporary draft", done with a server-side draft and a tab-local pointer.
 *
 * The composer reports the row it is writing to through the returned setter, which the provider
 * exposes as `setActiveDraftId`. A composer that had not saved yet leaves no pointer: its unmount
 * flushes any typed text as a draft, and that draft is reachable from the Drafts chip and page.
 */
import type { ComposerDraftKind } from '@docket/work/composer-draft-contract';
import { useCallback, useEffect, useRef } from 'react';

import { useAppPathname } from '@/lib/app-location';

import { writeInterruptedDraft } from './interrupted-draft';

/** The one fact about the open request this hook reads. */
export interface InterruptibleRequest {
  readonly kind: ComposerDraftKind;
}

/** Report the draft the open composer is writing to, or null once there is none. */
export type SetActiveDraftId = (draftId: string | null) => void;

/**
 * Close the open composer on a pathname change, pointing at its draft.
 *
 * @param request - The open create request, or null when none is open.
 * @param closeCreate - The provider's close.
 * @returns the setter the open composer reports its draft id through.
 */
export function useComposerInterruption(
  request: InterruptibleRequest | null,
  closeCreate: () => void,
): SetActiveDraftId {
  const pathname = useAppPathname();
  const draftIdRef = useRef<string | null>(null);
  const seenPathnameRef = useRef(pathname);
  // Read at navigation time rather than listed as dependencies: the effect must fire on the
  // pathname alone, never because a request opened or the close callback was rebuilt.
  const latestRef = useRef({ request, closeCreate });
  latestRef.current = { request, closeCreate };

  useEffect(() => {
    if (seenPathnameRef.current === pathname) return;
    seenPathnameRef.current = pathname;
    const { request: open, closeCreate: close } = latestRef.current;
    if (open === null) return;
    writeInterruptedDraft(open.kind, draftIdRef.current);
    close();
  }, [pathname]);

  // A closed request has no draft; the next composer reports its own once it has one.
  useEffect(() => {
    if (request === null) draftIdRef.current = null;
  }, [request]);

  return useCallback((draftId: string | null): void => {
    draftIdRef.current = draftId;
  }, []);
}
