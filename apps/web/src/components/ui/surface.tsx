'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * MD3 Surface Container Components
 *
 * Implements Material Design 3 surface containers with tonal elevation.
 * Use these components instead of raw bg-surface-* classes to ensure consistency.
 *
 * Hierarchy:
 * - Page backgrounds: surface-dim (use bg-surface-dim directly on body/layout)
 * - Modals/overlays: <SurfaceContainer> (surface-container)
 * - Cards within containers: <Surface elevation="high"> (surface-container-high)
 * - Nested elements: <Surface elevation="highest"> (surface-container-highest)
 */

const surfaceContainerVariants = cva('', {
  variants: {
    padding: {
      none: '',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-6',
      xl: 'p-8',
    },
    rounded: {
      none: '',
      sm: 'rounded-lg',
      md: 'rounded-xl',
      lg: 'rounded-2xl',
      xl: 'rounded-3xl',
    },
  },
  defaultVariants: {
    padding: 'lg',
    rounded: 'lg',
  },
});

const surfaceVariants = cva('', {
  variants: {
    elevation: {
      lowest: 'bg-surface-container-lowest',
      low: 'bg-surface-container-low',
      default: 'bg-surface-container',
      high: 'bg-surface-container-high',
      highest: 'bg-surface-container-highest',
    },
    padding: {
      none: '',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-6',
      xl: 'p-8',
    },
    rounded: {
      none: '',
      sm: 'rounded-lg',
      md: 'rounded-xl',
      lg: 'rounded-2xl',
      xl: 'rounded-3xl',
    },
  },
  defaultVariants: {
    elevation: 'high',
    padding: 'md',
    rounded: 'md',
  },
});

type SurfaceElement = 'div' | 'section' | 'article' | 'aside';

export interface SurfaceContainerProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof surfaceContainerVariants> {
  as?: SurfaceElement;
}

/**
 * Modal/overlay surface container.
 *
 * Use this as the root container for modals, dialogs, popovers, and other overlays.
 * Uses surface-container background.
 */
const SurfaceContainer = React.forwardRef<HTMLDivElement, SurfaceContainerProps>(
  ({ className, padding, rounded, as: Component = 'div', ...props }, ref) => {
    return (
      <Component
        ref={ref}
        className={cn(
          'bg-surface-container',
          surfaceContainerVariants({ padding, rounded }),
          className,
        )}
        {...props}
      />
    );
  },
);
SurfaceContainer.displayName = 'SurfaceContainer';

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof surfaceVariants> {
  as?: SurfaceElement;
}

/**
 * Elevated surface for cards and nested elements.
 *
 * Use within a SurfaceContainer or page section:
 * - elevation="high" (default): For cards/sections within a modal or page
 * - elevation="highest": For nested elements within cards
 * - elevation="low": For subtle groupings
 */
const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, elevation, padding, rounded, as: Component = 'div', ...props }, ref) => {
    return (
      <Component
        ref={ref}
        className={cn(surfaceVariants({ elevation, padding, rounded }), className)}
        {...props}
      />
    );
  },
);
Surface.displayName = 'Surface';

export { Surface, SurfaceContainer, surfaceVariants, surfaceContainerVariants };
