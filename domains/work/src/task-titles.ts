/** The default maximum title length for actionable work. */
export const TITLE_MAX = 120;

/**
 * Normalize a title to the Work layer's length and empty-value rules.
 *
 * @remarks
 * A title is always safe to persist and show in a compact work surface: surrounding whitespace
 * is removed, blank input gets a useful fallback, and oversized values retain their beginning
 * with a terminal ellipsis. Callers decide how to choose a title (for example, an email subject
 * versus the first line of a capture); this helper owns only the shared finishing rule.
 *
 * @param text - The candidate title.
 * @param max - The inclusive maximum length.
 * @returns A non-empty title no longer than `max`.
 */
export function truncateTitle(text: string, max = TITLE_MAX): string {
  const trimmed = text.trim() || 'Follow up on an email';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}
