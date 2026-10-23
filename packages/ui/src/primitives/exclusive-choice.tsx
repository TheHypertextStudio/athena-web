'use client';
import * as React from 'react';
import { cn } from '../lib/utils';
import { focusRing } from './focus';
import { CONTROL, useControlSize } from './control';
import { typeClass } from './text';

/** One mutually exclusive setting, rather than a destination with a content panel. */
export interface ExclusiveChoiceItem {
  readonly value: string;
  readonly label: React.ReactNode;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
}
/** Controlled settings for a compact single-choice control. */
export interface ExclusiveChoiceProps {
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly items: readonly ExclusiveChoiceItem[];
  readonly className?: string;
}
/** Choose one mode using radio semantics and native radio keyboard conventions. */
export function ExclusiveChoice({
  label,
  value,
  onValueChange,
  items,
  className,
}: ExclusiveChoiceProps): React.JSX.Element {
  const metrics = CONTROL[useControlSize(undefined, 'xl')];
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'bg-surface-container flex max-w-full min-w-0 gap-0.5 overflow-x-auto rounded-lg p-0.5',
        className,
      )}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
          return;
        const radios = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
        );
        if (radios.length === 0) return;
        const index = radios.findIndex((radio) => radio === document.activeElement);
        const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
        const forward =
          event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? radios.length - 1
              : (index + (forward ? 1 : -1) + radios.length) % radios.length;
        const radio = radios[next];
        if (!radio) return;
        event.preventDefault();
        radio.focus();
        radio.click();
      }}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={item.value === value}
          aria-label={item.ariaLabel}
          tabIndex={item.value === value ? 0 : -1}
          disabled={item.disabled}
          onClick={() => {
            onValueChange(item.value);
          }}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-md whitespace-nowrap disabled:opacity-50',
            metrics.minHeight,
            metrics.paddingX,
            metrics.gap,
            typeClass(metrics.labelToken),
            focusRing,
            item.value === value
              ? 'bg-secondary-container text-on-secondary-container'
              : 'text-on-surface hover:bg-on-surface/8',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
