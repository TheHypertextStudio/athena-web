/**
 * Open-documents store — shared types.
 *
 * @remarks
 * The multi-document tab bar tracks the caller's open "documents" — detail surfaces like a
 * task or a project. A {@link TabRef} is the minimal identity of one document (its kind, org,
 * and id); an {@link OpenTab} (from `@docket/ui/components`) adds the resolved title + href for
 * rendering. The store ({@link useOpenDocuments}) maps refs to open tabs, resolves titles
 * lazily, and persists the set across reloads.
 */
import type { OpenTab, TabDocType } from '@docket/ui/components';

export type { OpenTab, TabDocType };

/** The minimal identity of an open document: its kind, owning org, and id. */
export interface TabRef {
  /** The document kind (selects the glyph + the title-resolution + href shape). */
  readonly type: TabDocType;
  /** The owning org id (tabs are org-scoped). */
  readonly orgId: string;
  /** The document id. */
  readonly id: string;
}

/** The stable tab key for a document ref (`<type>:<orgId>:<id>`). */
export function tabKey(ref: TabRef): string {
  return `${ref.type}:${ref.orgId}:${ref.id}`;
}

/**
 * The route segment (under `/orgs/[orgId]/…`) that addresses each document kind.
 *
 * @remarks
 * Pluralized to match the real route tree (`/orgs/:orgId/tasks/:id`, `…/projects/:id`, …),
 * so {@link hrefForTab} and the route matcher stay in lockstep with the pages on disk.
 */
export const TAB_ROUTE_SEGMENT: Record<TabDocType, string> = {
  task: 'tasks',
  project: 'projects',
  initiative: 'initiatives',
  program: 'programs',
  cycle: 'cycles',
  session: 'sessions',
};

/** Build the detail-route href for a document ref. */
export function hrefForTab(ref: TabRef): string {
  return `/orgs/${ref.orgId}/${TAB_ROUTE_SEGMENT[ref.type]}/${ref.id}`;
}
