/**
 * `@docket/ui` — the minimum gap every floating surface keeps from the viewport edge.
 *
 * @remarks
 * Radix's collision detection defaults `collisionPadding` to `0`, which means a menu opened near
 * the bottom of the window is positioned so its last pixel touches the last pixel of the
 * viewport. Measured on the Projects → Timeline "Display" menu, that produced a bounding box
 * whose `bottom` equalled `innerHeight` exactly — the final rows sliced by the window edge with
 * no gutter at all. It reads as a rendering bug, and it is the specific defect the launch
 * requirement calls out ("There must always be some kind of padding or margin for craft
 * reasons").
 *
 * Every overlay primitive in this package passes this constant as its default
 * `collisionPadding`, so the gap is a property of the design system rather than something each
 * call site has to remember. A call site may still pass a larger value; passing a smaller one is
 * a deliberate act that the overlay-inset test will not stop, but nothing in the product does.
 *
 * 12px rather than the graded minimum of 8px: it is the same rhythm step as the menus' own 8px
 * internal padding plus a hairline, so a menu near an edge looks *placed* rather than *barely
 * escaping*. The value is deliberately larger than the 8px the acceptance measures against, so
 * sub-pixel layout rounding can never take a real gap below the bar.
 */

/** Minimum distance, in CSS pixels, between any floating surface and every viewport edge. */
export const OVERLAY_COLLISION_PADDING = 12;

/**
 * The fallback that keeps a floating surface from clipping when nothing inside it owns scroll.
 *
 * @remarks
 * `DialogContent`, `SheetContent`, and a panel `PopoverContent` are all `overflow-hidden` under a
 * height cap, and they hand scrolling to a `DialogBody` / `SheetBody` / `PopoverBody`. That slot
 * holds a header and a footer still while the middle moves, but it is opt-in: a surface that omits
 * it clips past the cap, with no scrollbar and no keyboard route to the rest. Around twenty dialogs
 * were in that state, one of them showing an unbounded list of search results.
 *
 * When no descendant declares itself the scroll owner, the surface becomes one. The whole panel
 * moves then, header included. Adding the body slot restores the fixed header and stops this
 * selector matching.
 *
 * It has to be a `:has()` variant rather than a rule in `globals.css`, because a base-layer rule
 * loses to the `overflow-hidden` utility on the same element. As a variant it sits in the same
 * layer and carries the attribute selector's extra specificity, so it wins on the y axis only.
 */
export const OVERLAY_SCROLL_FALLBACK =
  'not-has-[[data-overlay-scroll-owner]]:overflow-y-auto ' +
  'not-has-[[data-overlay-scroll-owner]]:overscroll-contain';
