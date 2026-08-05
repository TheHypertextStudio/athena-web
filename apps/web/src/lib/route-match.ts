/**
 * Matching a pathname against the app's route patterns, as pure functions.
 *
 * @remarks
 * This exists because offline the app cannot ask Next which route it is on. A cached shell document
 * is served for a URL it was not built for, so Next's router reports the route the *document* was
 * rendered for while `window.location` holds the route the person actually asked for. Route params
 * therefore have to be derived from the URL rather than read from `useParams`, and that derivation
 * is this file.
 *
 * The patterns themselves are generated from `src/app/(app)` by
 * `scripts/generate-offline-routes.ts`, so nothing here is a second, hand-maintained copy of the
 * route tree that could disagree with the real one.
 *
 * Split from the generated module so the matching rules can be unit-tested against fixture patterns
 * without pulling every route's component into the test's module graph.
 */

/** A route pattern segment, parsed once so matching does not re-parse on every navigation. */
type Segment =
  | { readonly kind: 'static'; readonly value: string }
  | { readonly kind: 'param'; readonly name: string }
  | { readonly kind: 'catch-all'; readonly name: string };

/** The result of matching a pathname against a pattern. */
export interface RouteMatch {
  /** The pattern that matched, in its original `/orgs/[orgId]/tasks/[taskId]` form. */
  readonly pattern: string;
  /**
   * Route params, shaped exactly as Next's `useParams` returns them.
   *
   * @remarks
   * A catch-all segment yields an array; every other param yields a string. Matching that shape is
   * what lets call sites move to {@link file://./app-location.tsx} without changing how they read a
   * param.
   */
  readonly params: Readonly<Record<string, string | readonly string[]>>;
}

/**
 * Parse a route pattern into segments.
 *
 * @param pattern - A pattern such as `/orgs/[orgId]/tasks/[taskId]`.
 * @returns Its segments, in order.
 */
function parse(pattern: string): readonly Segment[] {
  return pattern
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part.startsWith('[...') && part.endsWith(']')) {
        return { kind: 'catch-all', name: part.slice(4, -1) } as const;
      }
      if (part.startsWith('[') && part.endsWith(']')) {
        return { kind: 'param', name: part.slice(1, -1) } as const;
      }
      return { kind: 'static', value: part } as const;
    });
}

/**
 * How specific a pattern is, for ordering.
 *
 * @remarks
 * Higher wins. Static segments are what make one pattern more specific than another, so they
 * dominate the score; a catch-all is always the least specific thing that can match and is pushed
 * below every fixed-arity pattern. Without this, `/orgs/[orgId]/[...unmatched]` would swallow
 * `/orgs/[orgId]/tasks` purely because it appears earlier in the generated list.
 *
 * @param pattern - The pattern to score.
 * @returns Its specificity.
 */
export function specificity(pattern: string): number {
  const segments = parse(pattern);
  const statics = segments.filter((segment) => segment.kind === 'static').length;
  const hasCatchAll = segments.some((segment) => segment.kind === 'catch-all');
  return statics * 100 + segments.length - (hasCatchAll ? 10_000 : 0);
}

/**
 * Match one pathname against one pattern.
 *
 * @param pattern - The route pattern.
 * @param pathname - The pathname to test, with no query string or hash.
 * @returns The match, or `null` when the pattern does not apply.
 */
export function matchPattern(pattern: string, pathname: string): RouteMatch | null {
  const segments = parse(pattern);
  const parts = pathname.split('/').filter((part) => part.length > 0);
  const params: Record<string, string | readonly string[]> = {};

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) {
      return null;
    }

    if (segment.kind === 'catch-all') {
      // Next's catch-all requires at least one segment; `[[...x]]` (optional) is not used anywhere
      // in this app, so a bare parent path is deliberately not a match.
      const rest = parts.slice(index);
      if (rest.length === 0) {
        return null;
      }
      params[segment.name] = rest.map((part) => decodeURIComponent(part));
      return { pattern, params };
    }

    const part = parts[index];
    if (part === undefined) {
      return null;
    }
    if (segment.kind === 'static') {
      if (segment.value !== part) {
        return null;
      }
      continue;
    }
    params[segment.name] = decodeURIComponent(part);
  }

  // A trailing segment the pattern does not account for means a different, longer route.
  if (parts.length !== segments.length) {
    return null;
  }
  return { pattern, params };
}

/**
 * Sorted copies of pattern lists, so ordering is paid once per list rather than once per match.
 *
 * @remarks
 * Keyed on the array itself because the only list that matters in the app is a module constant, and
 * every link on a list surface resolves against it. Sorting per call turned an in-memory lookup into
 * an O(n log n) one on a surface that can hold hundreds of links.
 */
const orderedCache = new WeakMap<readonly string[], readonly string[]>();

/**
 * Match a pathname against every known pattern, most specific first.
 *
 * @param patterns - Every route pattern the app has.
 * @param pathname - The pathname to resolve.
 * @returns The best match, or `null` when no route claims this path.
 */
export function matchRoutes(patterns: readonly string[], pathname: string): RouteMatch | null {
  const cached = orderedCache.get(patterns);
  const ordered = cached ?? [...patterns].sort((a, b) => specificity(b) - specificity(a));
  if (!cached) {
    orderedCache.set(patterns, ordered);
  }
  for (const pattern of ordered) {
    const match = matchPattern(pattern, pathname);
    if (match) {
      return match;
    }
  }
  return null;
}
