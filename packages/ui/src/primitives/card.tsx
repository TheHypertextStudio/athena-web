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

/** Outer card surface — rounded, bordered, token-colored container. */
export function Card({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      className={cn('bg-card text-card-foreground rounded-xl border shadow', className)}
      {...props}
    />
  );
}

/** Card header region — vertical stack with padding, typically holds title + description. */
export function CardHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />;
}

/** Card title — prominent heading text within a {@link CardHeader}. */
export function CardTitle({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('font-semibold leading-none tracking-tight', className)} {...props} />;
}

/** Card description — muted supporting text within a {@link CardHeader}. */
export function CardDescription({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('text-muted-foreground text-sm', className)} {...props} />;
}

/** Card content region — padded body below the header. */
export function CardContent({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}

/** Card footer region — padded action row, typically holds buttons. */
export function CardFooter({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('flex items-center p-6 pt-0', className)} {...props} />;
}
