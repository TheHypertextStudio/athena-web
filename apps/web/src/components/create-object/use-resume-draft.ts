'use client';

/**
 * `useResumeDraft` — which draft, if any, a global composer reopens, decided once per open.
 *
 * @remarks
 * Three things can name a draft to reopen, in this order: the launcher (the Drafts page opens a
 * composer on a chosen draft), the pointer a navigation-interrupted composer left in this tab,
 * and the resume-drafts preference, which reopens the newest draft of that kind in the destination
 * workspace. The answer is decided once and held: a draft the composer goes on to save must not
 * become "the newest draft" and be reopened over itself.
 *
 * The preference is waited for rather than read as "off" while it loads, so someone who turned
 * resuming on gets their draft every time and not only when the preference happened to be cached.
 * Once it is known, a resume waits for the drafts list too, so the composer mounts holding the
 * draft rather than mounting empty and then jumping; with no resume the list is not waited for.
 */
import type { ComposerDraftKind, ComposerDraftListOut } from '@docket/work/composer-draft-contract';
import { useEffect, useState } from 'react';

import { useComposerDrafts, useResumeDraftsPreferenceState } from '@/lib/drafts/defs';

import { readInterruptedDraft } from './interrupted-draft';

/** How long a composer waits for the resume preference before opening as if it were off. */
export const PREFERENCE_WAIT_MS = 1_500;

/** What the host passes on to the composer. */
export interface ResumeDraft {
  /** The draft to reopen, or null to open empty. */
  readonly draftId: string | null;
  /** The host's readiness, now also waiting for the drafts list when a resume is possible. */
  readonly ready: boolean;
}

/** The newest draft of this kind in this workspace; the list is newest first. */
function newestDraftId(
  list: ComposerDraftListOut | undefined,
  kind: ComposerDraftKind,
  orgId: string,
): string | null {
  const item = list?.items.find((draft) => draft.kind === kind && draft.organizationId === orgId);
  return item?.id ?? null;
}

/**
 * Decide which draft a composer reopens.
 *
 * @param kind - The composer being opened.
 * @param requestDraftId - The draft the launcher asked for, if any.
 * @param orgId - The destination workspace, or null until the host has resolved it.
 * @param ready - Whether the destination workspace and its creation data have resolved.
 * @returns the draft id and the gated readiness.
 */
export function useResumeDraft(
  kind: ComposerDraftKind,
  requestDraftId: string | null | undefined,
  orgId: string | null,
  ready: boolean,
): ResumeDraft {
  const preference = useResumeDraftsPreferenceState();
  const drafts = useComposerDrafts();
  // The launcher's choice and the interrupted pointer are read as they stand when the composer
  // opens. The preference is decided the first time it is known, and then held: waiting for it
  // beats reading "off" from a preference that simply had not arrived.
  const [explicit] = useState(() => requestDraftId ?? readInterruptedDraft(kind));
  const [wantsNewest, setWantsNewest] = useState<boolean | undefined>(
    explicit === null ? undefined : false,
  );
  const settled = drafts.isSuccess || drafts.isError;
  const [newest, setNewest] = useState<string | null | undefined>(undefined);
  const [gaveUp, setGaveUp] = useState(false);

  // Creating something must never hang on a preference: a read that keeps failing is retried for
  // longer than anyone will wait, so after a beat the composer opens as if resuming were off.
  useEffect(() => {
    if (wantsNewest !== undefined) return;
    const timer = setTimeout(() => {
      setGaveUp(true);
    }, PREFERENCE_WAIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [wantsNewest]);

  useEffect(() => {
    if (wantsNewest !== undefined || !(preference.settled || gaveUp)) return;
    setWantsNewest(preference.enabled);
  }, [gaveUp, preference.enabled, preference.settled, wantsNewest]);

  useEffect(() => {
    if (!wantsNewest || newest !== undefined || !settled || orgId === null) return;
    setNewest(newestDraftId(drafts.data, kind, orgId));
  }, [drafts.data, kind, newest, orgId, settled, wantsNewest]);

  if (explicit !== null) return { draftId: explicit, ready: ready && settled };
  if (wantsNewest === undefined) return { draftId: null, ready: false };
  if (wantsNewest) return { draftId: newest ?? null, ready: ready && newest !== undefined };
  return { draftId: null, ready };
}
