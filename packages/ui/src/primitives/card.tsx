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
 * container ramp (`surface-container-low`) and uses an `outline-variant` hairline rather
 * than the flat `bg-card` tone (which is near-indistinguishable from the panel). The same
 * utilities read correctly in both light (a darker step) and dark (a lighter step) because
 * the surface tokens encode that direction.
 */
export function Card({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      className={cn(
        'bg-surface-container-low text-on-surface border-outline-variant rounded-xl border shadow-sm',
        className,
      )}
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

/** Card title — prominent heading text within a {@link CardHeader}. */
export function CardTitle({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('leading-none font-semibold tracking-tight', className)} {...props} />;
}

/** Card description — muted supporting text within a {@link CardHeader}. */
export function CardDescription({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('text-on-surface-variant text-body', className)} {...props} />;
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
