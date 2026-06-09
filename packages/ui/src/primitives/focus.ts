/**
 * `@docket/ui` — the single, canonical keyboard-focus convention.
 *
 * @remarks
 * Before this module the codebase had at least three competing focus treatments
 * (`focus-visible:ring-1` on {@link Button}/{@link Input}, `ring-2` on the shell tab bar and
 * AppShell, `ring-1 ring-inset` on list rows, and `focus:bg`-only on dropdown items). That
 * inconsistency is exactly what the Phase A review flagged. This module collapses all of it to
 * two strings so every focusable surface in the design system rings the same way:
 *
 * - {@link focusRing} — the **standalone** ring for free-standing controls (buttons, inputs,
 *   triggers, close affordances, anchors): a 2px `ring-ring` ring sitting just outside the
 *   element. Use it on anything that has clear breathing room around it.
 * - {@link focusRingInset} — the **inset** ring for **dense rows** (list rows, menu items,
 *   picker options, table cells) where an outer 2px ring would collide with the neighbour above
 *   or below. It draws a 1px `ring-ring` ring *inside* the element's box so adjacent rows stay
 *   pixel-flush.
 *
 * Both clear the native outline (`focus-visible:outline-none`) and key off `:focus-visible`, so
 * the ring only appears for keyboard/programmatic focus — never on a mouse click. Compose them
 * with {@link cn} alongside the element's other classes:
 *
 * @example
 * ```tsx
 * import { cn, focusRing, focusRingInset } from '@docket/ui';
 *
 * // Standalone control
 * <button className={cn('rounded-md px-3 py-2', focusRing)}>Save</button>
 *
 * // Dense row in a list
 * <div role="option" className={cn('flex h-10 items-center px-3', focusRingInset)} />
 * ```
 */

/**
 * The standalone keyboard-focus ring for free-standing controls.
 *
 * @remarks
 * A 2px `ring-ring` ring drawn just outside the element, with the native outline removed. Use on
 * buttons, inputs, triggers, links, and the close affordances inside overlays — anything with
 * room around it. For dense, edge-to-edge rows use {@link focusRingInset} instead.
 */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' as const;

/**
 * The inset keyboard-focus ring for dense rows.
 *
 * @remarks
 * A 1px `ring-ring` ring drawn *inside* the element's box (`ring-inset`), with the native outline
 * removed. Use on list rows, menu items, picker options, and other elements packed flush against
 * their neighbours, where {@link focusRing}'s outer 2px ring would overlap the adjacent row.
 */
export const focusRingInset =
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset' as const;
