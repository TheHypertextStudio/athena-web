import type { SearchDocumentKind } from '@docket/types';
import type { LucideIcon } from '@docket/ui/icons';

/**
 * The command-palette search scope.
 *
 * @remarks
 * The palette fuses cross-org Hub search with org-local navigation. `hub` searches every org
 * the caller belongs to (each hit org-chipped); `org` narrows search + navigation to the
 * org bound by the current route. The `org` scope is only selectable when an org is bound.
 */
export type PaletteScope = 'hub' | 'org';

/**
 * The semantic section a {@link PaletteItem} belongs to.
 *
 * @remarks
 * Drives the grouped section headers in the palette list and is purely presentational —
 * selection behavior lives on each item's {@link PaletteItem.run}.
 */
export type PaletteSection = 'navigation' | 'actions' | 'organizations' | 'results';

/**
 * A single, selectable row in the command palette.
 *
 * @remarks
 * Every command — a navigation jump, an action, an org switch, or a search hit — is
 * normalized to this shape so the list, keyboard navigation, and selection are uniform. The
 * `keywords` feed the local fuzzy filter for the static (non-search) commands; search hits
 * are server-filtered and so carry no keywords.
 */
export interface PaletteItem {
  /** Stable unique id (used as the React key and the active-row marker). */
  id: string;
  /** The section this item is grouped under. */
  section: PaletteSection;
  /** The primary, human-readable label. */
  label: string;
  /** Optional secondary line (e.g. the entity kind, or a hint). */
  hint?: string;
  /** Leading glyph. */
  icon: LucideIcon;
  /** Extra terms (besides `label`) the local filter matches against. */
  keywords?: readonly string[];
  /**
   * The org this item belongs to, when org-chipped (search hits, org switches, org-scoped
   * navigation). Omitted for Hub-global navigation/actions.
   */
  org?: { id: string; name: string };
  /** The search-hit entity kind, for result rows (drives the trailing kind label). */
  hitType?: SearchDocumentKind;
  /** Invoked when the row is selected; the palette closes immediately after. */
  run: () => void;
}
