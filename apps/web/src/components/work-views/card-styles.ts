/**
 * `work-views/card-styles` — the geometry the Cards lens agrees on.
 *
 * @remarks
 * The card frame, a target's card content, and the page's loading skeleton all have to describe
 * the same shape, and they sit in three files that do not import each other. These constants are
 * what they agree through, so a card and its placeholder cannot drift into two different shapes.
 */

/**
 * The card's single inset.
 *
 * @remarks
 * It belongs to the link rather than the card, because the link has to fill the card for the whole
 * surface to be clickable, and only one of the two can own the padding without insetting content
 * twice over.
 */
export const CARD_INSET = 'p-4';

/** The card's minimum height, declared once so the skeleton and the loaded card agree. */
export const CARD_MIN_HEIGHT = 'min-h-40';

/**
 * The card grid's track sizing and rhythm.
 *
 * @remarks
 * A 20rem minimum holds three columns at a typical shell width and leaves a two-line title
 * somewhere to land; narrower tracks pack a fourth column and truncate the name, which is the one
 * thing a roster exists to show. The gap matches the page shell's own.
 */
export const CARD_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4 p-1';

/**
 * The leading identity slot, which fades out beneath the selection checkbox laid over it.
 *
 * @remarks
 * The checkbox has to be a sibling of the card's link rather than a child, so that clicking it
 * selects instead of navigating. That puts the two halves of the swap in different components,
 * which is why the glyph half is a shared class rather than part of one crossfade component the
 * way the List lens does it.
 */
export const CARD_GLYPH_FADE_CLASS =
  'shrink-0 transition-opacity group-focus-within/card:opacity-0 group-hover/card:opacity-0 group-data-[selecting=true]/card:opacity-0';
