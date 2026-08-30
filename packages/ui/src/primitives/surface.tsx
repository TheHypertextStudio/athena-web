'use client';

/**
 * `@docket/ui` — `Surface`, the named tonal container.
 *
 * @remarks
 * The design system separates regions with a step on the tonal ramp rather than with a border, and
 * `docs/design/design-system.md` names that ramp — `surface` → `surface-container-low` →
 * `surface-container` → `surface-container-high` → `surface-container-highest`. Until now every
 * call site spelled its step out as a raw `bg-surface-container-high` utility, which meant the
 * ramp existed as a convention that each screen re-implemented, and reading a component told you
 * *which colour* it used rather than *what it was*.
 *
 * `Surface` is that step as a component. A caller names the role — a `card`, a `well`, or a
 * floating region — and the component owns the token, the radius, and the fact that none of
 * them draw a border. Changing what "card" means then happens here rather than in ninety files.
 *
 * It is polymorphic through `as`, so a surface can be the `header`, `aside`, `li`, or `section`
 * the markup actually calls for without losing its landmark semantics.
 *
 * @example
 * ```tsx
 * <Surface tone="card" as="header">…</Surface>
 * <Surface tone="card" pad="comfortable">…</Surface>
 * <Surface tone="prominent" pad="tight">Dependency removed</Surface>
 * ```
 */
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * The tonal steps a surface can take, in ramp order.
 *
 * @remarks
 * Each name is one step on the ramp, and no two names share a step. `canvas` frames the workspace,
 * `page` holds route content, `well` recedes beneath a page, `card` raises inset furniture one
 * step, `floating` owns a dialog or panel, and `prominent` clears another floating surface.
 *
 * ## Why an app bar is `card`, one step from `page`, and not two
 *
 * The app shell paints a `surface-container` backdrop and floats the route's content on it as a
 * rounded `surface` card. An app bar therefore lives *inside* that content card, and taking
 * `surface-container` for it paints the bar the same colour as the backdrop *behind* the card —
 * which is exactly how it looked: the card's top edge dissolved into the shell gutter and the bar
 * read as part of the window rather than as part of the page. One step up from `page` separates a
 * bar from the content below it without colliding with the frame around it.
 */
const SURFACE_TONE = {
  canvas: 'bg-surface-container text-on-surface',
  page: 'bg-surface text-on-surface',
  well: 'bg-surface-container-lowest text-on-surface',
  card: 'bg-surface-container-low text-on-surface',
  floating: 'bg-surface-container-high text-on-surface',
  prominent: 'bg-surface-container-highest text-on-surface',
} as const;

/** The closed semantic roles for resting surface regions. */
export const SURFACE_TONES = ['canvas', 'page', 'well', 'card', 'floating', 'prominent'] as const;

/** A surface's tonal step. */
export type SurfaceTone = (typeof SURFACE_TONES)[number];

/** Return the utility classes assigned to one documented surface role. */
export function surfaceToneColor(tone: SurfaceTone): string {
  return SURFACE_TONE[tone];
}

/** Return the CSS custom property that supplies one documented surface role. */
export function surfaceToneVariable(tone: SurfaceTone): string {
  const variables: Readonly<Record<SurfaceTone, string>> = {
    canvas: '--surface-container',
    page: '--surface',
    well: '--surface-container-lowest',
    card: '--surface-container-low',
    floating: '--surface-container-high',
    prominent: '--surface-container-highest',
  };
  return variables[tone];
}

const surfaceVariants = cva('min-w-0', {
  variants: {
    tone: SURFACE_TONE,
    /** Corner radius, from the MD3 shape scale. `none` is for full-bleed regions such as a band. */
    shape: {
      none: 'rounded-none',
      small: 'rounded-lg',
      medium: 'rounded-xl',
      large: 'rounded-2xl',
    },
    /** Internal inset. Kept to three steps so surfaces do not each invent their own padding. */
    pad: {
      none: '',
      tight: 'p-2',
      comfortable: 'p-3',
      roomy: 'p-4',
    },
  },
  defaultVariants: { tone: 'card', shape: 'medium', pad: 'none' },
});

/** The elements a surface may render as. A surface is a region, never a control. */
export type SurfaceElement =
  | 'div'
  | 'section'
  | 'header'
  | 'footer'
  | 'aside'
  | 'nav'
  | 'main'
  | 'article'
  | 'figure'
  | 'label'
  | 'li'
  | 'ul';

/** Props for {@link Surface}. */
export interface SurfaceProps
  extends
    Omit<React.ComponentPropsWithoutRef<'div'>, 'color'>,
    VariantProps<typeof surfaceVariants> {
  /** The element to render. Defaults to `div`; pass a landmark when the markup calls for one. */
  as?: SurfaceElement;
  /** Associate a label surface with its form control. */
  htmlFor?: string;
}

/**
 * A named tonal region.
 *
 * @remarks
 * The variant is `tone`, not `role`: `role` is a reserved ARIA attribute, and a component that
 * shadowed it would make the accessible role unspellable on any surface.
 *
 * @param props - The {@link SurfaceProps}: a `tone`, plus optional `shape` and `pad`.
 * @returns the surface element wrapping `children`.
 */
export function Surface({
  as: Element = 'div',
  tone,
  shape,
  pad,
  className,
  ...props
}: SurfaceProps): React.JSX.Element {
  const Component = Element as React.ElementType;
  const resolvedTone = tone ?? 'card';
  return (
    <Component
      className={cn(surfaceVariants({ tone: resolvedTone, shape, pad }), className)}
      data-surface-tone={resolvedTone}
      {...props}
    />
  );
}
