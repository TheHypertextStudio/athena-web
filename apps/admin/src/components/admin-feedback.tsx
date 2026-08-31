'use client';

import { InlineBanner } from '@docket/ui/components';
import { Skeleton } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import { isAuthFailure } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

/** Props for {@link QueryErrorBanner}. */
export interface QueryErrorBannerProps {
  /** The failure from a query or mutation, or `null`/`undefined` to render nothing. */
  readonly error: unknown;
  /** Application-owned copy used when the failure carries none of its own. */
  readonly fallback: string;
  /** Retry the failed read, when the caller has something to retry. */
  readonly onRetry?: (() => void) | undefined;
}

/**
 * The console's one failure surface.
 *
 * @remarks
 * Replaces the screen-by-screen trio of an error banner, a separate sign-in affordance, and an
 * `authFailed` boolean each screen tracked itself. The recovery an operator needs follows from the
 * status, so this decides it once: a 401/403 means the session is not a staff session and the way
 * forward is to sign in as one; anything else is worth retrying.
 *
 * The rendered message is always application-owned copy — {@link userErrorMessage} returns the
 * caller's fallback for anything that is not already a `UserFacingError`, so a provider's exception
 * text or a Problem `detail` can never reach the screen.
 *
 * @param props - See {@link QueryErrorBannerProps}.
 * @returns the failure banner, or `null` when there is no error.
 */
export function QueryErrorBanner({
  error,
  fallback,
  onRetry,
}: QueryErrorBannerProps): JSX.Element | null {
  const router = useRouter();
  if (!error) return null;

  if (isAuthFailure(error)) {
    return (
      <InlineBanner
        tone="critical"
        title="Operator access required"
        action={{
          label: 'Sign in',
          onSelect: () => {
            router.push('/sign-in');
          },
        }}
      >
        This screen is limited to Docket operators. Sign in with a staff account to continue.
      </InlineBanner>
    );
  }

  return (
    <InlineBanner
      tone="critical"
      title="Could not load"
      {...(onRetry ? { action: { label: 'Try again', onSelect: onRetry } } : {})}
    >
      {userErrorMessage(error, fallback)}
    </InlineBanner>
  );
}

/** Props for {@link ListSkeleton}. */
export interface ListSkeletonProps {
  /** How many placeholder rows to draw. */
  readonly rows?: number | undefined;
}

/**
 * The console's one loading placeholder for a list.
 *
 * @remarks
 * Rows are sized to the real row height so the screen does not jump when data arrives. This is only
 * for a *first* load: a list that already has rows keeps rendering them while refetching (see
 * `useApiListQuery`), because replacing content the operator is reading with grey boxes on every
 * debounced keystroke is worse than showing slightly stale rows.
 *
 * @param props - See {@link ListSkeletonProps}.
 * @returns the placeholder rows.
 */
export function ListSkeleton({ rows = 6 }: ListSkeletonProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** Props for {@link RefreshingOverlay}. */
export interface RefreshingOverlayProps {
  /** Whether a background refetch is in flight over content that is already on screen. */
  readonly refreshing: boolean;
  /** The content being refreshed. */
  readonly children: JSX.Element;
}

/**
 * Dim content while it is being refreshed, rather than replacing it.
 *
 * @remarks
 * The visible half of the search-debounce fix. With the rows kept on screen by
 * `useApiListQuery`, this is what tells the operator a newer answer is coming — a brief reduction
 * in opacity, with no layout change, so nothing moves under the pointer.
 *
 * @param props - See {@link RefreshingOverlayProps}.
 * @returns the content, dimmed while refreshing.
 */
export function RefreshingOverlay({ refreshing, children }: RefreshingOverlayProps): JSX.Element {
  return (
    <div
      className={`transition-opacity duration-150 ${refreshing ? 'opacity-60' : 'opacity-100'}`}
      aria-busy={refreshing}
    >
      {children}
    </div>
  );
}
