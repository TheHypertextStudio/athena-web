'use client';

import type { JSX } from 'react';

import { resolveTaskGraphScope } from '@/components/canvas/scope';
import { useAppLocation } from '@/lib/app-location';

import GraphCanvas from './graph-canvas';

/**
 * The dependency-graph route's entry point.
 *
 * @remarks
 * Exists so the route has a component that can be mounted with no props. The scope the canvas needs
 * comes entirely from the URL — the workspace from the path, the narrowing from the query string —
 * so the server was resolving it only because it happened to be the one rendering. Offline there is
 * no server render at all and the route table mounts this directly, so resolving it here is both
 * necessary and the more honest place: the scope is a property of the URL, not of who rendered it.
 *
 * The server page keeps its own prefetch and warms the same key, because
 * {@link resolveTaskGraphScope} is shared.
 *
 * @returns The focused graph canvas for the current URL.
 */
export default function GraphClient(): JSX.Element {
  const { params, searchParams } = useAppLocation();
  const orgId = typeof params['orgId'] === 'string' ? params['orgId'] : '';
  const scope = resolveTaskGraphScope(orgId, {
    projectId: searchParams.get('projectId') ?? undefined,
    rootTaskId: searchParams.get('rootTaskId') ?? undefined,
    depth: searchParams.get('depth') ?? undefined,
  });

  return <GraphCanvas scope={scope} />;
}
