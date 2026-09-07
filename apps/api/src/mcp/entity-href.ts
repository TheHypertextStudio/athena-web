/**
 * `@docket/api` — the product route for one entity.
 *
 * @remarks
 * Its own module rather than a member of a tool file because five tools and two widgets need it,
 * and the two obvious homes both import from tools that would then import back. It depends on
 * nothing but `READABLE_TYPES`.
 */
import type { READABLE_TYPES } from './resources';

/** An entity kind that has a page in the product app. */
export type ReadableType = (typeof READABLE_TYPES)[number];

/**
 * Where each kind lives.
 *
 * @remarks
 * A `Record` keyed by {@link ReadableType} rather than a switch, so a kind added to
 * `READABLE_TYPES` without a route is a compile error. Four of these are not `/kind+s/id`, which is
 * why no widget may guess at them.
 */
const ROUTE: Record<ReadableType, (orgId: string, id: string) => string> = {
  task: (orgId, id) => `/orgs/${orgId}/tasks/${id}`,
  project: (orgId, id) => `/orgs/${orgId}/projects/${id}`,
  program: (orgId, id) => `/orgs/${orgId}/programs/${id}`,
  initiative: (orgId, id) => `/orgs/${orgId}/initiatives/${id}`,
  cycle: (orgId, id) => `/orgs/${orgId}/cycles/${id}`,
  session: (orgId, id) => `/orgs/${orgId}/sessions/${id}`,
  team: (orgId) => `/orgs/${orgId}/teams`,
  agent: (orgId) => `/orgs/${orgId}/agents`,
  view: (orgId, id) => `/orgs/${orgId}/views?viewId=${id}`,
  update: (orgId, id) => `/orgs/${orgId}/search?kind=update&id=${id}`,
  comment: (orgId, id) => `/orgs/${orgId}/search?kind=comment&id=${id}`,
  org: (orgId) => `/orgs/${orgId}`,
};

/**
 * Build the first-party route once on the trusted server, never in a widget.
 *
 * @remarks
 * Widgets render `href` straight from the payload rather than assembling a path they cannot
 * typecheck.
 *
 * @param orgId - The workspace the entity belongs to.
 * @param type - What kind of entity it is.
 * @param id - Its id.
 * @returns the path within the product app.
 */
export function entityHref(orgId: string, type: ReadableType, id: string): string {
  return ROUTE[type](orgId, id);
}

/**
 * The page listing each kind that has one.
 *
 * @remarks
 * Written out for the same reason {@link ROUTE} is: a path built by appending an "s" is a guess
 * this file exists to stop. Not every `ReadableType` has a list page, so the keys are their own
 * statement of which do.
 */
const LIST_ROUTE = {
  task: (orgId: string) => `/orgs/${orgId}/tasks`,
  project: (orgId: string) => `/orgs/${orgId}/projects`,
  program: (orgId: string) => `/orgs/${orgId}/programs`,
  initiative: (orgId: string) => `/orgs/${orgId}/initiatives`,
} as const;

/**
 * The page listing every entity of one kind.
 *
 * @remarks
 * A card that folds after four rows sends the reader here for the rest. Pointing them at the first
 * row's detail page instead shows them none of the rows they clicked to see.
 *
 * @param orgId - The workspace.
 * @param type - Which kind to list.
 * @returns the list path within the product app.
 */
export function entityListHref(orgId: string, type: keyof typeof LIST_ROUTE): string {
  return LIST_ROUTE[type](orgId);
}
