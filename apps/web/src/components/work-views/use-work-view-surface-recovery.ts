'use client';

import { useCallback } from 'react';

import { projectOverviewDef } from '@/lib/fetch-project-overview';
import { useApiQuery } from '@/lib/query';

/** Inputs describing what a work-view surface has loaded and how to reload each part. */
export interface WorkViewSurfaceRecoveryOptions {
  readonly organizationId: string;
  /** True while the Project dependency lens, rather than the roster, owns the content area. */
  readonly dependencyLensActive: boolean;
  /** The roster's initial read failure, from the work-view controller. */
  readonly initialError: unknown;
  /** Whether the roster has a response to show, cached or fresh. */
  readonly hasResponse: boolean;
  /** Refetch the controller's own failed reads. */
  readonly retryControllerReads: () => void;
  readonly savedViewsFailed: boolean;
  readonly refetchSavedViews: () => void;
}

/** What the surface should render for failure, and the single action that repairs it. */
export interface WorkViewSurfaceRecovery {
  /**
   * The content area has nothing to show and is yielding to a recovery state.
   *
   * Chrome failures stay silent while this is true: with the content gone, saved views and view
   * preferences cannot be acted on, so their rows would stack noise above a state that already
   * explains the situation and offers the only useful action.
   */
  readonly contentFailed: boolean;
  /** Refetch every failed read behind the surface. */
  readonly retrySurface: () => void;
}

/**
 * Decide whether a work view's *content* has failed, and give the surface one way to recover.
 *
 * The reads behind a work view share a client, a session cookie and a middleware stack, so a single
 * upstream failure takes all of them down together. Left to themselves each owner announced its own
 * failure, turning one outage into a column of red sentences, and each offered a retry that
 * repaired only its own query.
 *
 * @param options - The surface's current load state and per-part reload callbacks.
 * @returns Whether the content area has failed, and the surface-wide retry.
 */
export function useWorkViewSurfaceRecovery(
  options: WorkViewSurfaceRecoveryOptions,
): WorkViewSurfaceRecovery {
  const {
    organizationId,
    dependencyLensActive,
    initialError,
    hasResponse,
    retryControllerReads,
    savedViewsFailed,
    refetchSavedViews,
  } = options;

  // The same cache entry `ProjectDependencyLens` reads, subscribed here only while that lens is
  // mounted. Sharing the key costs no extra request and lets the host tell whether the content is
  // in a failure state.
  const overview = useApiQuery({
    ...projectOverviewDef(organizationId),
    enabled: dependencyLensActive,
  });
  const overviewFailed = overview.isError && overview.data === undefined;
  const contentFailed = dependencyLensActive
    ? overviewFailed
    : Boolean(initialError) && !hasResponse;
  const refetchOverview = overview.refetch;

  const retrySurface = useCallback((): void => {
    retryControllerReads();
    if (savedViewsFailed) refetchSavedViews();
    if (overviewFailed) void refetchOverview();
  }, [overviewFailed, refetchOverview, refetchSavedViews, retryControllerReads, savedViewsFailed]);

  return { contentFailed, retrySurface };
}
