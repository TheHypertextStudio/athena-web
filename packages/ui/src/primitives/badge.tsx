/**
 * `@docket/ui` — Badge primitive (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source. Uses
 * `class-variance-authority` for variant styling. All colors come from the semantic
 * design tokens in `@docket/ui/styles/globals.css`.
 */
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Class-variance-authority recipe for {@link Badge}.
 *
 * @remarks
 * Exposes `variant` (`default` | `secondary` | `destructive` | `outline`). Exported so
 * callers can apply badge styling to other elements without rendering a `Badge`.
 */
export const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
        outline: 'text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

/** Props for {@link Badge}: native `<div>` props plus the CVA `variant`. */
export interface BadgeProps
  extends React.ComponentProps<'div'>, VariantProps<typeof badgeVariants> {}

/** Small status/label pill. Select the look with the `variant` prop. */
export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
