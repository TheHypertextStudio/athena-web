'use client';

import type { CalendarItemCreateIntent } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

/** Props for the event-or-timebox choice in quick create. */
export interface CreateBlockTypeSelectorProps {
  readonly intent: CalendarItemCreateIntent;
  readonly onChange: (intent: CalendarItemCreateIntent) => void;
}

/** Render the compact, keyboard-accessible quick-create type choice. */
export function CreateBlockTypeSelector({
  intent,
  onChange,
}: CreateBlockTypeSelectorProps): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Calendar item type"
      className="border-outline-variant grid grid-cols-2 rounded-md border p-0.5"
    >
      {(['event', 'timebox'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={intent === value}
          onClick={() => {
            onChange(value);
          }}
          className={cn(
            'rounded px-2 py-1.5 text-xs font-medium capitalize',
            intent === value
              ? 'bg-surface-container-high text-on-surface'
              : 'text-on-surface-variant',
          )}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
