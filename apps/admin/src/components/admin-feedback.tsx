'use client';

import { InlineBanner } from '@docket/ui/components';
import { Skeleton } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import type { JSX, ReactNode } from 'react';

import { isAuthFailure } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

/** Props for {@link QueryErrorBanner}. */
export interface QueryErrorBannerProps {
  /**
   * The failure from a query, mutation, or action — or `null` to render nothing.
   *
   * @remarks
   * Deliberately an `Error` rather than `unknown`: this component reads a failure's `status` to
   * choose the recovery, and preserves its message only when it is a `UserFacingError`. Handing it
   * an already-rendered string used to type-check and then silently discard that string in favour
   * of the fallback, losing which of a screen's actions had failed.
   */
  readonly error: Error | null | undefined;
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

/** Props for {@link AsyncContent}. */
export interface AsyncContentProps {
  /** Whether the first read is still in flight. */
  readonly loading: boolean;
  /** Whether the read produced nothing to show. */
  readonly empty: boolean;
  /** The placeholder shown during the first read. */
  readonly skeleton: ReactNode;
  /** What to show when there is nothing to display. */
  readonly emptyState: ReactNode;
  /** The loaded content. */
  readonly children: ReactNode;
}

/**
 * Choose between a screen's three states: first load, nothing to show, and content.
 *
 * @remarks
 * Every operator screen has these same three states, and each one used to spell them out inline as
 * a chain of conditionals wrapped around large blocks of JSX. Naming the states once puts the
 * choice in a single place and leaves each screen declaring three named pieces instead of
 * describing the branching.
 *
 * `children` is an already-built node rather than a callback, so it is constructed even while
 * loading. Screens read their rows through `data?.items ?? []`, which makes that harmless — and it
 * keeps the call site declarative instead of nesting a render function inside the JSX.
 *
 * @param props - See {@link AsyncContentProps}.
 * @returns whichever state applies.
 */
export function AsyncContent({
  loading,
  empty,
  skeleton,
  emptyState,
  children,
}: AsyncContentProps): ReactNode {
  if (loading) return skeleton;
  if (empty) return emptyState;
  return children;
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
