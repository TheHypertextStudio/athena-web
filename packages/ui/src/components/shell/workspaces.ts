/**
 * `@docket/ui` — shared shell vocabulary for the sidebar's navigation model.
 *
 * @remarks
 * Defines the workspace descriptor consumed by the {@link WorkspaceSwitcher} and the stable
 * nav keys used by the {@link Sidebar}'s two groups — the cross-org **Home** group and the
 * org-scoped **Workspace** group. Keeping the keys here (rather than inside the components)
 * lets the host app map each key to a route and resolve the active highlight in lockstep,
 * so the sidebar highlight and the navigation target never drift apart.
 */

/** A workspace the caller can switch into: a concrete org (shared or personal). */
export interface Workspace {
  /** The org's id; drives the deterministic accent and the switch target. */
  readonly id: string;
  /** The org's display name. */
  readonly name: string;
  /** Optional avatar image URL. */
  readonly avatar?: string | null;
  /** Whether this is the caller's Personal org (grouped separately in the switcher). */
  readonly isPersonal: boolean;
  /** An attention count for this workspace, surfaced as a switcher badge. */
  readonly attentionCount?: number;
}

/**
 * The cross-org **Home** destinations, always available regardless of the active context.
 *
 * @remarks
 * `today`, `inbox`, and `portfolio` map 1:1 to their cross-org routes; `search` is not a
 * route but the command-palette opener.
 */
export type HomeNavKey = 'today' | 'inbox' | 'portfolio' | 'search';

/**
 * The org-scoped **Workspace** destinations, in mvp-plan §7 order.
 *
 * @remarks
 * Each key maps 1:1 to its route segment under `/orgs/[orgId]/…`, so the host's navigation
 * table and active-key resolution stay in lockstep with the real route tree.
 */
export type WorkspaceNavKey =
  | 'my-work'
  | 'triage'
  | 'initiatives'
  | 'programs'
  | 'projects'
  | 'cycles'
  | 'teams'
  | 'views'
  | 'agents'
  | 'settings';

/** The org-scoped nav keys whose labels are vocabulary-skinned per org. */
export type EntityWorkspaceNavKey = 'initiatives' | 'programs' | 'projects' | 'cycles' | 'teams';
