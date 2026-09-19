/** Runtime-validated, type-correlated contracts for authenticated routes. */
import {
  ActorId,
  OrganizationId,
  TeamId,
  type ActorId as ActorIdValue,
  type OrganizationId as OrganizationIdValue,
  type TeamId as TeamIdValue,
} from '@docket/identity-access/ids';
import { AgentSessionId, type AgentSessionId as AgentSessionIdValue } from '@docket/athena/ids';
import {
  CycleId,
  InitiativeId,
  ProgramId,
  ProjectId,
  RecurrenceSeriesId,
  TaskId,
  type CycleId as CycleIdValue,
  type InitiativeId as InitiativeIdValue,
  type ProgramId as ProgramIdValue,
  type ProjectId as ProjectIdValue,
  type RecurrenceSeriesId as RecurrenceSeriesIdValue,
  type TaskId as TaskIdValue,
} from '@docket/work/ids';
import type { ComponentType } from 'react';

import { type EntityNavigationSnapshot } from './contracts/entity-navigation';

import {
  OFFLINE_ROUTES,
  ROUTE_PATTERNS,
  type AuthenticatedRoutePattern,
} from './offline-routes.generated';
import { matchRoutes } from './route-match';

type RouteParamValue<TName extends string> = TName extends 'orgId'
  ? OrganizationIdValue
  : TName extends 'taskId'
    ? TaskIdValue
    : TName extends 'projectId'
      ? ProjectIdValue
      : TName extends 'programId'
        ? ProgramIdValue
        : TName extends 'initiativeId'
          ? InitiativeIdValue
          : TName extends 'cycleId'
            ? CycleIdValue
            : TName extends 'teamId'
              ? TeamIdValue
              : TName extends 'actorId'
                ? ActorIdValue
                : TName extends 'seriesId'
                  ? RecurrenceSeriesIdValue
                  : TName extends 'sessionId'
                    ? AgentSessionIdValue
                    : string;

type ParamsForSegment<TSegment extends string> = TSegment extends `[...${infer TName}]`
  ? Readonly<Record<TName, readonly string[]>>
  : TSegment extends `[${infer TName}]`
    ? Readonly<Record<TName, RouteParamValue<TName>>>
    : object;

type ParamsForPath<TPath extends string> = TPath extends `${infer THead}/${infer TTail}`
  ? ParamsForSegment<THead> & ParamsForPath<TTail>
  : ParamsForSegment<TPath>;

type Simplify<TValue> = { readonly [TKey in keyof TValue]: TValue[TKey] };

/** Parameters inferred from one generated authenticated route pattern. */
export type AuthenticatedRouteParams<TPattern extends AuthenticatedRoutePattern> = Simplify<
  ParamsForPath<TPattern>
>;

/** One generated route paired with its correlated, validated parameters. */
export type AuthenticatedRoute = {
  [TPattern in AuthenticatedRoutePattern]: {
    readonly pattern: TPattern;
    readonly params: AuthenticatedRouteParams<TPattern>;
  };
}[AuthenticatedRoutePattern];

/** Result of resolving a pathname against the authenticated route manifest. */
export type AuthenticatedRouteMatch =
  | { readonly kind: 'matched'; readonly route: AuthenticatedRoute }
  | { readonly kind: 'invalid'; readonly pattern: AuthenticatedRoutePattern }
  | { readonly kind: 'unmatched' };

interface RuntimeParamSchema {
  parse(value: unknown): unknown;
  safeParse(
    value: unknown,
  ): { readonly success: true; readonly data: unknown } | { readonly success: false };
}

const fallbackParam: RuntimeParamSchema = {
  parse(value) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError('Route parameters must be non-empty strings.');
    }
    return value;
  },
  safeParse(value) {
    return typeof value === 'string' && value.length > 0
      ? { success: true, data: value }
      : { success: false };
  },
};

const paramSchemas: Readonly<Record<string, RuntimeParamSchema>> = {
  orgId: OrganizationId,
  taskId: TaskId,
  projectId: ProjectId,
  programId: ProgramId,
  initiativeId: InitiativeId,
  cycleId: CycleId,
  teamId: TeamId,
  actorId: ActorId,
  seriesId: RecurrenceSeriesId,
  sessionId: AgentSessionId,
};
/** The in-flight or settled load of each route's client component, so a route loads once. */
const modulePrefetches = new Map<AuthenticatedRoutePattern, Promise<ComponentType>>();
/**
 * The client component of every route that has finished loading.
 *
 * @remarks
 * A promise cannot be read synchronously, so a load that resolved earlier still costs the outlet a
 * commit of "loading" before it can render the route. This map is what lets a warmed route mount in
 * the very commit that navigates to it, which is what a shared-element transition needs: the
 * browser captures the destination in that one commit.
 */
const loadedRouteComponents = new Map<AuthenticatedRoutePattern, ComponentType>();

function paramSchema(name: string): RuntimeParamSchema {
  return paramSchemas[name] ?? fallbackParam;
}

function validateParams(
  params: Readonly<Record<string, string | readonly string[]>>,
): Readonly<Record<string, string | readonly string[]>> | null {
  const validated: Record<string, string | readonly string[]> = {};
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      const values: string[] = [];
      for (const item of value) {
        const result = paramSchema(name).safeParse(item);
        if (!result.success || typeof result.data !== 'string') return null;
        values.push(result.data);
      }
      if (values.length === 0) return null;
      validated[name] = values;
      continue;
    }
    const result = paramSchema(name).safeParse(value);
    if (!result.success || typeof result.data !== 'string') return null;
    validated[name] = result.data;
  }
  return validated;
}

/**
 * Parse a pathname through the generated manifest and validate every dynamic parameter.
 *
 * @param pathname - Same-origin pathname without a query string.
 * @returns A matched route, an invalid known route, or an unmatched pathname.
 */
export function parseAuthenticatedRoute(pathname: string): AuthenticatedRouteMatch {
  let match;
  try {
    match = matchRoutes(ROUTE_PATTERNS, pathname);
  } catch {
    return { kind: 'unmatched' };
  }
  if (match === null) return { kind: 'unmatched' };
  const params = validateParams(match.params);
  const pattern = match.pattern as AuthenticatedRoutePattern;
  if (params === null) return { kind: 'invalid', pattern };
  return {
    kind: 'matched',
    route: { pattern, params } as AuthenticatedRoute,
  };
}

function encodeParam(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Build an authenticated href only after its route-correlated parameters pass runtime validation.
 *
 * @param pattern - A generated authenticated route pattern.
 * @param params - Parameters inferred from that exact pattern.
 * @returns The encoded same-origin pathname.
 * @throws {z.ZodError} When runtime input bypassed TypeScript with an invalid parameter.
 */
export function buildAuthenticatedHref<TPattern extends AuthenticatedRoutePattern>(
  pattern: TPattern,
  params: AuthenticatedRouteParams<TPattern>,
): string {
  return pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith('[...') && segment.endsWith(']')) {
        const name = segment.slice(4, -1);
        const value = (params as Readonly<Record<string, unknown>>)[name];
        if (!Array.isArray(value) || value.length === 0) {
          throw new TypeError(`Catch-all route parameter ${name} must be a non-empty array.`);
        }
        return value
          .map((item) => paramSchema(name).parse(item))
          .map((item) => encodeParam(item as string))
          .join('/');
      }
      if (segment.startsWith('[') && segment.endsWith(']')) {
        const name = segment.slice(1, -1);
        const value = (params as Readonly<Record<string, unknown>>)[name];
        return encodeParam(paramSchema(name).parse(value) as string);
      }
      return segment;
    })
    .join('/');
}

/**
 * Build the detail href correlated with one target-discriminated entity snapshot.
 *
 * @param snapshot - Validated identity copied from a work-view row or aggregate response.
 * @returns The entity's typed authenticated detail pathname.
 */
export function buildEntityHref(snapshot: EntityNavigationSnapshot): string {
  switch (snapshot.target) {
    case 'task':
      return buildAuthenticatedHref('/orgs/[orgId]/tasks/[taskId]', {
        orgId: snapshot.organizationId,
        taskId: snapshot.id,
      });
    case 'project':
      return buildAuthenticatedHref('/orgs/[orgId]/projects/[projectId]', {
        orgId: snapshot.organizationId,
        projectId: snapshot.id,
      });
    case 'program':
      return buildAuthenticatedHref('/orgs/[orgId]/programs/[programId]', {
        orgId: snapshot.organizationId,
        programId: snapshot.id,
      });
    case 'initiative':
      return buildAuthenticatedHref('/orgs/[orgId]/initiatives/[initiativeId]', {
        orgId: snapshot.organizationId,
        initiativeId: snapshot.id,
      });
  }
}

/**
 * The path part of an href that may carry a query string.
 *
 * @param href - A path, optionally followed by `?query`.
 * @returns the path without its query string.
 */
export function pathnameOf(href: string): string {
  const queryAt = href.indexOf('?');
  return queryAt === -1 ? href : href.slice(0, queryAt);
}

/**
 * Load one route's client component once, and remember it for a synchronous read afterwards.
 *
 * @param pattern - A generated authenticated route pattern.
 * @returns The component, or `null` when the generated table has no client component for it.
 * @throws When the route's chunk cannot be loaded; the failed load is forgotten so a retry is real.
 */
export async function loadAuthenticatedRouteComponent(
  pattern: AuthenticatedRoutePattern,
): Promise<ComponentType | null> {
  const entry = OFFLINE_ROUTES.find((candidate) => candidate.pattern === pattern);
  if (entry === undefined) return null;
  const existing = modulePrefetches.get(pattern);
  if (existing !== undefined) return existing;
  const load = entry.load().then(
    (Component) => {
      loadedRouteComponents.set(pattern, Component);
      return Component;
    },
    (error: unknown) => {
      modulePrefetches.delete(pattern);
      throw error;
    },
  );
  modulePrefetches.set(pattern, load);
  return load;
}

/**
 * The client component of a route whose module has already loaded, read without waiting.
 *
 * @param pathname - Same-origin pathname without a query string.
 * @returns The component, or `undefined` when the pathname is not a route or its module is cold.
 */
export function loadedAuthenticatedRoute(pathname: string): ComponentType | undefined {
  const match = parseAuthenticatedRoute(pathname);
  if (match.kind !== 'matched') return undefined;
  return loadedRouteComponents.get(match.route.pattern);
}

/**
 * Load only the client module for one authenticated href after explicit pointer or keyboard intent.
 *
 * @param href - Same-origin href with an optional query string.
 * @returns Whether the href names a generated authenticated client route.
 */
export async function prefetchAuthenticatedRoute(href: string): Promise<boolean> {
  const match = parseAuthenticatedRoute(pathnameOf(href));
  if (match.kind !== 'matched') return false;
  const Component = await loadAuthenticatedRouteComponent(match.route.pattern);
  return Component !== null;
}

/** Forget every loaded route component. Tests use this to start each case cold. */
export function clearLoadedAuthenticatedRoutes(): void {
  modulePrefetches.clear();
  loadedRouteComponents.clear();
}
