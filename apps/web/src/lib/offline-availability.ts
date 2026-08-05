'use client';

import { useEffect, useState } from 'react';

import { OFFLINE_ROUTES, ROUTE_PATTERNS } from './offline-routes.generated';
import { matchRoutes } from './route-match';

/**
 * Whether a destination can actually be opened right now.
 *
 * @remarks
 * Offline, a link to a route this device has no code for is a dead end. Following it costs a
 * navigation and lands on "this page needs a connection", which is a worse answer than the link
 * having told you so before you clicked. So links ask this, and render themselves inert when the
 * answer is no.
 *
 * **What this checks is whether the route can render, not whether its contents are complete.** A
 * route is answerable when the generated table claims the path and that route's chunk is in the
 * browser's cache. Whether the specific task or project behind the link was ever loaded is a
 * different question, and one each surface already answers for itself with its own empty state —
 * pretending to know it here would mean either a per-route map of query keys that drifts, or a scan
 * of the query cache per link on a surface that can hold hundreds of them.
 *
 * The chunk check is a load attempt, which is the honest form of the question: "can this route
 * render" is exactly "does its module resolve". It costs nothing on a route whose chunk is cached,
 * and it is resolved **once per pattern**, not once per link — every row in a task list points at
 * the same route.
 */

/** What a link knows about its destination. */
export type Availability = 'available' | 'unavailable' | 'unknown';

/**
 * Load attempts in flight or settled, keyed by route pattern.
 *
 * @remarks
 * Module-scoped rather than per-component: a list surface renders one link per row, all pointing at
 * the same route, and probing per link would turn one question into two hundred.
 */
const probes = new Map<string, Promise<boolean>>();

/** Settled probe results, so a re-render answers without touching a promise. */
const settled = new Map<string, boolean>();

/** The route pattern that claims a path, or `null` when none does. */
export function patternForHref(href: string): string | null {
  const queryAt = href.indexOf('?');
  const pathname = queryAt === -1 ? href : href.slice(0, queryAt);
  // The generated constant, not a fresh `.map()`: `matchRoutes` memoises its sort on the array
  // identity, and every row of a list surface asks this question.
  return matchRoutes(ROUTE_PATTERNS, pathname)?.pattern ?? null;
}

/**
 * Whether this route's code is present, loading it if that is not yet known.
 *
 * @param pattern - The route pattern to probe.
 * @returns Whether the route can render.
 */
function probe(pattern: string): Promise<boolean> {
  const existing = probes.get(pattern);
  if (existing) return existing;

  const entry = OFFLINE_ROUTES.find((route) => route.pattern === pattern);
  const attempt = entry
    ? entry.load().then(
        () => true,
        () => false,
      )
    : Promise.resolve(false);

  const tracked = attempt.then((ok) => {
    settled.set(pattern, ok);
    // A failure offline is not a permanent answer — the chunk may be fetchable once the connection
    // is back — so a failed probe is forgotten and re-asked rather than cached as "never".
    if (!ok) probes.delete(pattern);
    return ok;
  });
  probes.set(pattern, tracked);
  return tracked;
}

/**
 * Forget every probe result.
 *
 * @remarks
 * Called when the connection returns: a route that could not load offline may load now, and leaving
 * the old answer in place would keep links inert after the reason for it went away.
 */
export function resetAvailabilityProbes(): void {
  probes.clear();
  settled.clear();
}

/**
 * Whether a destination can be opened.
 *
 * @param href - The destination, or `null` to skip the question entirely.
 * @param enabled - `false` while the server is reachable, where every link works and nothing needs
 *   probing.
 * @returns The availability, `'unknown'` only while a first probe is in flight.
 */
export function useOfflineAvailability(href: string | null, enabled: boolean): Availability {
  const internal = href?.startsWith('/') === true;
  const pattern = enabled && internal ? patternForHref(href) : null;
  const known = pattern === null ? undefined : settled.get(pattern);
  const [, force] = useState(0);

  useEffect(() => {
    if (!enabled || pattern === null || settled.has(pattern)) {
      return undefined;
    }
    let current = true;
    void probe(pattern).then(() => {
      if (current) {
        force((tick) => tick + 1);
      }
    });
    return () => {
      current = false;
    };
  }, [enabled, pattern]);

  if (!enabled) {
    return 'available';
  }
  // An external or non-path href is nobody's business but the browser's.
  if (!internal) {
    return 'available';
  }
  if (pattern === null) {
    return 'unavailable';
  }
  if (known === undefined) {
    return 'unknown';
  }
  return known ? 'available' : 'unavailable';
}
