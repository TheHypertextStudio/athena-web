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
