import type { AgendaOut } from '@docket/types';

import { scheduleDateRange } from '@/components/scheduling';

type AgendaProviderEntry = Extract<AgendaOut['entries'][number], { kind: 'google_calendar_event' }>;

/** Return whether one legacy provider event overlaps the selected display-zone day. */
function providerEventOverlapsDay(
  entry: AgendaProviderEntry,
  date: string,
  range: { readonly startISO: string; readonly endISO: string },
): boolean {
  const { event } = entry;
  if (event.startsAt && event.endsAt) {
    const startsAt = Date.parse(event.startsAt);
    const endsAt = Date.parse(event.endsAt);
    const rangeStart = Date.parse(range.startISO);
    const rangeEnd = Date.parse(range.endISO);
    return (
      Number.isFinite(startsAt) &&
      Number.isFinite(endsAt) &&
      endsAt > startsAt &&
      startsAt < rangeEnd &&
      endsAt > rangeStart
    );
  }
  return Boolean(
    event.allDayStartDate &&
    event.allDayEndDate &&
    event.allDayStartDate <= date &&
    date < event.allDayEndDate,
  );
}

/**
 * Remove provider events contributed by the legacy UTC agenda window outside one local day.
 *
 * @remarks
 * Daily-plan task entries are already keyed by the requested date and remain untouched. The
 * layered calendar query supplies the same local-day range, while this guard prevents older
 * provider projection rows from leaking across the selected day's heading.
 */
export function filterAgendaForDisplayDate(
  data: AgendaOut,
  date: string,
  displayTimezone: string,
): AgendaOut {
  const range = scheduleDateRange(date, 1, displayTimezone);
  return {
    ...data,
    entries: data.entries.filter(
      (entry) => entry.kind === 'task_timebox' || providerEventOverlapsDay(entry, date, range),
    ),
  };
}
