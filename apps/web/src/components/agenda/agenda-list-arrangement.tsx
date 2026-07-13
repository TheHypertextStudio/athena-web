'use client';

import { Stack } from '@docket/ui/primitives';
import { type JSX, useMemo } from 'react';

import { type AgendaEntry, isTimeboxed } from './agenda-context';
import AgendaEntryCard from './agenda-entry-card';

function startMs(entry: AgendaEntry): number | null {
  return isTimeboxed(entry) ? new Date(entry.startsAt).getTime() : null;
}

function chronological(entries: readonly AgendaEntry[]): AgendaEntry[] {
  return [...entries].sort((left, right) => {
    const leftStart = startMs(left);
    const rightStart = startMs(right);
    if (leftStart !== null && rightStart !== null) return leftStart - rightStart;
    if (leftStart !== null) return -1;
    if (rightStart !== null) return 1;
    return left.sort - right.sort;
  });
}

/** Render agenda entries as a chronological list with untimed work last. */
export function AgendaListArrangement({
  entries,
  loading,
  onOpenCalendarItem,
}: {
  readonly entries: readonly AgendaEntry[];
  readonly loading: boolean;
  readonly onOpenCalendarItem: (itemId: string) => void;
}): JSX.Element {
  const ordered = useMemo(() => chronological(entries), [entries]);
  if (ordered.length === 0 && loading) return <></>;
  if (ordered.length === 0) {
    return (
      <p role="status" className="text-on-surface-variant px-1 py-3 text-sm">
        Nothing scheduled. Use the calendar to plan this day.
      </p>
    );
  }
  return (
    <Stack as="ul" gap={1}>
      {ordered.map((entry) => (
        <li key={entry.id}>
          <AgendaEntryCard entry={entry} onOpenCalendarItem={onOpenCalendarItem} />
        </li>
      ))}
    </Stack>
  );
}
