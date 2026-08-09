'use client';

/**
 * The morning walk-through, on the page the day actually starts on.
 *
 * @remarks
 * The walk-through lived only behind the plan surface's "Start of day" lens, which meant the
 * screen a person opens in the morning showed them a static list and a prompt box — a day to read,
 * not a day to answer. This is the same surface, on `/today`, wired to the same server-held
 * decisions.
 *
 * **It renders nothing when there is nothing to review.** A day that was never planned, or one
 * already walked through, must not leave a dead panel on the page — Today is a short page on a
 * clear day, and a panel holding nothing holds nothing.
 */
import type { JSX } from 'react';

import { DayStartReview } from '@/components/scheduling-plan/day-start-review';
import {
  useAcknowledgeAgenda,
  useDayStart,
  useDecideMorningProposal,
  useDirective,
  useReorganizeDay,
} from '@/components/scheduling-plan/use-schedule-plan';
import { todayISODate } from '@/lib/today';

/** Props for {@link MorningReview}. */
export interface MorningReviewProps {
  /** Called after a decision or the confirm lands, so the rest of Today re-reads the day. */
  readonly onChanged?: () => void;
}

/**
 * Today's morning walk-through.
 *
 * @param props - An optional callback for when the day changes underneath the page.
 * @returns the walk-through, or nothing when there is none to do.
 */
export function MorningReview(props: MorningReviewProps = {}): JSX.Element | null {
  const date = todayISODate();
  const dayStart = useDayStart(date);
  const directive = useDirective(date);
  const acknowledge = useAcknowledgeAgenda(date);
  const decide = useDecideMorningProposal(date);
  const reorganize = useReorganizeDay(date);

  // Pending and error both render nothing rather than a skeleton or an alert: the walk-through is
  // one panel among several on Today, and a failure to load it must not become the page.
  if (dayStart.data === undefined) return null;
  // A day nobody planned has no agenda to walk through; the page's own empty states cover that.
  if (!dayStart.data.ready) return null;
  // Once it is done it stops asking. It is still readable from the plan surface's morning lens.
  if (dayStart.data.acknowledgedAt !== null) return null;

  return (
    <section aria-labelledby="morning-review-heading" data-testid="today-morning-review">
      <h2 id="morning-review-heading" className="sr-only">
        Walk through today
      </h2>
      <DayStartReview
        dayStart={dayStart.data}
        directive={directive.data}
        acknowledging={acknowledge.isPending}
        onAcknowledge={() => {
          acknowledge.mutate({}, { onSuccess: () => props.onChanged?.() });
        }}
        onDecide={(input) => {
          decide.mutate(input, { onSuccess: () => props.onChanged?.() });
        }}
        deciding={decide.isPending}
        onReorganize={() => {
          reorganize.mutate({}, { onSuccess: () => props.onChanged?.() });
        }}
        reorganizing={reorganize.isPending}
      />
    </section>
  );
}

export default MorningReview;
