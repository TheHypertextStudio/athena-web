'use client';

/**
 * `agenda/agenda-header` — the agenda's day navigator.
 *
 * @remarks
 * Reads the selected day and navigation actions from {@link useAgenda} (no props). The visible
 * month trigger opens the shared month picker, while the seven-day strip switches nearby dates
 * directly. The Today shortcut uses the same display-zone day as Agenda.
 */
import { DatePicker } from '@docket/ui/components';
import { type JSX, type KeyboardEvent, useRef } from 'react';

import { formatDay } from '@/components/date-picker';

import { shiftISODate, useAgenda } from './agenda-context';
import { AgendaDayStrip } from './agenda-day-strip';
import { AgendaDisplayMenu } from './agenda-display-menu';

/**
 * Format a `YYYY-MM-DD` day as the month-picker trigger label.
 *
 * @remarks
 * The day strip supplies nearby dates, so this trigger names the wider month context and opens the
 * arbitrary-date picker.
 */
function formatAgendaMonth(iso: string): string {
  return formatDay(iso, { month: 'long', year: 'numeric' }) ?? iso;
}

/** Render direct date switching and a labeled Agenda display menu. */
export default function AgendaHeader(): JSX.Element {
  const { date, today, goToDate, goToPreviousDay, goToNextDay, goToToday } = useAgenda();
  const datePickerHostRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goToPreviousDay();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goToNextDay();
    } else if (event.key.toLowerCase() === 't') {
      event.preventDefault();
      goToToday();
    } else if (event.key.toLowerCase() === 'g') {
      event.preventDefault();
      datePickerHostRef.current?.querySelector('button')?.click();
    }
  }

  return (
    <div
      role="group"
      aria-label="Agenda date navigation"
      className="flex min-w-0 shrink-0 flex-col gap-1"
      onKeyDown={handleKeyDown}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div ref={datePickerHostRef} className="min-w-0 flex-1">
          <DatePicker
            value={date}
            onChange={(nextDate) => {
              if (nextDate) goToDate(nextDate);
            }}
            placeholder="Choose date"
            formatLabel={(value) => (value ? formatAgendaMonth(value) : undefined)}
            ariaLabel="Agenda date"
            today={today}
            triggerVariant="ghost"
            triggerClassName="text-title-small min-h-10 min-w-0 justify-start px-0"
          />
        </div>
        <AgendaDisplayMenu />
      </div>
      <AgendaDayStrip
        date={date}
        today={today}
        onSelect={goToDate}
        onPageWeek={(direction) => {
          goToDate(shiftISODate(date, direction === 'next' ? 7 : -7));
        }}
      />
    </div>
  );
}
