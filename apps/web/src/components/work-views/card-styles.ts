/**
 * `work-views/card-styles` — the geometry the Cards lens agrees on.
 *
 * @remarks
 * These are shared rather than inlined because more than one file has to agree about them and
 * they used to disagree: the card and its inner link each declared their own padding and their
 * own minimum height, and the loading skeleton described a third shape entirely, so the roster
 * rearranged itself on resolve. One declaration each, imported by everyone who needs it.
 *
 * They live in their own module so the card frame, a target's card content, and the page's
 * skeleton can all read them without importing each other.
 */

/**
 * The card's single inset.
 *
 * @remarks
 * It belongs to the link rather than the card, because the link has to fill the card for the
 * whole surface to be clickable and only one of the two can own the padding. Both used to declare
 * `p-4`, which inset content 32px while the selection checkbox stayed pinned at 16px — the
 * checkbox floated in the gutter instead of the content column, and every card wore a band of
 * dead space it never earned.
 */
export const CARD_INSET = 'p-4';

/** The card's minimum height, declared once so the skeleton and the loaded card agree. */
export const CARD_MIN_HEIGHT = 'min-h-40';

/**
 * The card grid's track sizing and rhythm.
 *
 * @remarks
 * A 16rem minimum packed four columns into a typical shell width and truncated nearly every
 * title, which is a hierarchy failure — the name is the one thing a roster exists to show. 20rem
 * holds three columns at the same width and leaves a two-line title somewhere to land. The gap
 * matches the page shell's own, so the grid sits on the surface's rhythm rather than its own.
 */
export const CARD_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4';

/**
 * The leading identity slot, which fades out beneath the selection checkbox laid over it.
 *
 * @remarks
 * The List lens swaps a row's glyph for its checkbox in the same place; doing it the same way
 * here keeps selecting a card and selecting a row the same gesture with the same appearance. The
 * checkbox is a sibling of the card's link rather than a child, so clicking it selects instead of
 * navigating — which is why the two halves of the swap are styled from opposite sides and share
 * this class instead of living in one component.
 */
export const CARD_GLYPH_FADE_CLASS =
  'shrink-0 transition-opacity group-focus-within/card:opacity-0 group-hover/card:opacity-0 group-data-[selecting=true]/card:opacity-0';
