'use client';

import type { JSX, ReactNode } from 'react';
import { Button, type ButtonProps } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/** An icon action with a required accessible name and an optional shorter visible hint. */
export interface IconButtonProps extends Omit<
  ButtonProps,
  'aria-label' | 'iconOnly' | 'asChild' | 'children'
> {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}

/** Show a compact named action using the surrounding TooltipProvider's shared timing. */
export function IconButton({
  label,
  hint = label,
  children,
  variant = 'ghost',
  type = 'button',
  ...props
}: IconButtonProps): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...props} type={type} variant={variant} iconOnly aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
