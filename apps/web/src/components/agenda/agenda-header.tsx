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
import { ChevronLeft, ChevronRight } from '@docket/ui/icons';
import { Button, Row } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { shiftISODate, useAgenda } from './agenda-context';
import AgendaViewSwitcher from './agenda-view-switcher';

/** Format a `YYYY-MM-DD` day as a relative label, falling back to `Mon, Jun 30`. */
function formatAgendaDate(iso: string, today: string): string {
  if (iso === today) return 'Today';
  if (iso === shiftISODate(today, 1)) return 'Tomorrow';
  if (iso === shiftISODate(today, -1)) return 'Yesterday';
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** The agenda day navigator: ‹ prev · the day · next › with a jump-to-today. */
export default function AgendaHeader(): JSX.Element {
  const { date, today, isToday, goToPreviousDay, goToNextDay, goToToday } = useAgenda();
  return (
    <Row justify="between" className="shrink-0 px-1 pb-1">
      <Row gap={1}>
        <Button variant="ghost" size="icon" aria-label="Previous day" onClick={goToPreviousDay}>
          <ChevronLeft />
        </Button>
        <span className="text-on-surface w-28 shrink-0 px-1 text-center text-sm font-semibold whitespace-nowrap">
          {formatAgendaDate(date, today)}
        </span>
        <Button variant="ghost" size="icon" aria-label="Next day" onClick={goToNextDay}>
          <ChevronRight />
        </Button>
      </Row>
      <Row gap={1}>
        {isToday ? null : (
          <Button variant="ghost" size="sm" onClick={goToToday}>
            Today
          </Button>
        )}
        <AgendaViewSwitcher />
      </Row>
    </Row>
  );
}
