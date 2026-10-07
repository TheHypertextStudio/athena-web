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
 * Composable tonal card with an optional outline for a semantic boundary.
 *
 * @remarks
 * In the MD3 tonal system a card sits ABOVE a `bg-surface` panel, so it steps up the
 * container ramp (`surface-container-low`). The same utility reads correctly in both light
 * (a darker step) and dark (a lighter step) because the surface tokens encode that direction.
 *
 * Ordinary cards use the tonal step alone. The outlined variant identifies an independent
 * movable object whose boundary must remain visible beside other objects at the same tone.
 * The primitive owns that outline so product code does not recreate border styles.
 */
export function Card({
  className,
  variant = 'tonal',
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'tonal' | 'outlined';
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'bg-surface-container-low text-on-surface rounded-xl',
        variant === 'outlined' && 'border-outline-variant/50 border',
        className,
      )}
      data-surface-tone="card"
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
