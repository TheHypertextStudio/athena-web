import { z } from 'zod';
import { UserFacingError } from '@/lib/problem';
import { readStoredJson, writeStoredJson, clearStoredValue } from '@docket/ui/lib/browser-storage';
import { fingerprintCopyFacts } from '@docket/work/template-copy';
import {
  WorkTemplateGalleryAcceptRequest,
  WorkTemplateGalleryPreviewRequest,
  type WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';

/** Current authenticated account and workspace; tab memory grants no access to either. */
export interface GalleryAttemptScope {
  readonly userId: string;
  readonly orgId: string;
  readonly sessionId?: string;
  readonly attemptId?: string;
}
const storedAttempt = z.object({ requestId: z.uuid(), stale: z.boolean() });
/** The authority-free metadata every canonical copy acceptance carries. */
export interface AcceptedCopyIdentity {
  readonly requestId: string;
  readonly expectedReviewFingerprint: string;
  readonly mode: 'private_drafts' | 'published';
}
/** One exact reviewed attempt, retaining only an opaque digest and UUID in tab storage. */
export interface GalleryAttempt<
  Accepted extends AcceptedCopyIdentity = WorkTemplateGalleryAcceptRequest,
> {
  readonly storageKey: string;
  readonly restored: boolean;
  readonly stale: boolean;
  readonly request: Accepted;
}
/** Restore an exact attempt identity after reload without persisting canonical definition bodies. */
export async function galleryAttempt(
  scope: GalleryAttemptScope,
  input: WorkTemplateGalleryPreviewRequest,
  preview: WorkTemplateGalleryPreview,
): Promise<GalleryAttempt> {
  return templateCopyAttempt(
    scope,
    WorkTemplateGalleryPreviewRequest.parse(input),
    preview,
    (request, requestId, fingerprint) =>
      WorkTemplateGalleryAcceptRequest.parse({
        ...request,
        requestId,
        expectedReviewFingerprint: fingerprint,
      }),
  );
}
/** Exact account/session/flow owner; legacy catalog tabs keep their existing scope. */
export function galleryScopeOwner(scope: GalleryAttemptScope): string {
  return JSON.stringify(ownerParts(scope));
}
function ownerParts(scope: GalleryAttemptScope): readonly (string | null)[] {
  return scope.sessionId || scope.attemptId
    ? [scope.userId, scope.orgId, scope.sessionId ?? null, scope.attemptId ?? null]
    : [scope.userId, scope.orgId];
}
/** Retain one checked request identity for any canonical copy source without persisting definition bodies. */
export async function templateCopyAttempt<Request, Accepted extends AcceptedCopyIdentity>(
  scope: GalleryAttemptScope,
  request: Request,
  preview: { readonly reviewFingerprint: string },
  accept: (request: Request, requestId: string, fingerprint: string) => Accepted,
): Promise<GalleryAttempt<Accepted>> {
  const digest = await fingerprintCopyFacts([request, preview.reviewFingerprint]);
  const storageKey = `docket:gallery-copy-attempt:${JSON.stringify([...ownerParts(scope), digest])}`;
  const previous = storedAttempt.safeParse(readStoredJson(storageKey, 'session'));
  const value = previous.success ? previous.data : { requestId: crypto.randomUUID(), stale: false };
  writeStoredJson(storageKey, value, 'session');
  const retained = storedAttempt.safeParse(readStoredJson(storageKey, 'session'));
  if (!retained.success || retained.data.requestId !== value.requestId)
    throw new UserFacingError(
      'This tab could not remember the copy request. Allow site storage before trying again.',
    );
  return {
    storageKey,
    restored: previous.success,
    stale: value.stale,
    request: accept(request, value.requestId, preview.reviewFingerprint),
  };
}

/** A rejected review remains rejected after reload until the user obtains a new checked review. */
export function markGalleryAttemptStale(
  attempt: Pick<GalleryAttempt<AcceptedCopyIdentity>, 'storageKey' | 'request'>,
): void {
  writeStoredJson(
    attempt.storageKey,
    { requestId: attempt.request.requestId, stale: true },
    'session',
  );
}
/** Explicitly start another installation only after the previous attempt has a known outcome. */
export function clearGalleryAttempt(attempt: Pick<GalleryAttempt, 'storageKey'>): void {
  clearStoredValue(attempt.storageKey, 'session');
}

const originalPointer = z.object({ requestId: z.uuid(), attemptKey: z.string().min(1) });
function originalKey(scope: GalleryAttemptScope): string {
  return `docket:gallery-copy-original:${galleryScopeOwner(scope)}`;
}
/** Find the previous original request without recomputing or reading a canonical source definition. */
export function readGalleryOriginal(
  scope: GalleryAttemptScope,
): z.infer<typeof originalPointer> | null {
  const parsed = originalPointer.safeParse(readStoredJson(originalKey(scope), 'session'));
  return parsed.success ? parsed.data : null;
}
/** Remember only an opaque request pointer before a possible server write, checking storage actually retained it. */
export function retainGalleryOriginal(
  scope: GalleryAttemptScope,
  attempt: Pick<GalleryAttempt<AcceptedCopyIdentity>, 'storageKey' | 'request'>,
): void {
  writeStoredJson(
    originalKey(scope),
    { requestId: attempt.request.requestId, attemptKey: attempt.storageKey },
    'session',
  );
  if (readGalleryOriginal(scope)?.requestId !== attempt.request.requestId)
    throw new UserFacingError(
      'This tab could not remember the copy request. Allow site storage before trying again.',
    );
}
/** Forget a checked original pointer; only an explicit new installation also forgets its exact attempt. */
export function clearGalleryOriginal(scope: GalleryAttemptScope, forgetAttempt = false): void {
  const previous = readGalleryOriginal(scope);
  if (forgetAttempt && previous) clearStoredValue(previous.attemptKey, 'session');
  clearStoredValue(originalKey(scope), 'session');
}
