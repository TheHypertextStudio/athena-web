'use client';

/**
 * `@docket/ui` — the Chip primitive: the *only* pill-shaped structure in the product.
 *
 * @remarks
 * ## The defect this replaces
 *
 * The new-initiative dialog shipped nine pills in three families: 28px template pills, 32px value
 * pills, and 36px property pills with 24px plus-icons — three heights, two padding pairs, and six
 * pills carrying no icon at all ("Blank", "Strategic initiative", "Objective", "Active", "No
 * priority", "Monthly updates"). The new-task dialog repeated it at 20/28/36px. Each pill was
 * locally reasonable; together they read as three design systems in one dialog.
 *
 * ## What MD3 actually specifies
 *
 * Verified against the Material Web token source
 * (`tokens/versions/v0_192/_md-comp-{assist,filter,input,suggestion}-chip.scss`) and the
 * Material Components Android chip spec, not from memory:
 *
 * | Property | MD3 value | Docket |
 * |---|---|---|
 * | container height | `32dp`, identical for all four chip types | the `md` control step, 32px |
 * | container shape | `corner-small` = `8dp` — chips are **not** pills | {@link CONTROL_RADIUS}, 8px |
 * | label type | `label-large` (14 / 20, weight 500, tracking 0.1) | `label-large` at `md` |
 * | leading icon | `18dp` | 18px at `md` |
 * | icon → label gap | `8dp` | `gap-2` at `md` |
 * | leading / trailing space | `16dp`, or `8dp` when a leading icon is present | constant `12px` (see below) |
 * | outline | `1dp` unselected; `0dp` when selected | tonal fill by default; outline optional |
 * | elevation | `level0` — flat. Only the separate "elevated chip" carries `level1` | always flat |
 *
 * Two deliberate deviations, both documented rather than drifted into:
 *
 * 1. **Corner radius is 8px, not a pill.** This is MD3's actual answer to "be more intentional
 *    about pill-like structures": `corner-full` belongs to avatars and count badges, and a chip
 *    that is fully round reads as a badge — a thing you look at — rather than a chip, a thing you
 *    press. {@link Badge} keeps `rounded-full`; chips do not.
 * 2. **Padding does not shrink when an icon is present.** MD3 drops leading space from 16dp to
 *    8dp for icon-ed chips. That is right for a free-floating mobile chip set and wrong for
 *    Docket, where chips stack in property rows: an icon-ed chip and an icon-less chip in adjacent
 *    rows would start their content on two different vertical axes. Constant padding preserves the
 *    axis. See `control.tsx` for the same reasoning applied across the scale.
 * 3. **A filter chip's leading slot is always occupied.** MD3 filter chips grow horizontally when
 *    the selected checkmark appears. The launch bar forbids an interactive element changing size,
 *    so Docket's filter chip *swaps* its own icon for the checkmark instead of inserting one. Same
 *    width, selected or not.
 *
 * ## How icon-less chips are prevented
 *
 * {@link ChipProps} is a discriminated union: a chip must supply `icon`, or `avatar`, or an
 * explicit `leadingNone` naming one of exactly two {@link ChipLeadingExemption} reasons. There is
 * no fourth option, so `<Chip>No priority</Chip>` does not type-check. The exemptions are
 * greppable (`grep -rn 'leadingNone' apps/`) and each is justified against the MD3 spec above:
 * `md3-suggestion-chip` is the one chip type MD3 itself defines without a leading icon, and
 * `overflow-count` is the "+3 more" affordance where a glyph would compete with the number that
 * *is* the content.
 *
 * @example
 * ```tsx
 * // Property chip that opens a picker.
 * <DropdownMenuTrigger asChild>
 *   <Chip icon={<Flag />} variant="assist">No priority</Chip>
 * </DropdownMenuTrigger>
 *
 * // Filter chip — same width selected or not.
 * <Chip variant="filter" icon={<User />} selected={mine} onClick={toggle}>Assigned to me</Chip>
 *
 * // Entity chip with a remove affordance.
 * <Chip variant="input" avatar={<Avatar …/>} onRemove={() => unassign(id)}>Alex Kim</Chip>
 * ```
 */
import { Slot, Slottable } from '@radix-ui/react-slot';
import * as React from 'react';

import { Check, X } from '../icons';
import { cn } from '../lib/utils';
import { CONTROL, CONTROL_RADIUS, type ControlSize, useControlSize } from './control';
import { focusRing } from './focus';
import { typeClass } from './text';

/**
 * The four MD3 chip types. Each answers a different question, and picking the right one is the
 * whole point of having four.
 *
 * @remarks
 * - `assist` — *"do something to this object."* The default. A property chip that opens a picker
 *   ("No priority", "+ Set owner") is an assist chip: it carries a leading icon naming the
 *   property and acts when pressed.
 * - `filter` — *"narrow what I am looking at."* Toggleable. Shows a checkmark in its leading slot
 *   when selected and reverts to its own icon when not.
 * - `input` — *"here is a discrete thing you chose."* Represents an entity (a person, a label, a
 *   project) inside a field or a property row, usually with an avatar and a remove affordance.
 * - `suggestion` — *"here is something you might want."* Dynamically generated, lowest emphasis,
 *   and the one type MD3 defines without a required leading icon.
 */
export const CHIP_VARIANTS = ['assist', 'filter', 'input', 'suggestion'] as const;

/** One of the four MD3 chip types. See {@link CHIP_VARIANTS}. */
export type ChipVariant = (typeof CHIP_VARIANTS)[number];

/**
 * The two chip surface treatments.
 *
 * @remarks
 * `tonal` is the default because the launch bar demands borders be minimised: a tinted container
 * separates the chip from the surface without drawing a line. `outlined` exists for chips that sit
 * *on* an already-tinted container (inside a menu, inside a selected row) where a tonal fill would
 * not read. There is no elevated/shadowed treatment — MD3's elevated chip is `level1`, and shadows
 * on 32px controls are exactly the "looks really dumb" case.
 */
export const CHIP_TONES = ['tonal', 'outlined'] as const;

/** One of the two chip surface treatments. See {@link CHIP_TONES}. */
export type ChipTone = (typeof CHIP_TONES)[number];

/**
 * The complete, closed set of reasons a chip may render without a leading icon or avatar.
 *
 * @remarks
 * - `md3-suggestion-chip` — MD3's suggestion chip is specified without a leading icon; the chip's
 *   whole content is the suggested text. Only valid with `variant="suggestion"`.
 * - `overflow-count` — the "+3" affordance that stands for hidden siblings. The number is the
 *   content; a glyph beside it would read as a fifth item rather than a count.
 *
 * Adding a third reason is a design-system change and requires updating the MD3 mapping in
 * `docs/design/design-system.md`, which is what makes this an intentional escape rather than an
 * ignore list.
 */
export type ChipLeadingExemption = 'md3-suggestion-chip' | 'overflow-count';

/** Chip properties that do not depend on which leading element the chip carries. */
interface ChipOwnProps {
  /**
   * Height step. Omit to inherit from the enclosing `ControlGroup` — which is how a chip ends up
   * the same height as the button beside it without anyone measuring.
   */
  readonly controlSize?: ControlSize;
  /** Which MD3 chip type this is. Default `assist`. */
  readonly variant?: ChipVariant;
  /** Surface treatment. Default `tonal`. */
  readonly tone?: ChipTone;
  /** Selected state. Meaningful for `filter` and `input`; renders the MD3 selection role. */
  readonly selected?: boolean;
  /**
   * Remove handler. Renders MD3's trailing remove affordance and restructures the chip into a
   * primary action plus a trailing action, because a `<button>` may not contain a `<button>`.
   */
  readonly onRemove?: () => void;
  /** Accessible name for the remove affordance. Required whenever `onRemove` is supplied. */
  readonly removeLabel?: string;
  /** Render chip styling onto the single child element via Radix `Slot` (menu triggers, links). */
  readonly asChild?: boolean;
  /** The chip's label. */
  readonly children: React.ReactNode;
}

/**
 * The leading-element discriminated union — the mechanism that makes an accidental icon-less chip
 * a type error rather than a screenshot finding.
 */
type ChipLeadingProps =
  | {
      /** Leading glyph naming the property, action, or filter this chip stands for. */
      readonly icon: React.ReactNode;
      readonly avatar?: never;
      readonly leadingNone?: never;
    }
  | {
      /** Leading avatar or status glyph identifying the entity this chip stands for. */
      readonly avatar: React.ReactNode;
      readonly icon?: never;
      readonly leadingNone?: never;
    }
  | {
      /** Named, documented justification for rendering no leading element. */
      readonly leadingNone: ChipLeadingExemption;
      readonly icon?: never;
      readonly avatar?: never;
    };

/** Props for {@link Chip}. */
export type ChipProps = ChipOwnProps &
  ChipLeadingProps &
  Omit<React.ComponentProps<'button'>, 'children' | 'color'>;

/** Surface classes for the chip container, by tone and selection state. */
function chipSurface(tone: ChipTone, selected: boolean): string {
  if (selected) {
    // MD3 sets the selected chip's outline width to 0 and fills with the selection role. Keeping a
    // transparent border preserves the box size so selecting a chip never nudges its neighbours.
    return 'bg-secondary-container text-on-secondary-container border border-transparent hover:bg-secondary-container/80';
  }
  return tone === 'outlined'
    ? 'border-outline-variant text-on-surface border bg-transparent hover:bg-surface-container-high'
    : 'bg-surface-container-high text-on-surface border border-transparent hover:bg-surface-container-highest';
}

/**
 * A chip: a compact, pressable representation of a property, a filter, an entity, or a suggestion.
 *
 * @param props - See {@link ChipProps}. Exactly one of `icon`, `avatar`, or `leadingNone` is
 *   required by the type system.
 * @returns A `<button>` (or, when `onRemove` is supplied, a `<span>` wrapping two buttons).
 *
 * @remarks
 * Renders no shadow in any state and never changes size on hover, focus, press, or selection.
 * State is communicated entirely by the container's colour role plus the shared {@link focusRing}.
 */
export function Chip({
  controlSize,
  variant = 'assist',
  tone = 'tonal',
  selected = false,
  onRemove,
  removeLabel,
  asChild = false,
  icon,
  avatar,
  leadingNone,
  className,
  children,
  type,
  ...props
}: ChipProps): React.JSX.Element {
  const size = useControlSize(controlSize);
  const metrics = CONTROL[size];

  // A filter chip's leading slot is reserved whether or not it is selected, so toggling swaps the
  // glyph instead of resizing the chip.
  const leading =
    variant === 'filter' && selected ? <Check aria-hidden /> : (icon ?? avatar ?? null);

  const container = cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors select-none',
    metrics.height,
    metrics.paddingX,
    metrics.gap,
    CONTROL_RADIUS,
    typeClass(metrics.labelToken),
    metrics.iconApply,
    '[&_svg]:shrink-0 [&_svg]:pointer-events-none',
    chipSurface(tone, selected),
    'disabled:pointer-events-none disabled:opacity-50',
    className,
  );

  const label = <span className="min-w-0 truncate">{children}</span>;

  if (onRemove) {
    // MD3 input chips carry a trailing remove action. HTML forbids a `<button>` inside a
    // `<button>`, so the chip becomes a group: the container keeps the chrome (height, padding,
    // radius, fill), and the two actions sit inside it carrying no padding of their own beyond the
    // remove affordance's 4px hit-area cushion. The rendered height is still `metrics.height`.
    return (
      <span
        className={container}
        data-chip-variant={variant}
        data-selected={selected ? '' : undefined}
      >
        <button
          type="button"
          className={cn(
            'inline-flex h-full min-w-0 items-center',
            metrics.gap,
            CONTROL_RADIUS,
            focusRing,
          )}
          {...props}
        >
          {leading}
          {label}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className={cn(
            'hover:text-on-surface text-on-surface-variant inline-flex h-full items-center px-1 transition-colors',
            CONTROL_RADIUS,
            focusRing,
          )}
        >
          <X aria-hidden />
        </button>
      </span>
    );
  }

  const shared = {
    className: cn(container, focusRing),
    'data-chip-variant': variant,
    'data-leading-exemption': leadingNone,
    'data-selected': selected ? '' : undefined,
    'aria-pressed': variant === 'filter' ? selected : undefined,
  } as const;

  if (asChild) {
    // `Slottable` marks which child is the element to merge onto, so the leading glyph is injected
    // *inside* the caller's element rather than replacing it. Without it, `Slot` would reject the
    // two-child structure the chip anatomy requires.
    return (
      <Slot {...shared} {...props}>
        {leading}
        <Slottable>{children}</Slottable>
      </Slot>
    );
  }

  return (
    <button type={type ?? 'button'} {...shared} {...props}>
      {leading}
      {label}
    </button>
  );
}
