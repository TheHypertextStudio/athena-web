'use client';

/**
 * `calendar/create-block-type-selector` — the event-or-timebox choice in quick create.
 *
 * @remarks
 * Rendered as a segmented control rather than a bordered box of bare words. The recessed
 * `surface-container` track already separates the pair from the popover surface it sits on, so the
 * outline it used to carry was redundant chrome; grouping is expressed by the tonal step, matching
 * how the app shell separates its own regions. Each segment carries an inline glyph, because a
 * choice between two *kinds of thing* reads faster with an icon than with a capitalized word alone.
 */
import type { CalendarItemCreateIntent } from '@docket/types';
import { Calendar, Schedule } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { focusRingInset } from '@docket/ui/primitives';
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
      className="bg-surface-container grid grid-cols-2 gap-0.5 rounded-md p-0.5"
    >
      {(['event', 'timebox'] as const).map((value) => {
        const selected = intent === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              onChange(value);
            }}
            className={cn(
              'text-label-large flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 capitalize transition-colors motion-reduce:transition-none',
              selected
                ? 'bg-surface-container-highest text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container-high',
              focusRingInset,
            )}
          >
            {value === 'event' ? (
              <Calendar className="size-4" aria-hidden="true" />
            ) : (
              <Schedule className="size-4" aria-hidden="true" />
            )}
            {value}
          </button>
        );
      })}
    </div>
  );
}
