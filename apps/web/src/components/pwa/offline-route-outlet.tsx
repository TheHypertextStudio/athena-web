'use client';

import type { EntityNavigationSnapshot } from '@docket/types';
import { useEffect, useState, type ComponentType, type JSX } from 'react';

import { OfflineContent } from '@/components/offline-state';
import { EntityDetailSnapshot } from '@/components/views/entity-detail-skeleton';
import { useAppLocation } from '@/lib/app-location';
import { parseAuthenticatedRoute } from '@/lib/authenticated-route';
import { peekNavigationSnapshot } from '@/lib/navigation-snapshot-runtime';
import { OFFLINE_ROUTES } from '@/lib/offline-routes.generated';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * Renders the real page for whatever URL the browser is on, without a document for it.
 *
 * @remarks
 * This is what makes the offline shell more than a waiting room. The service worker answers a
 * navigation it has no cached document for with the shell document; that document boots the app
 * shell, and this component then loads the route's own client component out of the generated table
 * and mounts it. The page reads the persisted TanStack Query cache exactly as it would online, so a
 * task or project loaded earlier renders in full.
 *
 * Nothing here fabricates data. A route whose entity was never loaded renders its own empty state,
 * and the shell's standing offline banner says the whole screen may be stale.
 *
 * **Three things can go wrong, and each has a distinct honest answer.** No route claims the path —
 * the person typed something, or followed a link to a route this build does not have. The route's
 * chunk was never cached, so the dynamic import rejects; that is the case the precached chunk set
 * exists to make rare, and it stays possible for anything excluded from it. Or the chunk is still
 * arriving, which is a frame or two from disk. The first two land on {@link OfflineContent}; the
 * third renders nothing rather than flashing a skeleton for a load measured in milliseconds.
 */

/** What the outlet knows about the route it is trying to render. */
type OutletState =
  | { readonly pathname: string; readonly status: 'loading' }
  | { readonly pathname: string; readonly status: 'ready'; readonly Component: ComponentType }
  | {
      readonly pathname: string;
      readonly status: 'unavailable';
      readonly reason: 'module' | 'not-found';
    };

/**
 * Load and render the route component for the current URL.
 *
 * @returns The route's own UI, or the offline content state when it cannot be rendered.
 */
export default function OfflineRouteOutlet(): JSX.Element | null {
  const { pathname } = useAppLocation();
  const online = useOnlineStatus();
  const [state, setState] = useState<OutletState>({ pathname, status: 'loading' });
  const snapshot = navigationSnapshotForPathname(pathname);

  useEffect(() => {
    const match = parseAuthenticatedRoute(pathname);
    const entry =
      match.kind === 'matched'
        ? OFFLINE_ROUTES.find((route) => route.pattern === match.route.pattern)
        : undefined;

    if (!entry) {
      setState({ pathname, status: 'unavailable', reason: 'not-found' });
      return undefined;
    }

    // The pathname can change under us — offline navigation swaps the route without unmounting the
    // shell — so a load that resolves after the person has moved on must not be rendered.
    let current = true;
    setState({ pathname, status: 'loading' });
    // A dynamic import evaluates its module synchronously enough to monopolize the current event
    // turn in development and on cold devices. The snapshot above must get one browser paint before
    // that work begins, or importing a deferred editor defeats local-first navigation.
    const loadTimer = window.setTimeout(() => {
      entry
        .load()
        .then((Component) => {
          if (current) {
            setState({ pathname, status: 'ready', Component });
          }
        })
        .catch(() => {
          // The chunk is not in the cache and there is no network to fetch it from. Nothing is broken;
          // this route simply is not available on this device right now.
          if (current) {
            setState({ pathname, status: 'unavailable', reason: 'module' });
          }
        });
    }, 0);

    return () => {
      current = false;
      window.clearTimeout(loadTimer);
    };
  }, [pathname]);

  if (state.pathname !== pathname || state.status === 'loading') {
    return snapshot === null ? null : <NavigationSnapshotPlaceholder snapshot={snapshot} />;
  }
  if (state.status === 'unavailable') {
    if (state.reason === 'not-found') {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <p role="alert" className="text-on-surface-variant text-body-medium">
            Page not found.
          </p>
        </div>
      );
    }
    return <OfflineContent online={online} />;
  }
  return <state.Component key={pathname} />;
}

/** Return the route-correlated identity that the source row seeded before history changed. */
function navigationSnapshotForPathname(pathname: string): EntityNavigationSnapshot | null {
  const match = parseAuthenticatedRoute(pathname);
  if (match.kind !== 'matched') return null;

  switch (match.route.pattern) {
    case '/orgs/[orgId]/tasks/[taskId]':
      return matchingSnapshot('task', match.route.params.taskId, match.route.params.orgId);
    case '/orgs/[orgId]/projects/[projectId]':
      return matchingSnapshot('project', match.route.params.projectId, match.route.params.orgId);
    case '/orgs/[orgId]/programs/[programId]':
      return matchingSnapshot('program', match.route.params.programId, match.route.params.orgId);
    case '/orgs/[orgId]/initiatives/[initiativeId]':
      return matchingSnapshot(
        'initiative',
        match.route.params.initiativeId,
        match.route.params.orgId,
      );
    default:
      return null;
  }
}

/** Refuse a cached identity whose entity or organization does not exactly match the requested URL. */
function matchingSnapshot<TTarget extends EntityNavigationSnapshot['target']>(
  target: TTarget,
  id: string,
  organizationId: string,
): Extract<EntityNavigationSnapshot, { readonly target: TTarget }> | null {
  const snapshot = peekNavigationSnapshot(target, id);
  if (snapshot?.target !== target) return null;
  if (snapshot.id !== id || snapshot.organizationId !== organizationId) {
    return null;
  }
  return snapshot as Extract<EntityNavigationSnapshot, { readonly target: TTarget }>;
}

/** Paint a truthful entity identity immediately while the detail route module loads. */
function NavigationSnapshotPlaceholder({
  snapshot,
}: {
  readonly snapshot: EntityNavigationSnapshot;
}): JSX.Element {
  switch (snapshot.target) {
    case 'task':
      return (
        <EntityDetailSnapshot
          label="Task"
          title={snapshot.title}
          metadata={
            <span className="text-on-surface-variant text-body-small">
              Status: {snapshot.status.replaceAll('_', ' ')} · Priority: {snapshot.priority}
            </span>
          }
          syncing={false}
        />
      );
    case 'project':
      return (
        <EntityDetailSnapshot
          label="Project"
          title={snapshot.name}
          metadata={<SnapshotMetadata snapshot={snapshot} />}
          syncing={false}
        />
      );
    case 'program':
      return (
        <EntityDetailSnapshot
          label="Program"
          title={snapshot.name}
          metadata={<SnapshotMetadata snapshot={snapshot} />}
          syncing={false}
        />
      );
    case 'initiative':
      return (
        <EntityDetailSnapshot
          label="Initiative"
          title={snapshot.name}
          metadata={<SnapshotMetadata snapshot={snapshot} />}
          syncing={false}
        />
      );
  }
}

/** Render the status fields every non-task local snapshot carries. */
function SnapshotMetadata({
  snapshot,
}: {
  readonly snapshot: Exclude<EntityNavigationSnapshot, { readonly target: 'task' }>;
}): JSX.Element {
  const priority = 'priority' in snapshot ? ` · ${snapshot.priority}` : '';
  const health = snapshot.health === null ? '' : ` · ${snapshot.health}`;
  return (
    <span className="text-on-surface-variant text-body-small">
      {snapshot.status}
      {priority}
      {health}
    </span>
  );
}
