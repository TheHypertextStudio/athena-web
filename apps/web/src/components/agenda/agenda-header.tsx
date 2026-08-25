'use client';

/**
 * `agenda/agenda-header` — the agenda's day navigator.
 *
 * @remarks
 * Reads the selected day and navigation actions from {@link useAgenda} (no props). The arrows step
 * one day at a time. The visible date trigger opens the shared month picker, whose Today shortcut
 * uses the same display-zone day as Agenda. The label reads relatively ("Today" / "Tomorrow" /
 * "Yesterday") and falls back to a weekday-date.
 */
import { ChevronLeft, ChevronRight } from '@docket/ui/icons';
import { DatePicker } from '@docket/ui/components';
import { Button } from '@docket/ui/primitives';
import { type JSX, type KeyboardEvent } from 'react';

import { formatDay } from '@/components/date-picker';

import { shiftISODate, useAgenda } from './agenda-context';
import { AgendaScaleControls } from './agenda-scale-controls';

/** Relative day name, when the day has one worth saying. */
function relativeAgendaDay(iso: string, today: string): string | null {
  if (iso === today) return 'Today';
  if (iso === shiftISODate(today, 1)) return 'Tomorrow';
  if (iso === shiftISODate(today, -1)) return 'Yesterday';
  return null;
}

/**
 * Format a `YYYY-MM-DD` day for the rail, always naming the month.
 *
 * @remarks
 * The relative name alone used to be the whole label. Agenda now deliberately suppresses the
 * shared lane heading, so this trigger is the rail's one visible date representation and must
 * carry enough absolute context for direct navigation.
 */
function formatAgendaDate(iso: string, today: string): string {
  const absolute = formatDay(iso, { month: 'short', day: 'numeric' }) ?? iso;
  const relative = relativeAgendaDay(iso, today);
  if (relative) return `${relative} · ${absolute}`;
  return formatDay(iso, { weekday: 'short', month: 'short', day: 'numeric' }) ?? iso;
}

/** Render one non-wrapping row for day navigation and display settings. */
export default function AgendaHeader(): JSX.Element {
  const { date, today, goToDate, goToPreviousDay, goToNextDay, goToToday } = useAgenda();

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
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Agenda controls"
      className="flex min-w-0 shrink-0 flex-nowrap items-center gap-1 px-1 pb-1"
      onKeyDown={handleKeyDown}
    >
      <Button
        variant="ghost"
        iconOnly
        controlSize="sm"
        className="min-h-10 min-w-10"
        aria-label="Previous day"
        onClick={goToPreviousDay}
      >
        <ChevronLeft />
      </Button>
      <DatePicker
        value={date}
        onChange={(nextDate) => {
          if (nextDate) goToDate(nextDate);
        }}
        placeholder="Choose date"
        formatLabel={(value) => (value ? formatAgendaDate(value, today) : undefined)}
        ariaLabel="Agenda date"
        today={today}
        triggerVariant="outline"
        triggerClassName="text-title-small min-h-10 min-w-0 flex-1 justify-center px-2"
      />
      <Button
        variant="ghost"
        iconOnly
        controlSize="sm"
        className="min-h-10 min-w-10"
        aria-label="Next day"
        onClick={goToNextDay}
      >
        <ChevronRight />
      </Button>
      <AgendaScaleControls />
    </div>
  );
}
