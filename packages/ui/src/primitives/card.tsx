/**
 * `@docket/ui` — Card primitive family (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source. A composable surface:
 * {@link Card} wraps {@link CardHeader} / {@link CardTitle} / {@link CardDescription} /
 * {@link CardContent} / {@link CardFooter}. All colors come from the semantic design
 * tokens in `@docket/ui/styles/globals.css`.
 */
import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Outer card surface — rounded, hairline-outlined, token-colored container.
 *
 * @remarks
 * In the MD3 tonal system a card sits ABOVE a `bg-surface` panel, so it steps up the
 * container ramp (`surface-container-low`). The same utility reads correctly in both light
 * (a darker step) and dark (a lighter step) because the surface tokens encode that direction.
 *
 * The hairline border and the `shadow-sm` this used to carry are both gone. A tonal step already
 * separates the card from the panel underneath it, so the border was a second, redundant
 * separator and the shadow was a third — and a grid of shadowed cards is the single most reliable
 * way to make a dense product look like a template. Where a card genuinely needs a hard edge (it
 * sits on a surface at the same tone), reach for `border-outline-variant` explicitly at that
 * callsite and say why; do not put it back here.
 */
export function Card({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      className={cn('bg-surface-container-low text-on-surface rounded-xl', className)}
      {...props}
    />
  );
}

/** Card header region — vertical stack with padding, typically holds title + description. */
export function CardHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1 p-4', className)} {...props} />;
}

/**
 * Card title — the heading inside a {@link CardHeader}.
 *
 * @remarks
 * `title-medium` (16 / 24, weight 500) — one MD3 role, which sets size, line-height, weight, and
 * tracking together. It replaces `leading-none font-semibold tracking-tight`: three raw utilities
 * that together described a type style nobody named and nothing else in the product shared.
 */
export function CardTitle({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('text-title-medium', className)} {...props} />;
}

/** Card description — muted supporting text within a {@link CardHeader}. */
export function CardDescription({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('text-on-surface-variant text-body-medium', className)} {...props} />;
}

/** Card content region — padded body below the header. */
export function CardContent({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('p-4 pt-0', className)} {...props} />;
}

/** Card footer region — padded action row, typically holds buttons. */
export function CardFooter({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('flex items-center p-4 pt-0', className)} {...props} />;
}
