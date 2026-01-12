import * as React from 'react';
import Link from 'next/link';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

/**
 * LinkButton Component
 *
 * Next.js Link styled as a button.
 * Uses the same variant system as Button for consistent styling.
 */

export interface LinkButtonProps
  extends
    Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'>,
    VariantProps<typeof buttonVariants> {
  className?: string;
}

/**
 * Link styled as a button.
 * Uses Next.js Link for client-side navigation with Button styling.
 */
const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <Link className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
LinkButton.displayName = 'LinkButton';

export { LinkButton };
