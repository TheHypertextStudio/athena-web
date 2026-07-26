/**
 * `@docket/ui` — Button primitive (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source. Uses
 * `class-variance-authority` for variant/size styling and Radix `Slot` so callers can
 * render the button styles onto a child element via `asChild`. All colors come from the
 * semantic design tokens in `@docket/ui/styles/globals.css`.
 */
import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils';
import { focusRing } from './focus';

/**
 * Class-variance-authority recipe for {@link Button}.
 *
 * @remarks
 * Exposes `variant` (`default` | `elevated` | `destructive` | `outline` | `secondary` | `ghost` |
 * `link`) and `size` (`default` | `sm` | `lg` | `icon`). Exported so callers can apply
 * button styling to non-button elements (e.g. an anchor) without rendering a `Button`.
 * The keyboard-focus treatment is the shared standalone {@link focusRing}.
 *
 * MD3 (Material Design 3, including the 2025 Expressive refresh) treats a shadow/elevation as ONE
 * specific button style — the dedicated **Elevated** button, used sparingly (e.g. a button
 * floating over a busy or colored surface that needs visual separation) — never the resting state
 * of a Filled, Filled Tonal, Outlined, or Text button. This recipe previously carried `shadow`/
 * `shadow-sm` on `default`/`destructive`/`outline`/`secondary` (a shadcn default, not an MD3 one),
 * so every button in the app read as "raised" regardless of context. Those variants are now flat
 * (Filled / Filled Tonal / Outlined, per MD3), and `elevated` is a new, explicit opt-in for the
 * rare case that genuinely wants the shadow treatment.
 */
export const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-body-medium font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-6 [&_svg]:shrink-0',
    focusRing,
  ),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        elevated:
          'bg-surface-container-low text-primary shadow-sm hover:bg-surface-container hover:shadow',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border-outline-variant border bg-transparent hover:bg-surface-container-high hover:text-on-surface',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-surface-container-high hover:text-on-surface',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/** Props for {@link Button}: native button props plus the CVA variants and `asChild`. */
export interface ButtonProps
  extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** When `true`, render styling onto the single child element via Radix `Slot`. */
  asChild?: boolean;
}

/**
 * Themeable button. Pass `asChild` to apply button styling to a custom child element
 * (e.g. a Next.js `Link`) instead of rendering a native `<button>`.
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps): React.JSX.Element {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
