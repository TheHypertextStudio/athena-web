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
}
const storedAttempt = z.object({ requestId: z.uuid(), stale: z.boolean() });
/** One exact reviewed attempt, retaining only an opaque digest and UUID in tab storage. */
export interface GalleryAttempt {
  readonly storageKey: string;
  readonly restored: boolean;
  readonly stale: boolean;
  readonly request: WorkTemplateGalleryAcceptRequest;
}
/** Restore an exact attempt identity after reload without persisting canonical definition bodies. */
export async function galleryAttempt(
  scope: GalleryAttemptScope,
  input: WorkTemplateGalleryPreviewRequest,
  preview: WorkTemplateGalleryPreview,
): Promise<GalleryAttempt> {
  const request = WorkTemplateGalleryPreviewRequest.parse(input);
  const digest = await fingerprintCopyFacts([request, preview.reviewFingerprint]);
  const storageKey = `docket:gallery-copy-attempt:${JSON.stringify([scope.userId, scope.orgId, digest])}`;
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
    request: WorkTemplateGalleryAcceptRequest.parse({
      ...request,
      requestId: value.requestId,
      expectedReviewFingerprint: preview.reviewFingerprint,
    }),
  };
}
/** A rejected review remains rejected after reload until the user obtains a new checked review. */
export function markGalleryAttemptStale(attempt: GalleryAttempt): void {
  writeStoredJson(
    attempt.storageKey,
    { requestId: attempt.request.requestId, stale: true },
    'session',
  );
}
/** Explicitly start another installation only after the previous attempt has a known outcome. */
export function clearGalleryAttempt(attempt: GalleryAttempt): void {
  clearStoredValue(attempt.storageKey, 'session');
}

const originalPointer = z.object({ requestId: z.uuid(), attemptKey: z.string().min(1) });
function originalKey(scope: GalleryAttemptScope): string {
  return `docket:gallery-copy-original:${JSON.stringify([scope.userId, scope.orgId])}`;
}
/** Find the previous original request without recomputing or reading a canonical source definition. */
export function readGalleryOriginal(
  scope: GalleryAttemptScope,
): z.infer<typeof originalPointer> | null {
  const parsed = originalPointer.safeParse(readStoredJson(originalKey(scope), 'session'));
  return parsed.success ? parsed.data : null;
}
/** Remember only an opaque request pointer before a possible server write, checking storage actually retained it. */
export function retainGalleryOriginal(scope: GalleryAttemptScope, attempt: GalleryAttempt): void {
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
