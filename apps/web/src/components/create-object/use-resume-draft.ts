'use client';

/**
 * `useResumeDraft` — which draft, if any, a global composer reopens, decided once per open.
 *
 * @remarks
 * Three things can name a draft to reopen, in this order: the launcher (the Drafts page opens a
 * composer on a chosen draft), the pointer a navigation-interrupted composer left in this tab,
 * and the resume-drafts preference, which reopens the newest draft of that kind in the destination
 * workspace. The answer is frozen on mount: a draft the composer goes on to save must not become
 * "the newest draft" and be reopened over itself.
 *
 * When a resume is possible the host is not ready until the drafts list has settled, so the
 * composer mounts holding the draft rather than mounting empty and then jumping. When no resume
 * is possible the list is not waited for.
 */
import type { ComposerDraftKind, ComposerDraftListOut } from '@docket/work/composer-draft-contract';
import { useEffect, useState } from 'react';

import { useComposerDrafts, useResumeDraftsPreference } from '@/lib/drafts/defs';

import { readInterruptedDraft } from './interrupted-draft';

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
  const resumeDrafts = useResumeDraftsPreference();
  const drafts = useComposerDrafts();
  // Both decided on mount. The pointer is read as it stands when the composer opens; so is the
  // preference, which resolves to off until it has loaded.
  const [explicit] = useState(() => requestDraftId ?? readInterruptedDraft(kind));
  const [wantsNewest] = useState(() => explicit === null && resumeDrafts);
  const settled = drafts.isSuccess || drafts.isError;
  const [newest, setNewest] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!wantsNewest || newest !== undefined || !settled || orgId === null) return;
    setNewest(newestDraftId(drafts.data, kind, orgId));
  }, [drafts.data, kind, newest, orgId, settled, wantsNewest]);

  if (explicit !== null) return { draftId: explicit, ready: ready && settled };
  if (wantsNewest) return { draftId: newest ?? null, ready: ready && newest !== undefined };
  return { draftId: null, ready };
}
