/**
 * `@docket/ui` — shared types for the compact inline property pickers.
 *
 * @remarks
 * The picker family is intentionally *presentational*: every picker takes its choices as a
 * plain, pre-resolved array of {@link PickerOption}s and reports the chosen value through an
 * `onChange` callback. No picker reaches for app data, the RPC client, or the org context —
 * app-data-bound wrappers in `apps/web` resolve members / projects / programs / cycles into
 * options and own the optimistic PATCH. This keeps the shells reusable by BOTH the detail
 * property panels and the create composers, and trivially testable in `@docket/ui`.
 */
import type { ReactNode } from 'react';

/**
 * One selectable choice in a picker menu/listbox.
 *
 * @remarks
 * `value` is the stable identity reported back through `onChange` (an actor id, an enum
 * literal, a project id, …). `label` is the human text shown and matched against the search
 * query. `icon` is an optional leading glyph/avatar node (e.g. a {@link StatusIcon}, a
 * {@link PriorityGlyph}, or an {@link ActorAvatar}). `keywords` add extra search-match terms
 * that are never displayed (e.g. a team key, an email). `disabled` renders the option
 * non-selectable.
 */
export interface PickerOption<TValue extends string = string> {
  /** The stable identity reported back through `onChange`. */
  value: TValue;
  /** The human-readable text shown and matched against the search query. */
  label: string;
  /** Optional leading glyph or avatar node. */
  icon?: ReactNode;
  /** Optional muted trailing hint (e.g. a count, a date, an email). */
  hint?: string;
  /** Extra non-displayed terms folded into search matching. */
  keywords?: readonly string[];
  /** When `true`, the option renders muted and cannot be selected. */
  disabled?: boolean;
}

/**
 * Case-insensitive substring match of a query against an option's label + keywords.
 *
 * @param option - The option to test.
 * @param query - The trimmed lower-cased search query.
 * @returns true when the option matches (an empty query matches everything).
 */
export function optionMatches(option: PickerOption, query: string): boolean {
  if (query.length === 0) return true;
  if (option.label.toLowerCase().includes(query)) return true;
  return (option.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(query));
}
