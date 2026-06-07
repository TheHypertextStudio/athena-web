/**
 * Open-documents store — route → document-ref matching.
 *
 * @remarks
 * Maps a detail-route pathname (`/orgs/:orgId/tasks/:id`, `…/projects/:id`, …) to the
 * {@link TabRef} it addresses, so the shell can open/activate a tab whenever the caller
 * navigates to a document — including via in-page links, the command palette, or a direct
 * URL. Non-detail routes (list views, the Hub) resolve to `null` (no tab is active).
 */
import { type TabDocType, type TabRef, TAB_ROUTE_SEGMENT } from './types';

/** The route segment → document kind lookup, inverted from {@link TAB_ROUTE_SEGMENT}. */
const SEGMENT_TYPE: ReadonlyMap<string, TabDocType> = new Map(
  (Object.entries(TAB_ROUTE_SEGMENT) as [TabDocType, string][]).map(([type, seg]) => [seg, type]),
);

/** Match `/orgs/:orgId/:segment/:id` (the detail-route shape), capturing the three parts. */
const DETAIL_ROUTE = /^\/orgs\/([^/]+)\/([^/]+)\/([^/]+)(?:\/|$)/;

/**
 * Resolve the {@link TabRef} a pathname addresses, or `null` when it is not a tabbable
 * document detail route.
 *
 * @param pathname - The current Next.js pathname.
 * @returns the matched document ref, or `null` for list/cross-org routes.
 */
export function tabRefFromPath(pathname: string): TabRef | null {
  const match = DETAIL_ROUTE.exec(pathname);
  if (!match) return null;
  const [, orgId, segment, id] = match;
  if (!orgId || !segment || !id) return null;
  const type = SEGMENT_TYPE.get(segment);
  if (!type) return null;
  return { type, orgId, id };
}
