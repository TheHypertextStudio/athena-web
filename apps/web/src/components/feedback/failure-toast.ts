'use client';

/**
 * `components/feedback/failure-toast` — route a caught failure to the notice stack.
 *
 * @remarks
 * The one path from a rejected write to the screen. It reads no `.message`: the copy and the
 * action come from `failurePresentation`, which branches on the failure's stable code and status
 * only, so a 403 offers the destination that can resolve it and a 500 offers retry. Notices are
 * keyed by that code, so a poll that keeps failing shows one card rather than a column.
 */
import { notifyFailure } from '@docket/ui/components';

import { failureAction, failurePresentation } from '@/lib/failure-presentation';

/** What a caller can add to a failure notice. */
export interface PresentFailureOptions {
  /** Re-issue the request; offered only when retrying could plausibly succeed. */
  readonly retry?: (() => void) | undefined;
}

/**
 * Show a caught failure as a notice with classified, application-owned copy.
 *
 * @param error - The caught failure, usually a `UserFacingError` from the query layer.
 * @param fallbackTitle - Application-owned copy naming the operation, used only when the failure
 *   carries neither a code nor a usable status.
 * @param options - See {@link PresentFailureOptions}.
 * @returns the notice's id.
 */
export function presentFailure(
  error: unknown,
  fallbackTitle: string,
  options: PresentFailureOptions = {},
): string {
  const failure = failurePresentation(error, fallbackTitle);
  const destination = failureAction(failure);
  const action =
    failure.canRetry && options.retry
      ? { label: 'Try again', onSelect: options.retry }
      : destination
        ? { label: destination.label, href: destination.href }
        : undefined;
  return notifyFailure({
    title: failure.title,
    detail: failure.detail,
    action,
    dedupeKey: `failure:${failure.code ?? failure.status ?? 'unknown'}`,
  });
}
