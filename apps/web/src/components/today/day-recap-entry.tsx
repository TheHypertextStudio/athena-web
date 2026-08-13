'use client';

/**
 * `today` — the way into the day's recap.
 *
 * @remarks
 * A link, not a panel. Today is a forward-looking surface — the plan, what needs answering, what is
 * scheduled — and the recap is the only backward-looking thing on it, so it sits last and stays one
 * line. Opening the review is where the day gets read and curated.
 *
 * It renders nothing at all until it has something worth saying, which is the same rule every other
 * section of Today follows: an empty section makes a clear day a short page rather than a list of
 * blanks. It also stays hidden until mid-afternoon, because a recap of a day at nine in the morning is
 * noise dressed as information.
 */
import { EntityListRow } from '@docket/ui/components';
import { Activity, ChevronRight } from '@docket/ui/icons';
import type { JSX } from 'react';
import Link from 'next/link';

import { useDayHighlights } from '@/components/activity/use-day-highlights';

/** Props for {@link DayRecapEntry}. */
export interface DayRecapEntryProps {
  /** The local day (`YYYY-MM-DD`). */
  readonly date: string;
  /** Local hour from which the entry may appear, 0–23. */
  readonly revealAfterHour?: number;
  /** Fixed clock, so the reveal rule is testable. */
  readonly now?: Date;
}

/** The default hour the recap becomes worth offering. */
const DEFAULT_REVEAL_HOUR = 15;

/**
 * A single line offering the day's recap, or nothing.
 *
 * @param props - The day, and optionally when it may appear.
 * @returns the row, or `null` when there is nothing to offer.
 */
export function DayRecapEntry({
  date,
  revealAfterHour = DEFAULT_REVEAL_HOUR,
  now,
}: DayRecapEntryProps): JSX.Element | null {
  const query = useDayHighlights(date);

  // Before the reveal hour, or while the read is pending or failed: nothing. A strip that could not
  // load must not become the page — Today's other sections hold the same line.
  if ((now ?? new Date()).getHours() < revealAfterHour) return null;
  const day = query.data;
  if (!day || day.highlights.length === 0) return null;

  const count = day.highlights.length;
  const sources = new Set(day.highlights.map((highlight) => highlight.system)).size;

  return (
    <EntityListRow
      render={(props) => (
        <Link {...props} href={`/plan?lens=evening&date=${date}`}>
          {props.children}
        </Link>
      )}
      leading={<Activity className="text-on-surface-variant size-5" aria-hidden="true" />}
      title={`${String(count)} ${count === 1 ? 'thing' : 'things'} happened today`}
      subtitle={`Across ${String(sources)} ${sources === 1 ? 'tool' : 'tools'}`}
      trailing={<ChevronRight className="text-on-surface-variant size-4" aria-hidden="true" />}
      aria-label="Review what happened today"
    />
  );
}
