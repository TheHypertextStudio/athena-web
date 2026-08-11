/**
 * The rules turning `src/app/(app)` into an offline route table, and the exceptions to them.
 *
 * @remarks
 * Shared by {@link file://./generate-offline-routes.ts}, which writes the table, and by the policy
 * test that asserts the committed table still matches the filesystem. Both must agree on what the
 * rules are, so the rules live here rather than in either one.
 *
 * Offline, Docket renders a route's **client** component directly: there is no server to run a
 * Server Component on, and every `(app)` page is either a client component already or a thin server
 * wrapper that prefetches into a `HydrationBoundary` and renders one. So the generator's job is to
 * find, for each route, the client module that holds the actual UI.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import ts from 'typescript';

/** Absolute path of `apps/web`. */
export const WEB_ROOT = join(import.meta.dirname, '..');

/** Absolute path of the authenticated route group. */
export const APP_GROUP = join(WEB_ROOT, 'src/app/(app)');

/**
 * Routes deliberately kept out of the offline table, and why.
 *
 * @remarks
 * Listing them explicitly — rather than letting the generator skip any page it cannot classify — is
 * what makes a genuinely unhandled page a build failure rather than a silent hole in offline
 * coverage.
 *
 * Only one kind qualifies today: a page whose entire body is a `redirect()` has nothing to render
 * and nothing to cache, and its destination has its own entry.
 *
 * Keyed by route pattern, valued with the reason, which is printed when the policy test reports a
 * mismatch.
 */
export const ROUTES_NOT_IN_TABLE: Readonly<Record<string, string>> = {
  '/orgs/[orgId]': 'redirects to /orgs/[orgId]/my-work',
  '/orgs/[orgId]/agents': 'redirects to /athena',
  '/orgs/[orgId]/athena': 'redirects to /athena',
  '/settings': 'redirects to /settings/profile',
};

/** One route the generator resolved. */
export interface ResolvedRoute {
  /** The URL pattern, in Next's own `[param]` notation. */
  readonly pattern: string;
  /** Import specifier of the client module holding this route's UI, relative to `src/lib`. */
  readonly module: string;
  /** Named export to render, or `'default'`. */
  readonly exportName: string;
}

/**
 * Turn a `page.tsx` path into its URL pattern.
 *
 * @remarks
 * Route groups (`(app)`, `(marketing)`) are organizational and contribute no path segment, so they
 * are dropped. Everything else is passed through unchanged, including `[param]` and `[...catch]`,
 * because {@link file://../src/lib/route-match.ts} parses that notation directly and a second
 * notation would be a second thing to keep in step.
 *
 * @param pagePath - Absolute path of a `page.tsx`.
 * @returns The route pattern, always starting with `/`.
 */
export function patternFor(pagePath: string): string {
  const segments = relative(APP_GROUP, dirname(pagePath))
    .split('/')
    .filter((segment) => segment.length > 0 && !segment.startsWith('('));
  return `/${segments.join('/')}`.replace(/\/$/, '') || '/';
}

/** Whether a source file opts into the client with the `'use client'` directive. */
export function isClientModule(source: string): boolean {
  const first = source
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('/*'));
  return first === "'use client';" || first === '"use client";';
}

/** Every `page.tsx` under the authenticated route group, sorted for a stable generated file. */
export function collectPages(): readonly string[] {
  return ts.sys
    .readDirectory(APP_GROUP, ['.tsx'], undefined, undefined)
    .filter((path) => basename(path) === 'page.tsx')
    .sort();
}

/** Sibling `*-client.tsx` modules beside a page, sorted. */
function clientSiblings(pagePath: string): readonly string[] {
  return ts.sys
    .readDirectory(dirname(pagePath), ['.tsx'], undefined, undefined)
    .filter((path) => dirname(path) === dirname(pagePath) && path.endsWith('-client.tsx'))
    .sort();
}

/** Why a page could not be resolved to a client module. */
export class UnresolvableRouteError extends Error {}

/**
 * Find the client module that renders a route.
 *
 * @remarks
 * Two rules, in order, covering every page in the app:
 *
 * 1. The page is itself a client component — render the page.
 * 2. The page is a server wrapper with exactly one sibling `*-client.tsx` — render the sibling.
 *
 * A page matching neither is a build failure, not a skip. The alternative was letting the generator
 * quietly omit anything it did not understand, which would mean a new route silently having no
 * offline behaviour and nobody finding out until someone lost a connection.
 *
 * @param pagePath - Absolute path of a `page.tsx`.
 * @returns The resolved route.
 * @throws {UnresolvableRouteError} When neither rule applies.
 */
export function resolveRoute(pagePath: string): ResolvedRoute {
  const pattern = patternFor(pagePath);
  const source = readFileSync(pagePath, 'utf8');

  if (isClientModule(source)) {
    if (declaresProps(source, pagePath)) {
      throw new UnresolvableRouteError(
        `${pattern}: the page is a client component that takes props. The route table mounts a route with no props, because offline there is no server to resolve Next's \`params\` promise. Read them with \`useAppParams\` from \`@/lib/app-location\` instead.`,
      );
    }
    return { pattern, module: importSpecifier(pagePath), exportName: 'default' };
  }

  const siblings = clientSiblings(pagePath);
  const only = siblings[0];
  if (siblings.length === 1 && only !== undefined) {
    if (declaresProps(readFileSync(only, 'utf8'), only)) {
      throw new UnresolvableRouteError(
        `${pattern}: ${basename(only)} takes props, so the route has no entry point the table can mount. Give it a prop-free sibling that resolves them from the URL, the way /search and /time do.`,
      );
    }
    return { pattern, module: importSpecifier(only), exportName: 'default' };
  }

  throw new UnresolvableRouteError(
    siblings.length > 1
      ? `${pattern}: ${String(siblings.length)} sibling *-client.tsx modules, so the route's UI is ambiguous. Give the route one client entry point.`
      : `${pattern}: the page is a Server Component with no sibling *-client.tsx, so it has no client UI to render offline. Move its body into one, or declare it in ROUTES_NOT_IN_TABLE with a reason.`,
  );
}

/**
 * Whether a module's default export declares any parameters.
 *
 * @remarks
 * The route table mounts a route component with no props. A page that takes Next's `params` promise
 * would therefore be handed nothing and read `undefined` off it — a runtime failure that shows up
 * only offline, which is the whole class of bug this generator exists to prevent. Sixteen pages had
 * that shape when the table was introduced and now read `useAppParams` instead.
 *
 * Parsed rather than pattern-matched: a signature can be spread over lines, destructured, or typed
 * inline, and a regular expression that got any of those wrong would fail open.
 *
 * @param source - The module source.
 * @param pagePath - Its path, used only for parser diagnostics.
 * @returns Whether the default export takes parameters.
 */
function declaresProps(source: string, pagePath: string): boolean {
  const file = ts.createSourceFile(
    pagePath,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const isDefault = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (isDefault === true) return statement.parameters.length > 0;
      continue;
    }
    if (ts.isExportAssignment(statement) && ts.isArrowFunction(statement.expression)) {
      return statement.expression.parameters.length > 0;
    }
  }
  return false;
}

/** The `@/`-rooted import specifier for a module inside `src`. */
function importSpecifier(absolutePath: string): string {
  return `@/${relative(join(WEB_ROOT, 'src'), absolutePath).replace(/\.tsx?$/, '')}`;
}

/** Where the generated table is written. */
export const GENERATED_PATH = join(WEB_ROOT, 'src/lib/offline-routes.generated.ts');

/**
 * Resolve every page, collecting failures rather than throwing on the first one.
 *
 * @remarks
 * Reporting one unresolvable route at a time would make adding a directory of pages a sequence of
 * identical build failures. All of them are reported together.
 *
 * @returns The resolved routes, in filesystem order.
 * @throws {Error} When any page can be neither resolved nor excused.
 */
export function resolveAllRoutes(): readonly ResolvedRoute[] {
  const resolved: ResolvedRoute[] = [];
  const failures: string[] = [];

  for (const page of collectPages()) {
    if (patternFor(page) in ROUTES_NOT_IN_TABLE) {
      continue;
    }
    try {
      resolved.push(resolveRoute(page));
    } catch (error) {
      if (error instanceof UnresolvableRouteError) {
        failures.push(`  - ${error.message}`);
        continue;
      }
      throw error;
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Cannot build the offline route table. These routes have no client UI to render:\n${failures.join('\n')}`,
    );
  }
  return resolved;
}

/**
 * Render the generated module.
 *
 * @param routes - The resolved routes.
 * @returns The full source of `src/lib/offline-routes.generated.ts`.
 */
export function renderRouteModule(routes: readonly ResolvedRoute[]): string {
  const entries = routes
    .map(
      (route) =>
        `  {\n    pattern: '${route.pattern}',\n    load: async () => (await import('${route.module}')).${route.exportName},\n  },`,
    )
    .join('\n');

  return `/**
 * Generated by \`scripts/generate-offline-routes.ts\` from \`src/app/(app)\`. Do not edit by hand.
 *
 * @remarks
 * Maps every authenticated route to the client component that renders it, so the app can render a
 * route without a server document for it. Regenerate with
 * \`pnpm --filter @docket/web exec tsx scripts/generate-offline-routes.ts\`; a policy test fails if
 * this file and the route tree disagree.
 *
 * Every \`load\` is a dynamic import, which is what keeps the route table out of the shell's own
 * bundle and gives the service worker a per-route chunk it can precache.
 */
import type { ComponentType } from 'react';

/** One route, and how to load the component that renders it. */
export interface OfflineRoute {
  /** The URL pattern in Next's \`[param]\` notation. */
  readonly pattern: string;
  /** Load the route's client component. */
  readonly load: () => Promise<ComponentType>;
}

/** Every authenticated route that has a client component to render. */
export const OFFLINE_ROUTES: readonly OfflineRoute[] = [
${entries}
];

/** Just the patterns, for matching a pathname without touching any route's component. */
export const ROUTE_PATTERNS: readonly string[] = OFFLINE_ROUTES.map((route) => route.pattern);
`;
}
