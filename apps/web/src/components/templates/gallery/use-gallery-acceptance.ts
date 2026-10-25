'use client';
import { useRef, useState } from 'react';
import {
  WorkTemplateCopyReceipt,
  type WorkTemplateGalleryAcceptRequest,
  type WorkTemplateGalleryPreviewRequest,
  type WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';
import { useGalleryOriginalOutcome } from './use-gallery-original-outcome';
import { UserFacingError, userErrorMessage } from '@/lib/problem';
import {
  galleryAttempt,
  galleryScopeOwner,
  type AcceptedCopyIdentity,
  markGalleryAttemptStale,
  clearGalleryAttempt,
  retainGalleryOriginal,
  clearGalleryOriginal,
  type GalleryAttempt,
  type GalleryAttemptScope,
} from './gallery-acceptance-attempt';

/** Actual canonical acceptance transport; only its validated persisted receipt can signal success. */
export type GalleryAccept<Accepted = WorkTemplateGalleryAcceptRequest> = (
  request: Accepted,
) => Promise<WorkTemplateCopyReceipt>;
/** Actual original-request lookup, scoped by the authenticated route's workspace. */
export interface GalleryAcceptanceOptions {
  readonly scope: GalleryAttemptScope;
  readonly lookupReceipt: (requestId: string) => Promise<WorkTemplateCopyReceipt | null>;
}
/** Retry state for exact reviewed choices; tab memory is never a saved draft or execution authority. */
export interface GalleryAcceptance<
  Request = WorkTemplateGalleryPreviewRequest,
  Preview = WorkTemplateGalleryPreview,
> {
  readonly pending: boolean;
  readonly ready: boolean;
  readonly resume: () => Promise<WorkTemplateCopyReceipt | null>;
  readonly checkingOutcome: boolean;
  readonly error: string | null;
  readonly needsReview: boolean;
  readonly receipt: WorkTemplateCopyReceipt | null;
  readonly accept: (request: Request, preview: Preview) => Promise<void>;
  readonly reset: () => void;
}
async function originalReceipt(
  attempt: GalleryAttempt<AcceptedCopyIdentity>,
  options: GalleryAcceptanceOptions,
): Promise<WorkTemplateCopyReceipt | null> {
  const receipt = await options.lookupReceipt(attempt.request.requestId);
  return receipt === null ? null : WorkTemplateCopyReceipt.parse(receipt);
}
function unknownOutcome(failure: unknown): boolean {
  return (
    !(failure instanceof UserFacingError) || failure.status === undefined || failure.status >= 500
  );
}
/** Reconcile a restored attempt before retrying; a lost response never allocates a replacement identity. */
async function submitAttempt<Accepted extends AcceptedCopyIdentity>(
  attempt: GalleryAttempt<Accepted>,
  onAccept: GalleryAccept<Accepted>,
  options: GalleryAcceptanceOptions,
  onChecking: () => void,
): Promise<WorkTemplateCopyReceipt> {
  try {
    return WorkTemplateCopyReceipt.parse(await onAccept(attempt.request));
  } catch (failure) {
    if (unknownOutcome(failure)) {
      onChecking();
      try {
        const existing = await originalReceipt(attempt, options);
        if (existing) return existing;
      } catch {
        // Keep the original attempt for retry when neither transport can establish its outcome.
      }
    }
    throw failure;
  }
}
interface AttemptState {
  readonly owner: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly receipt: WorkTemplateCopyReceipt | null;
  readonly needsReview: boolean;
  readonly checkingOutcome: boolean;
}
function emptyAttempt(owner: string): AttemptState {
  return {
    owner,
    pending: false,
    error: null,
    receipt: null,
    needsReview: false,
    checkingOutcome: false,
  };
}
function acceptanceFailure(failure: unknown): Pick<AttemptState, 'needsReview' | 'error'> {
  const stale = failure instanceof UserFacingError && failure.status === 409;
  return {
    needsReview: stale,
    error: stale
      ? 'This review changed. Review the updated copies before continuing.'
      : userErrorMessage(failure, 'Could not save these templates. Your choices are still here.'),
  };
}
/** Preserve catalog compatibility through the same canonical union-source acceptance lifecycle. */
export function useGalleryAcceptance(
  onAccept: GalleryAccept,
  options: GalleryAcceptanceOptions,
): GalleryAcceptance {
  return useTemplateCopyAcceptance(onAccept, options, galleryAttempt);
}
/** Reconcile and accept exact checked choices for every canonical source through one lifecycle. */
export function useTemplateCopyAcceptance<
  Request extends { readonly mode: 'private_drafts' | 'published' },
  Preview extends { readonly mode: 'private_drafts' | 'published' },
  Accepted extends AcceptedCopyIdentity,
>(
  onAccept: GalleryAccept<Accepted>,
  options: GalleryAcceptanceOptions,
  prepareAttempt: (
    scope: GalleryAttemptScope,
    request: Request,
    preview: Preview,
  ) => Promise<GalleryAttempt<Accepted>>,
): GalleryAcceptance<Request, Preview> {
  const original = useGalleryOriginalOutcome(options);
  const owner = galleryScopeOwner(options.scope);
  const [local, setLocal] = useState<AttemptState>(() => emptyAttempt(owner));
  const active = useRef(false),
    attempt = useRef<GalleryAttempt<Accepted> | null>(null);
  function update(patch: Partial<AttemptState>): void {
    setLocal((value) => ({ ...value, ...patch }));
  }
  async function accept(request: Request, preview: Preview): Promise<void> {
    if (active.current || original.receipt) return;
    if (request.mode !== preview.mode) {
      update({ error: 'Review the updated visibility before continuing.' });
      return;
    }
    active.current = true;
    update({ owner, receipt: null, pending: true, checkingOutcome: false, error: null });
    try {
      const existing = await original.resume();
      if (existing) {
        update({ receipt: existing });
        return;
      }
      attempt.current = await prepareAttempt(options.scope, request, preview);
      if (attempt.current.stale) {
        update({ needsReview: true });
        return;
      }
      update({ needsReview: false });
      retainGalleryOriginal(options.scope, attempt.current);
      const receipt = await submitAttempt(attempt.current, onAccept, options, () => {
        update({ checkingOutcome: true });
      });
      update({ receipt });
    } catch (failure) {
      const state = acceptanceFailure(failure);
      if (state.needsReview && attempt.current) markGalleryAttemptStale(attempt.current);
      update(state);
    } finally {
      active.current = false;
      update({ pending: false, checkingOutcome: false });
    }
  }
  function reset(): void {
    if (active.current) return;
    const known = Boolean(local.receipt ?? original.receipt) || local.needsReview;
    if (known && local.owner === owner) {
      if (attempt.current) clearGalleryAttempt(attempt.current);
      clearGalleryOriginal(options.scope, true);
      original.clear();
    }
    attempt.current = null;
    setLocal(emptyAttempt(owner));
  }
  const current = local.owner === owner;
  return {
    ready: original.ready,
    resume: original.resume,
    pending: (current && local.pending) || original.checking,
    checkingOutcome: (current && local.checkingOutcome) || original.checking,
    error: original.error ?? (current ? local.error : null),
    receipt: original.receipt ?? (current ? local.receipt : null),
    needsReview: current && local.needsReview,
    accept,
    reset,
  };
}
