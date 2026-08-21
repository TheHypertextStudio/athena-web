'use client';

import { Button, Stack } from '@docket/ui/primitives';
import Link from 'next/link';
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
  return (
    <div
      data-agenda-list-scroll=""
      className="h-full min-h-0 overflow-y-auto overscroll-contain px-1 py-3"
    >
      {ordered.length === 0 && loading ? null : ordered.length === 0 ? (
        // A link, not an instruction to go find one. `Use the calendar to plan this day` named the
        // destination and then made the reader locate it themselves, which is a dead empty state by
        // any reading of the rubric.
        <Stack gap={2} role="status">
          <p className="text-on-surface-variant text-body-medium">Nothing scheduled.</p>
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href="/calendar">Plan in the calendar</Link>
          </Button>
        </Stack>
      ) : (
        <Stack as="ul" gap={2}>
          {ordered.map((entry) => (
            <li key={entry.id}>
              <AgendaEntryCard entry={entry} onOpenCalendarItem={onOpenCalendarItem} />
            </li>
          ))}
        </Stack>
      )}
    </div>
  );
}
