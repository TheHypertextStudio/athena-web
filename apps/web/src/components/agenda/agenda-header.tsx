'use client';

/**
 * `agenda/agenda-header` — the agenda's day navigator.
 *
 * @remarks
 * Reads the selected day and the navigation actions from {@link useAgenda} (no props). Steps a day
 * at a time and offers a one-tap jump back to today when you've wandered off it. The label reads
 * relatively ("Today" / "Tomorrow" / "Yesterday") and falls back to a weekday-date. Controls are
 * composed from the {@link Button} primitive rather than hand-styled buttons.
 */
import { CalendarToday, ChevronLeft, ChevronRight } from '@docket/ui/icons';
import { DatePicker } from '@docket/ui/components';
import { Button, Row } from '@docket/ui/primitives';
import { type JSX, type KeyboardEvent } from 'react';

import { formatDay } from '@/components/date-picker';

import { shiftISODate, useAgenda } from './agenda-context';
import AgendaDisplayMenu from './agenda-display-menu';

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
 * The relative name alone used to be the whole label. Combined with the lane heading below — which
 * renders `Wed 5` and deliberately omits the month because
 * {@link file://../scheduling/scheduling-canvas-header.tsx} assumes "the surface's own toolbar owns
 * the month and year" — that left the rail rendering the month **zero** times. The rail is that
 * toolbar, so it says the month.
 */
function formatAgendaDate(iso: string, today: string): string {
  const absolute = formatDay(iso, { month: 'short', day: 'numeric' }) ?? iso;
  const relative = relativeAgendaDay(iso, today);
  if (relative) return `${relative} · ${absolute}`;
  return formatDay(iso, { weekday: 'short', month: 'short', day: 'numeric' }) ?? iso;
}

/** The agenda day navigator: ‹ prev · the day · next › with a jump-to-today. */
export default function AgendaHeader(): JSX.Element {
  const { date, today, isToday, goToDate, goToPreviousDay, goToNextDay, goToToday } = useAgenda();

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
    // One row at every rail width. The date is the only flexible child and it truncates; nothing
    // else may shrink, wrap, or leave. The previous `w-28` floor on that child was what turned a
    // too-narrow rail into a *control* pushed out of the row — the same failure round 3 fixed on
    // the calendar toolbar by deleting its heading's `min-w-16`.
    <Row
      justify="between"
      className="shrink-0 flex-nowrap gap-1 px-1 pb-1"
      onKeyDown={handleKeyDown}
    >
      <Row gap={1} className="min-w-0 flex-1 flex-nowrap">
        <Button
          variant="ghost"
          iconOnly
          controlSize="sm"
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
          triggerClassName="text-title-small min-w-0 flex-1 justify-center px-1"
        />
        <Button
          variant="ghost"
          iconOnly
          controlSize="sm"
          aria-label="Next day"
          onClick={goToNextDay}
        >
          <ChevronRight />
        </Button>
      </Row>
      <Row gap={1} className="shrink-0 flex-nowrap">
        {/* Icon, not the word, exactly as the calendar toolbar collapses its own Today control:
            the label costs ~50px in a row that has ~256px to spend. */}
        {isToday ? null : (
          <Button
            variant="ghost"
            iconOnly
            controlSize="sm"
            aria-label="Back to today"
            onClick={goToToday}
          >
            <CalendarToday />
          </Button>
        )}
        <AgendaDisplayMenu />
      </Row>
    </Row>
  );
}
