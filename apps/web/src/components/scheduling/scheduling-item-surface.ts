/**
 * `scheduling/scheduling-item-surface` — the one fill recipe every scheduled block is painted with.
 *
 * @remarks
 * The calendar exists to show events and time blocks, so those blocks have to be the first thing the
 * eye resolves. They were not. A resting card used `bg-surface-container-low` on a `bg-surface`
 * canvas, which measures **1.04:1** in light and **1.16:1** in dark — below the threshold at which a
 * fill is perceptible at all. An event was distinguishable from empty time only by its 4px colour
 * stripe and its text, so a squint test resolved the toolbar, the rail and the hour gutter before it
 * resolved a single meeting.
 *
 * The fix is one recipe, expressed as a mix rather than as a token, for a reason the tonal ramp makes
 * unavoidable: `--surface` is the *brightest* tone in light mode and a *mid* tone in dark, so no
 * single container step moves in the visible direction in both themes. `--color-on-surface` does —
 * it is dark under a light theme and light under a dark one — so mixing a fixed share of it into the
 * canvas darkens the block in light and lightens it in dark, by construction, with one expression.
 *
 * ## The two shares, and what they guarantee
 *
 * - {@link NEUTRAL_FILL_SHARE} is the floor. Every block, coloured or not, is at least this far off
 *   the canvas. Measured on the running app it lands near **1.7:1** in both themes — a step you can
 *   see from across the room, well short of the heavy "solid colour block" that would make a busy
 *   day unreadable.
 * - {@link LAYER_TINT_SHARE} is deliberately a *minority* share. A layer colour shifts the block's
 *   hue so two calendars are told apart at a glance, but cannot wash the tonal step back out: at 25%
 *   even a near-white layer colour keeps roughly 1.4:1 in light, and the 4px full-strength stripe
 *   still carries the layer's exact colour for identity.
 *
 * Contrast is measured, not asserted: `apps/web/tests/scheduling/scheduling-item-surface.test.ts`
 * evaluates these expressions and fails if either theme drops below the documented floor.
 *
 * @see {@link file://./scheduling-item-card.tsx} for the timed block that consumes this.
 * @see `docs/design/design-system.md` for the tonal ramp these shares are chosen against.
 */

/**
 * Share of `--color-on-surface` mixed into the canvas for a block's resting fill.
 *
 * @remarks
 * Chosen as the smallest share that clears 1.5:1 against `--color-surface` in *both* themes. Below
 * ~18% the light theme falls under 1.5:1 (the light canvas has almost no headroom above it); above
 * ~28% a full day of blocks reads as a wall of grey rather than as objects on a grid.
 */
const NEUTRAL_FILL_SHARE = 22;

/**
 * Share of the layer colour mixed into {@link SCHEDULE_ITEM_FILL}.
 *
 * @remarks
 * A minority share on purpose. The colour is identity, not emphasis — the emphasis is already paid
 * for by the neutral floor, and a majority share would let a pale layer colour undo it.
 */
const LAYER_TINT_SHARE = 25;

/** Extra share of `--color-on-surface` folded in for the hover / focus-within step. */
const RAISE_STEP_SHARE = 8;

/**
 * The resting fill for a block with no layer colour.
 *
 * @remarks
 * `oklab` rather than `srgb`: an sRGB mix of two near-neutral tones drifts in hue and lands at a
 * different perceived lightness than the share suggests, which is exactly what makes a "20% darker"
 * fill look like nothing in light mode.
 */
export const SCHEDULE_ITEM_FILL = `color-mix(in oklab, var(--color-on-surface) ${String(NEUTRAL_FILL_SHARE)}%, var(--color-surface))`;

/**
 * The fill one scheduled block paints, tinted by its calendar layer when it has one.
 *
 * @param color - The layer's colour as the API reports it, or `undefined` for an untinted block.
 * @returns A CSS colour value for `background-color`.
 *
 * @example
 * ```ts
 * scheduleItemFill('#16a34a'); // green-tinted, still a real tonal step off the canvas
 * scheduleItemFill();          // the neutral floor
 * ```
 */
export function scheduleItemFill(color?: string): string {
  if (color === undefined || color.trim().length === 0) return SCHEDULE_ITEM_FILL;
  return `color-mix(in oklab, ${color} ${String(LAYER_TINT_SHARE)}%, ${SCHEDULE_ITEM_FILL})`;
}

/**
 * The fill a block takes on hover or while it holds focus.
 *
 * @remarks
 * One more step of the same neutral, so the raise reads as "this one is under the pointer" without
 * changing hue, size, or elevation. Deliberately small: the resting state already carries the
 * emphasis, and a large hover jump on a grid of blocks reads as flicker while the pointer crosses it.
 *
 * @param color - The layer's colour, or `undefined` for an untinted block.
 * @returns A CSS colour value for `background-color`.
 */
export function scheduleItemRaisedFill(color?: string): string {
  return `color-mix(in oklab, var(--color-on-surface) ${String(RAISE_STEP_SHARE)}%, ${scheduleItemFill(color)})`;
}

/**
 * The colour of a block's 4px identity stripe.
 *
 * @remarks
 * Full strength, never mixed: this is the one place a layer's exact colour appears, so two calendars
 * stay tellable apart even when their tinted fills are neighbours on the same hue.
 *
 * @param color - The layer's colour, or `undefined` for an untinted block.
 * @returns A CSS colour value for `border-left-color`.
 */
export function scheduleItemStripe(color?: string): string {
  if (color === undefined || color.trim().length === 0) return 'var(--color-on-surface-variant)';
  return color;
}
