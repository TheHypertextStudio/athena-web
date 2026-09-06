'use client';

/**
 * `@docket/ui` — the design-system switch.
 *
 * @remarks
 * The control follows the MD3 switch shape and state model. A switch changes a setting at once,
 * so it reports the next checked state from a button with native keyboard behavior and explicit
 * switch semantics. Semantic color tokens keep the track and handle correct in both themes.
 */
import type * as React from 'react';

import { cn } from '../lib/utils';
import { focusRing } from './focus';

/** Props for {@link Switch}. */
export interface SwitchProps extends Omit<React.ComponentProps<'button'>, 'onChange' | 'role'> {
  /** Whether the setting is active. */
  readonly checked: boolean;
  /** Reports the state requested by the user. */
  readonly onCheckedChange?: (checked: boolean) => void;
}

/** A token-styled MD3 switch with explicit accessible state. */
export function Switch({
  checked,
  className,
  disabled,
  onCheckedChange,
  onClick,
  ...props
}: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        'border-outline bg-surface-container-highest inline-flex h-8 w-13 shrink-0 items-center rounded-full border-2 p-1 transition-colors',
        checked && 'border-primary bg-primary justify-end',
        'disabled:cursor-not-allowed disabled:opacity-38',
        focusRing,
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange?.(!checked);
      }}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'bg-on-surface-variant block size-4 rounded-full transition-[width,height,background-color]',
          checked && 'bg-on-primary size-6',
        )}
      />
    </button>
  );
}
