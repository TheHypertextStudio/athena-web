'use client';

/**
 * `@docket/ui` — the control-size scale: the single source of truth for how tall an
 * interactive control is, how much it is padded, how big its icon is, and which type token
 * its label uses.
 *
 * @remarks
 * ## Why this module exists
 *
 * The launch review's loudest alignment defect was that controls sitting on the same row
 * disagreed about their own height — a 36px lens switcher next to a 32px "Add filter" next to a
 * 32px "Display", tops at y=117/119/119. Every one of those heights was correct in isolation and
 * chosen locally, which is exactly the failure mode a design system exists to make impossible.
 *
 * The fix is not "remember to use h-8". The fix is that height is **not a per-callsite decision**:
 * a control reads its size from the {@link ControlGroup} it is rendered into, and every control
 * primitive resolves that size through the same {@link CONTROL} table. Two controls in one group
 * therefore cannot differ in height — not because someone checked, but because there is only one
 * number in play.
 *
 * ## The scale
 *
 * Five steps, 4px apart. Anything outside them is not a control.
 *
 * | Step | Height | Padding-x | Gap | Icon | Label token   | Field text token | Use for |
 * |------|--------|-----------|-----|------|---------------|------------------|---------|
 * | `xs` | 24px   | 8px       | 4px | 14px | `label-small`  | `body-small`     | metadata chips *inside* a dense list row |
 * | `sm` | 28px   | 10px      | 6px | 16px | `label-medium` | `body-small`     | dense toolbars, inline row affordances |
 * | `md` | 32px   | 12px      | 8px | 18px | `label-large`  | `body-medium`    | **default** — page toolbars, property chips, filter bars |
 * | `lg` | 36px   | 14px      | 8px | 18px | `label-large`  | `body-medium`    | dialog + settings form fields, menu rows |
 * | `xl` | 40px   | 16px      | 8px | 20px | `label-large`  | `body-large`     | primary dialog actions, the global search field |
 *
 * `md` is 32px because that is MD3's chip container height
 * (`md.comp.assist-chip.container-height = 32dp`, confirmed in the Material Web token source
 * `tokens/versions/v0_192/_md-comp-assist-chip.scss`), and a chip is the most common inline
 * control in this product. Everything else is derived from it so a chip, a button, a select, and a
 * menu trigger standing next to each other agree by construction.
 *
 * ## Deliberate deviation from MD3
 *
 * MD3 shrinks a chip's leading padding from 16dp to 8dp when a leading icon is present
 * (`leading-space: 16px` vs `with-leading-icon-leading-space: 8px`). Docket does **not**: padding
 * is constant per step whether or not an icon is present. MD3's asymmetry is tuned for
 * free-floating mobile chip sets; in Docket, chips sit in stacked property rows and table cells
 * where a 8px-vs-16px difference between an icon-ed row and an icon-less row destroys the shared
 * left alignment axis that the same review demanded. Constant padding keeps the axis; the icon
 * simply occupies the leading slot.
 *
 * Every step's padding is >= 8px, which is the minimum text/icon inset the launch bar requires, so
 * no control can render text flush against its own edge at any size.
 *
 * @example
 * ```tsx
 * // Every child of this group is 32px tall. Not by convention — by construction.
 * <ControlGroup controlSize="md">
 *   <Button>Save</Button>
 *   <Chip icon={<Filter />}>Assigned to me</Chip>
 *   <Select controlSize={undefined} aria-label="Display">…</Select>
 * </ControlGroup>
 * ```
 *
 * @see {@link ControlGroup} for the context provider.
 * @see {@link useControlSize} for reading the resolved size inside a primitive.
 */
import * as React from 'react';

import { cn } from '../lib/utils';
import { type TypeToken, typeClass } from './text';

/**
 * Every control size the design system defines, smallest first.
 *
 * @remarks
 * Ordered, so a consumer can step up/down the scale (`CONTROL_SIZES[index + 1]`) without
 * hardcoding names. A sixth step is a design-system change, not a callsite change.
 */
export const CONTROL_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

/** One of the five control-height steps. See {@link CONTROL_SIZES}. */
export type ControlSize = (typeof CONTROL_SIZES)[number];

/** The default step used when no {@link ControlGroup} and no explicit `controlSize` is present. */
export const DEFAULT_CONTROL_SIZE: ControlSize = 'md';

/**
 * The resolved metrics for one control-size step.
 *
 * @remarks
 * Every field is a complete Tailwind utility string (not a fragment), so a primitive composes it
 * with {@link cn} and never concatenates class names from parts — string concatenation is what
 * defeats Tailwind's static extractor and produces classes that silently do not exist.
 */
export interface ControlMetrics {
  /** Fixed block height, e.g. `h-8`. Use on controls that must not grow. */
  readonly height: string;
  /** The same height as a minimum, e.g. `min-h-8`. Use on controls that may wrap. */
  readonly minHeight: string;
  /** Square width for an icon-only control, e.g. `w-8`. */
  readonly width: string;
  /** The rendered height in CSS pixels. Mirrors the `--control-h-*` custom properties. */
  readonly heightPx: number;
  /** Horizontal padding, e.g. `px-3`. Constant whether or not a leading icon is present. */
  readonly paddingX: string;
  /** Horizontal padding in CSS pixels — never below the 8px minimum-inset floor. */
  readonly paddingXPx: number;
  /** Gap between a leading icon, the label, and any trailing affordance, e.g. `gap-2`. */
  readonly gap: string;
  /**
   * Icon sizing utility, e.g. `size-4.5`.
   *
   * @remarks
   * Carries Tailwind's trailing `!` because `@mui/icons-material` injects a `1.5rem` default
   * through an Emotion `@layer mui` stylesheet that wins a load-order race against this package's
   * external stylesheet — see the header comment in `styles/globals.css`. A bare `size-*` on an
   * MUI glyph renders at 24px regardless of layer order; the important flag is the only reliable
   * fix.
   */
  readonly icon: string;
  /**
   * The same icon sizing, pre-scoped to descendant `<svg>` elements, e.g. `[&_svg]:size-4.5!`.
   *
   * @remarks
   * Stored as a complete literal rather than composed at runtime from {@link ControlMetrics.icon}.
   * Tailwind v4 extracts class names by scanning source text, so a template literal like
   * `` `[&_svg]:${metrics.icon}` `` produces a class that is never generated and silently does
   * nothing. Every entry in this table is a literal for that reason.
   */
  readonly iconApply: string;
  /** The rendered icon edge length in CSS pixels. */
  readonly iconPx: number;
  /** MD3 type token for a control's own label (buttons, chips, tabs). */
  readonly labelToken: TypeToken;
  /** MD3 type token for user-entered text inside a field (inputs, textareas, selects). */
  readonly fieldToken: TypeToken;
}

/**
 * The scale itself — the one table every control primitive resolves through.
 *
 * @remarks
 * Frozen at the type level (`as const` + `readonly`) so a consumer cannot mutate a step at
 * runtime and desynchronise two controls that both read it.
 */
export const CONTROL: Readonly<Record<ControlSize, ControlMetrics>> = {
  xs: {
    height: 'h-6',
    minHeight: 'min-h-6',
    width: 'w-6',
    heightPx: 24,
    paddingX: 'px-2',
    paddingXPx: 8,
    gap: 'gap-1',
    icon: 'size-3.5!',
    iconApply: '[&_svg]:size-3.5!',
    iconPx: 14,
    labelToken: 'label-small',
    fieldToken: 'body-small',
  },
  sm: {
    height: 'h-7',
    minHeight: 'min-h-7',
    width: 'w-7',
    heightPx: 28,
    paddingX: 'px-2.5',
    paddingXPx: 10,
    gap: 'gap-1.5',
    icon: 'size-4!',
    iconApply: '[&_svg]:size-4!',
    iconPx: 16,
    labelToken: 'label-medium',
    fieldToken: 'body-small',
  },
  md: {
    height: 'h-8',
    minHeight: 'min-h-8',
    width: 'w-8',
    heightPx: 32,
    paddingX: 'px-3',
    paddingXPx: 12,
    gap: 'gap-2',
    icon: 'size-4.5!',
    iconApply: '[&_svg]:size-4.5!',
    iconPx: 18,
    labelToken: 'label-large',
    fieldToken: 'body-medium',
  },
  lg: {
    height: 'h-9',
    minHeight: 'min-h-9',
    width: 'w-9',
    heightPx: 36,
    paddingX: 'px-3.5',
    paddingXPx: 14,
    gap: 'gap-2',
    icon: 'size-4.5!',
    iconApply: '[&_svg]:size-4.5!',
    iconPx: 18,
    labelToken: 'label-large',
    fieldToken: 'body-medium',
  },
  xl: {
    height: 'h-10',
    minHeight: 'min-h-10',
    width: 'w-10',
    heightPx: 40,
    paddingX: 'px-4',
    paddingXPx: 16,
    gap: 'gap-2',
    icon: 'size-5!',
    iconApply: '[&_svg]:size-5!',
    iconPx: 20,
    labelToken: 'label-large',
    fieldToken: 'body-large',
  },
} as const;

/**
 * The corner radius every *control* uses: 8px (`--radius-md`).
 *
 * @remarks
 * MD3 gives chips `corner-small` (8dp) and text fields `corner-extra-small` (4dp). Docket applies
 * 8dp to both, and to buttons and menu triggers, because a 32px-tall row of mixed controls with
 * two different radii reads as two design systems. Containers (menus, dialogs, popovers, cards)
 * step up to {@link CONTAINER_RADIUS} so nesting reads correctly; `rounded-full` is reserved for
 * avatars and count badges and is never used for a chip.
 */
export const CONTROL_RADIUS = 'rounded-md' as const;

/** The corner radius every floating container uses: 10px (`--radius-lg`). */
export const CONTAINER_RADIUS = 'rounded-lg' as const;

/**
 * Channel carrying the ambient control size from a {@link ControlGroup} to its descendants.
 *
 * @remarks
 * `undefined` means "no group above me" so {@link useControlSize} can distinguish an absent
 * provider from a provider that deliberately selected the default step.
 */
const ControlSizeContext = React.createContext<ControlSize | undefined>(undefined);

/** Props for {@link ControlGroup}. */
export interface ControlGroupProps extends React.HTMLAttributes<HTMLElement> {
  /** The step every descendant control adopts unless it overrides `controlSize` itself. */
  readonly controlSize?: ControlSize;
  /** The element to render (default `div`); use to keep semantics (`nav`, `header`, …). */
  readonly as?: React.ElementType;
  /**
   * Lay the group out horizontally (default) or vertically.
   *
   * @remarks
   * A vertical group still shares one height step, which is what makes a stacked settings form's
   * fields agree with the buttons beneath it.
   */
  readonly orientation?: 'horizontal' | 'vertical';
  /** Allow the row to wrap onto multiple lines. Wrapped lines keep the same height step. */
  readonly wrap?: boolean;
}

/**
 * A row (or column) of controls that all share one height step.
 *
 * @remarks
 * Supplies `items-center` and the step's {@link ControlMetrics.gap} itself, so children never
 * declare their own alignment or spacing — the parent owns the group's geometry. This is the
 * primitive that makes "things inline with each other have identical heights" a structural
 * property rather than a review comment.
 *
 * @param props - See {@link ControlGroupProps}.
 * @returns A flex container that publishes its control size to descendants.
 *
 * @example
 * ```tsx
 * <ControlGroup controlSize="sm" wrap>
 *   <Chip icon={<User />}>Alex</Chip>
 *   <Chip icon={<Calendar />}>Due Friday</Chip>
 * </ControlGroup>
 * ```
 */
export function ControlGroup({
  as: Component = 'div',
  controlSize,
  orientation = 'horizontal',
  wrap = false,
  className,
  children,
  ...props
}: ControlGroupProps): React.JSX.Element {
  const inherited = React.useContext(ControlSizeContext);
  const resolved = controlSize ?? inherited ?? DEFAULT_CONTROL_SIZE;
  const metrics = CONTROL[resolved];

  return (
    <ControlSizeContext.Provider value={resolved}>
      <Component
        className={cn(
          'flex min-w-0',
          orientation === 'vertical' ? 'flex-col items-stretch' : 'flex-row items-center',
          wrap && 'flex-wrap',
          metrics.gap,
          className,
        )}
        data-control-size={resolved}
        {...props}
      >
        {children}
      </Component>
    </ControlSizeContext.Provider>
  );
}

/**
 * Resolve the control size a primitive should render at.
 *
 * @param explicit - The primitive's own `controlSize` prop, if the caller passed one.
 * @returns `explicit`, else the nearest {@link ControlGroup}'s size, else
 *   {@link DEFAULT_CONTROL_SIZE}.
 *
 * @remarks
 * Every control primitive in this package calls exactly this function. A primitive that reads a
 * height from anywhere else — a local constant, a `className` override, a prop named `size` — is
 * the bug this module exists to prevent.
 */
export function useControlSize(explicit?: ControlSize): ControlSize {
  const inherited = React.useContext(ControlSizeContext);
  return explicit ?? inherited ?? DEFAULT_CONTROL_SIZE;
}

/**
 * Resolve the full metric set a primitive should render at.
 *
 * @param explicit - The primitive's own `controlSize` prop, if the caller passed one.
 * @returns The {@link ControlMetrics} for the resolved step.
 */
export function useControlMetrics(explicit?: ControlSize): ControlMetrics {
  return CONTROL[useControlSize(explicit)];
}

/**
 * The shared chrome every control renders: box model, alignment, motion, and disabled treatment.
 *
 * @param size - The resolved control step.
 * @param options - Shape overrides for icon-only and free-height controls.
 * @returns A class string carrying height, padding, gap, radius, label type token, and icon sizing.
 *
 * @remarks
 * Note what is **absent** and stays absent: no `shadow-*` in any state, and no `hover:scale-*` /
 * `active:scale-*` / `hover:p-*`. A control never changes its own size to signal interactivity —
 * state is communicated by color (a state layer) and by the focus ring, both of which leave the
 * box untouched. The design-token policy test fails the build if either creeps back in.
 */
export function controlChrome(
  size: ControlSize,
  options?: {
    /** Render a square icon-only control: fixed width, no horizontal padding. */
    readonly iconOnly?: boolean;
    /** Use `min-h-*` instead of `h-*` so the control may grow (wrapping labels, textareas). */
    readonly growable?: boolean;
  },
): string {
  const metrics = CONTROL[size];
  return cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors select-none',
    options?.growable === true ? metrics.minHeight : metrics.height,
    options?.iconOnly === true ? cn(metrics.width, 'px-0') : metrics.paddingX,
    metrics.gap,
    CONTROL_RADIUS,
    typeClass(metrics.labelToken),
    metrics.iconApply,
    '[&_svg]:shrink-0 [&_svg]:pointer-events-none',
    'disabled:pointer-events-none disabled:opacity-50',
  );
}
