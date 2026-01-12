import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * MD3 Button Component
 *
 * Five button types per Material Design 3:
 * - Elevated: Surface container with shadow (medium emphasis)
 * - Filled: Primary container (high emphasis)
 * - Tonal (Filled Tonal): Secondary container (medium-high emphasis)
 * - Outlined: Transparent with border (medium emphasis)
 * - Text: No background (low emphasis)
 *
 * @see https://m3.material.io/components/buttons/specs
 */

const buttonVariants = cva(
  // Base styles - MD3 common button properties
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-medium rounded-full cursor-pointer select-none',
    'transition-colors duration-200',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:cursor-not-allowed',
  ].join(' '),
  {
    variants: {
      variant: {
        // MD3 Elevated Button - surface container with shadow
        elevated: [
          'bg-surface-container-low text-primary shadow-md',
          'hover:bg-surface-container hover:shadow-lg',
          'active:bg-surface-container-high',
          'disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none',
        ].join(' '),
        // MD3 Filled Button - high emphasis, primary actions
        filled: [
          'bg-primary text-on-primary shadow-sm',
          'hover:bg-primary/90 hover:shadow-md',
          'active:bg-primary/80',
          'disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none',
        ].join(' '),
        // MD3 Filled Tonal Button - medium-high emphasis
        tonal: [
          'bg-secondary-container text-on-secondary-container',
          'hover:bg-secondary-container/80',
          'active:bg-secondary-container/70',
          'disabled:bg-on-surface/12 disabled:text-on-surface/38',
        ].join(' '),
        // MD3 Outlined Button - medium emphasis
        outlined: [
          'border border-outline bg-transparent text-primary',
          'hover:bg-primary/8',
          'active:bg-primary/12',
          'disabled:border-on-surface/12 disabled:text-on-surface/38',
        ].join(' '),
        // MD3 Text Button - low emphasis
        text: [
          'bg-transparent text-primary',
          'hover:bg-primary/8',
          'active:bg-primary/12',
          'disabled:text-on-surface/38',
        ].join(' '),
      },
      size: {
        sm: 'h-8 px-3 gap-1.5 text-label-sm',
        md: 'h-10 px-6 gap-2 text-label-lg',
        lg: 'h-12 px-8 gap-2.5 text-label-lg',
        icon: 'h-10 w-10 p-0',
        'icon-sm': 'h-8 w-8 p-0',
        'icon-lg': 'h-12 w-12 p-0',
      },
    },
    defaultVariants: {
      variant: 'filled',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
