import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * MD3 Button Component
 *
 * State layer opacities (MD3 spec):
 * - Hover: 8% state layer
 * - Focus: 12% state layer
 * - Pressed: 12% state layer
 * - Disabled: 12% container opacity, 38% content opacity
 *
 * Composable via `variant` (button type) and `intent` (color scheme).
 */

// =============================================================================
// State Effects (MD3 state layers)
// =============================================================================

const stateLayer = {
  // For filled/tonal: use on-[color] for state layer (shows as brightness change)
  filled: 'hover:shadow-md active:shadow-none transition-shadow',
  // For outline/ghost: use [color] background with opacity for state layer
  transparent: (color: string) =>
    `hover:bg-${color}/8 focus-visible:bg-${color}/12 active:bg-${color}/12`,
};

// =============================================================================
// Disabled States
// =============================================================================

const disabled = {
  filled: 'disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none',
  outlined: 'disabled:border-on-surface/12 disabled:text-on-surface/38',
  text: 'disabled:text-on-surface/38',
};

// =============================================================================
// Color Schemes
// =============================================================================

const colors = {
  primary: {
    filled: 'bg-primary text-on-primary',
    tonal: 'bg-primary-container text-on-primary-container',
    outline: 'border-outline text-primary',
    ghost: 'text-primary',
    elevated: 'bg-surface-container-low text-primary',
    link: 'text-primary',
  },
  secondary: {
    filled: 'bg-secondary text-on-secondary',
    tonal: 'bg-secondary-container text-on-secondary-container',
    outline: 'border-outline text-secondary',
    ghost: 'text-secondary',
    elevated: 'bg-surface-container-low text-secondary',
    link: 'text-secondary',
  },
  tertiary: {
    filled: 'bg-tertiary text-on-tertiary',
    tonal: 'bg-tertiary-container text-on-tertiary-container',
    outline: 'border-outline text-tertiary',
    ghost: 'text-tertiary',
    elevated: 'bg-surface-container-low text-tertiary',
    link: 'text-tertiary',
  },
  error: {
    filled: 'bg-error text-on-error',
    tonal: 'bg-error-container text-on-error-container',
    outline: 'border-error text-error',
    ghost: 'text-error',
    elevated: 'bg-surface-container-low text-error',
    link: 'text-error',
  },
} as const;

// =============================================================================
// Button Variants
// =============================================================================

const buttonVariants = cva(
  // Base styles
  [
    'relative inline-flex items-center justify-center whitespace-nowrap',
    'font-medium rounded-full',
    'transition-all duration-200 ease-out',
    'focus-visible:outline-none',
    'disabled:pointer-events-none',
    // State layer effect via pseudo-element
    'before:absolute before:inset-0 before:rounded-full before:transition-opacity before:opacity-0',
    'hover:before:opacity-8 focus-visible:before:opacity-12 active:before:opacity-12',
  ].join(' '),
  {
    variants: {
      variant: {
        filled: [
          stateLayer.filled,
          'before:bg-on-primary', // State layer color for filled
        ].join(' '),
        tonal: [
          'hover:shadow-sm active:shadow-none transition-shadow',
          'before:bg-on-secondary-container',
        ].join(' '),
        outline: [
          'border bg-transparent',
          'focus-visible:border-current',
          'before:bg-current',
        ].join(' '),
        ghost: ['bg-transparent', 'before:bg-current'].join(' '),
        elevated: [
          'shadow-sm hover:shadow-md active:shadow-sm transition-shadow',
          'before:bg-primary',
        ].join(' '),
        link: [
          'bg-transparent underline-offset-4 hover:underline',
          'p-0 h-auto before:hidden',
        ].join(' '),
      },
      intent: {
        primary: '',
        secondary: '',
        tertiary: '',
        error: '',
      },
      size: {
        sm: 'h-8 px-3 gap-1.5 text-label-sm',
        md: 'h-10 px-6 gap-2 text-label-lg',
        lg: 'h-14 px-8 gap-2.5 text-title-sm',
        icon: 'h-10 w-10 p-0',
        'icon-sm': 'h-8 w-8 p-0',
        'icon-lg': 'h-12 w-12 p-0',
      },
    },
    compoundVariants: [
      // Filled colors
      {
        variant: 'filled',
        intent: 'primary',
        className: `${colors.primary.filled} ${disabled.filled}`,
      },
      {
        variant: 'filled',
        intent: 'secondary',
        className: `${colors.secondary.filled} ${disabled.filled}`,
      },
      {
        variant: 'filled',
        intent: 'tertiary',
        className: `${colors.tertiary.filled} ${disabled.filled}`,
      },
      {
        variant: 'filled',
        intent: 'error',
        className: `${colors.error.filled} ${disabled.filled}`,
      },

      // Tonal colors
      {
        variant: 'tonal',
        intent: 'primary',
        className: `${colors.primary.tonal} ${disabled.filled}`,
      },
      {
        variant: 'tonal',
        intent: 'secondary',
        className: `${colors.secondary.tonal} ${disabled.filled}`,
      },
      {
        variant: 'tonal',
        intent: 'tertiary',
        className: `${colors.tertiary.tonal} ${disabled.filled}`,
      },
      { variant: 'tonal', intent: 'error', className: `${colors.error.tonal} ${disabled.filled}` },

      // Outline colors
      {
        variant: 'outline',
        intent: 'primary',
        className: `${colors.primary.outline} ${disabled.outlined}`,
      },
      {
        variant: 'outline',
        intent: 'secondary',
        className: `${colors.secondary.outline} ${disabled.outlined}`,
      },
      {
        variant: 'outline',
        intent: 'tertiary',
        className: `${colors.tertiary.outline} ${disabled.outlined}`,
      },
      {
        variant: 'outline',
        intent: 'error',
        className: `${colors.error.outline} ${disabled.outlined}`,
      },

      // Ghost colors
      {
        variant: 'ghost',
        intent: 'primary',
        className: `${colors.primary.ghost} ${disabled.text}`,
      },
      {
        variant: 'ghost',
        intent: 'secondary',
        className: `${colors.secondary.ghost} ${disabled.text}`,
      },
      {
        variant: 'ghost',
        intent: 'tertiary',
        className: `${colors.tertiary.ghost} ${disabled.text}`,
      },
      { variant: 'ghost', intent: 'error', className: `${colors.error.ghost} ${disabled.text}` },

      // Elevated colors
      {
        variant: 'elevated',
        intent: 'primary',
        className: `${colors.primary.elevated} ${disabled.filled}`,
      },

      // Link colors
      { variant: 'link', intent: 'primary', className: colors.primary.link },
      { variant: 'link', intent: 'error', className: colors.error.link },
    ],
    defaultVariants: {
      variant: 'filled',
      intent: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, intent, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, intent, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
